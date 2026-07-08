const crypto = require('node:crypto');
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const helmet = require('@fastify/helmet');
const rateLimit = require('@fastify/rate-limit');
const cookie = require('@fastify/cookie');
const { MongoClient, ObjectId } = require('mongodb');
const argon2 = require('argon2');
const { Server } = require('socket.io');

const {
  parseLevel,
  evaluate,
  generateLevel,
  dayNumber,
  validateAiLevel,
  AI_PROMPT,
  EPOCH_UTC,
  key,
  cellCh,
} = require('../../shared/core');

const DAY_MS = 86400000;
const TOKEN_BYTES = 32;
const ADMIN_COOKIE = 'purr_admin';
const MAX_SEED = 2 ** 31;
const MAX_COMMUNITY_PER_AUTHOR = 30;
const REPORT_HIDE_THRESHOLD = 5;
// Best-effort blocklist for community level names (seed-based maps can't carry
// arbitrary content, so names are the only free-text surface to moderate).
const PROFANITY = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'faggot', 'rape', 'nazi', 'retard'];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomSecret(bytes = TOKEN_BYTES) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function dailySeed(day) {
  return (day * 2654435761) % 2 ** 31;
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function validateName(name) {
  const n = normalizeName(name);
  if (!/^[A-Za-z0-9 _-]{3,14}$/.test(n)) return null;
  return n;
}

function containsProfanity(str) {
  const flat = String(str).toLowerCase().replace(/[^a-z]/g, '');
  return PROFANITY.some(word => flat.includes(word));
}

function validateLevelName(name) {
  const n = normalizeName(name);
  if (!/^[A-Za-z0-9 !?'.,:_-]{3,40}$/.test(n)) return null;
  if (containsProfanity(n)) return null;
  return n;
}

// Rebuild a community level deterministically from its seed. Because the map is
// generated (never user-supplied), it is guaranteed to be legal and solvable;
// we only reject seeds whose garden isn't good enough (target too low).
function buildCommunityLevel(seed, name) {
  if (!Number.isInteger(seed) || seed < 0 || seed >= MAX_SEED) {
    const err = new Error('invalid seed'); err.statusCode = 400; throw err;
  }
  const lv = generateLevel(seed, { name });
  if (!lv || !lv.target || lv.target < 12) {
    const err = new Error('that seed did not make a good garden — re-roll and try again');
    err.statusCode = 422; throw err;
  }
  return {
    def: publicLevelDef(lv),
    target: lv.target,
    solution: lv.solution || [],
    rows: lv.rows,
    cols: lv.cols,
  };
}

function publicLevelDef(lvOrDoc) {
  const lv = lvOrDoc.def || lvOrDoc;
  return { name: lv.name, walls: lv.walls, map: lv.map };
}

function starCount(score, target) {
  return score >= target ? 3 : score >= Math.ceil(target * 0.8) ? 2 : 1;
}

function scoreBreakdown(lv, ev) {
  let tiles = 0, ny = 0, nt = 0, nu = 0;
  for (const k of ev.reachable) {
    tiles++;
    const ch = cellCh(lv, Math.floor(k / 100), k % 100);
    if (ch === 'y') ny++;
    else if (ch === 't') nt++;
    else if (ch === 'u') nu++;
  }
  const lines = [{ label: `🌱 ${tiles} meadow tile${tiles === 1 ? '' : 's'}`, pts: tiles }];
  if (ny) lines.push({ label: `🧶 yarn ×${ny}`, pts: 3 * ny });
  if (nt) lines.push({ label: `🐟 tuna ×${nt}`, pts: 10 * nt });
  if (nu) lines.push({ label: `🥒 cucumber ×${nu}`, pts: -5 * nu });
  return lines;
}

function parseFenceArray(raw, lv) {
  if (!Array.isArray(raw)) {
    const err = new Error('fences must be an array');
    err.statusCode = 400;
    throw err;
  }
  if (raw.length > lv.walls) {
    const err = new Error('too many fences');
    err.statusCode = 400;
    throw err;
  }
  const out = new Set();
  for (const value of raw) {
    if (!Number.isInteger(value)) {
      const err = new Error('fences must be integer cell keys');
      err.statusCode = 400;
      throw err;
    }
    const r = Math.floor(value / 100);
    const c = value % 100;
    if (r < 0 || c < 0 || r >= lv.rows || c >= lv.cols) {
      const err = new Error('fence outside level');
      err.statusCode = 400;
      throw err;
    }
    if (r === lv.cat[0] && c === lv.cat[1]) {
      const err = new Error('cannot fence the cat');
      err.statusCode = 400;
      throw err;
    }
    const ch = cellCh(lv, r, c);
    if (ch === '~' || ch === '#') {
      const err = new Error('cannot fence blocked terrain');
      err.statusCode = 400;
      throw err;
    }
    out.add(key(r, c));
  }
  return out;
}

function makeAdminSession(secret) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 24 * 60 * 60 * 1000 }), 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

function verifyAdminSession(token, secret) {
  if (!token || !token.includes('.')) return false;
  const [payload, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (mac.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

function signedFriendCode(playerId, secret) {
  const payload = Buffer.from(JSON.stringify({ playerId }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 24);
  return `PURR2-${payload}.${sig}`;
}

function parseFriendCode(code, secret) {
  const match = String(code || '').trim().match(/^PURR2-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!match) return null;
  const [, payload, sig] = match;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 24);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return ObjectId.isValid(data.playerId) ? data.playerId : null;
  } catch {
    return null;
  }
}

async function buildServer() {
  const mongoUri = requiredEnv('MONGODB_URI');
  const sessionSecret = requiredEnv('SESSION_SECRET');
  const shareSecret = requiredEnv('SHARE_SECRET');
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'password'],
    },
  });

  // For each configured origin, also accept its apex<->www counterpart so a
  // deploy on https://www.example.com and https://example.com both work.
  const expandWwwVariants = origins => {
    const out = new Set();
    for (const o of origins) {
      out.add(o);
      const m = /^(https?:\/\/)(?:www\.)?(.+)$/.exec(o);
      if (m) { out.add(`${m[1]}${m[2]}`); out.add(`${m[1]}www.${m[2]}`); }
    }
    return out;
  };

  const allowedOrigins = expandWwwVariants([
    process.env.SITE_ORIGIN,
    ...(process.env.SITE_ORIGINS || '').split(','),
    // Production domain default so the app works even if env vars are unset.
    'https://purrimeter.online',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ].filter(Boolean).map(s => s.trim()));

  await app.register(helmet, { global: true });
  await app.register(cors, {
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'DELETE'],
    origin(origin, cb) {
      if (!origin || allowedOrigins.has(origin)) return cb(null, true);
      cb(new Error('Origin not allowed'), false);
    },
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 60, timeWindow: '1 minute' });

  const client = new MongoClient(mongoUri, { appName: 'purrimeter-api' });
  await client.connect();
  const db = client.db();
  const collections = {
    players: db.collection('players'),
    dailyLevels: db.collection('dailyLevels'),
    submissions: db.collection('submissions'),
    friendships: db.collection('friendships'),
    campaignProgress: db.collection('campaignProgress'),
    aiLevels: db.collection('aiLevels'),
    adminAudit: db.collection('adminAudit'),
    communityLevels: db.collection('communityLevels'),
    communityVotes: db.collection('communityVotes'),
    communityReports: db.collection('communityReports'),
  };

  app.decorate('mongoClient', client);
  app.decorate('db', db);
  app.decorate('collections', collections);

  async function ensureIndexes() {
    await collections.players.createIndex({ tokenHash: 1 }, { unique: true });
    await collections.players.createIndex({ nameKey: 1 }, { unique: true, sparse: true });
    await collections.dailyLevels.createIndex({ day: 1 }, { unique: true });
    await collections.submissions.createIndex({ playerId: 1, day: 1, kind: 1 }, { unique: true });
    await collections.submissions.createIndex({ day: 1, kind: 1, score: -1, createdAt: 1 });
    await collections.friendships.createIndex({ playerId: 1, friendPlayerId: 1 }, { unique: true });
    await collections.campaignProgress.createIndex({ playerId: 1, levelName: 1 }, { unique: true });
    await collections.aiLevels.createIndex({ status: 1, createdAt: -1 });
    await collections.adminAudit.createIndex({ createdAt: -1 });
    await collections.communityLevels.createIndex({ status: 1, likes: -1, createdAt: -1 });
    await collections.communityLevels.createIndex({ status: 1, createdAt: -1 });
    await collections.communityLevels.createIndex({ status: 1, reports: -1 });
    await collections.communityLevels.createIndex({ authorId: 1, seed: 1 }, { unique: true });
    await collections.communityVotes.createIndex({ levelId: 1, playerId: 1 }, { unique: true });
    await collections.communityReports.createIndex({ levelId: 1, playerId: 1 }, { unique: true });
  }
  await ensureIndexes();

  const io = new Server(app.server, {
    cors: { origin: [...allowedOrigins], credentials: true },
  });

  async function auth(request, reply) {
    const header = request.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return reply.code(401).send({ error: 'missing bearer token' });
    const tokenHash = sha256(match[1]);
    const player = await collections.players.findOne({ tokenHash });
    if (!player) return reply.code(401).send({ error: 'invalid token' });
    request.player = player;
    await collections.players.updateOne({ _id: player._id }, { $set: { lastSeen: new Date() } });
  }

  async function adminAuth(request, reply) {
    if (!verifyAdminSession(request.cookies[ADMIN_COOKIE], sessionSecret)) {
      return reply.code(401).send({ error: 'admin login required' });
    }
  }

  async function audit(action, details = {}) {
    await collections.adminAudit.insertOne({ action, details, createdAt: new Date() });
  }

  async function ensureDaily(day) {
    const dayInt = Number.parseInt(day, 10);
    if (!Number.isInteger(dayInt) || dayInt < 1 || dayInt > 200000) {
      const err = new Error('invalid day');
      err.statusCode = 400;
      throw err;
    }
    const existing = await collections.dailyLevels.findOne({ day: dayInt });
    if (existing) return existing;

    const lv = generateLevel(dailySeed(dayInt));
    lv.name = `Daily #${dayInt}`;
    const doc = {
      day: dayInt,
      date: new Date(EPOCH_UTC + (dayInt - 1) * DAY_MS),
      def: publicLevelDef(lv),
      target: lv.target,
      solution: lv.solution || [],
      source: 'generator',
      publishedAt: new Date(),
    };
    try {
      await collections.dailyLevels.insertOne(doc);
      return doc;
    } catch (error) {
      if (error.code === 11000) return collections.dailyLevels.findOne({ day: dayInt });
      throw error;
    }
  }

  async function submissionResult(kind, day, playerId) {
    return collections.submissions.findOne({ kind, day, playerId });
  }

  async function rankFor(kind, day, score, scopeIds = null) {
    const query = { kind, day, score: { $gt: score } };
    if (scopeIds) query.playerId = { $in: scopeIds };
    return (await collections.submissions.countDocuments(query)) + 1;
  }

  async function publicSubmissionRow(sub) {
    const player = await collections.players.findOne({ _id: sub.playerId }, { projection: { name: 1 } });
    return {
      playerId: String(sub.playerId),
      name: player?.name || 'Anonymous',
      score: sub.score,
      stars: sub.stars,
      createdAt: sub.createdAt,
    };
  }

  async function leaderboard(kind, day, player, scope = 'global') {
    let scopeIds = null;
    if (scope === 'friends') {
      const rels = await collections.friendships.find({ playerId: player._id }).toArray();
      scopeIds = [player._id, ...rels.map(r => r.friendPlayerId)];
    }
    const query = { kind, day };
    if (scopeIds) query.playerId = { $in: scopeIds };
    const topSubs = await collections.submissions
      .find(query)
      .sort({ score: -1, createdAt: 1 })
      .limit(100)
      .toArray();
    const rows = [];
    for (const sub of topSubs) rows.push(await publicSubmissionRow(sub));
    const mine = await collections.submissions.findOne({ kind, day, playerId: player._id });
    const myRank = mine ? await rankFor(kind, day, mine.score, scopeIds) : null;
    return { rows, mine: mine ? { score: mine.score, stars: mine.stars, rank: myRank } : null };
  }

  async function dailyStats(day, target) {
    const subs = await collections.submissions.find({ kind: 'daily', day }).project({ score: 1, stars: 1 }).toArray();
    const count = subs.length;
    const average = count ? Number((subs.reduce((sum, s) => sum + s.score, 0) / count).toFixed(1)) : null;
    const buckets = [0, 0, 0, 0];
    for (const s of subs) {
      const pct = s.score / target;
      buckets[pct >= 1 ? 3 : pct >= 0.8 ? 2 : pct >= 0.5 ? 1 : 0]++;
    }
    return { count, average, buckets };
  }

  async function broadcastDaily(day, solved = null) {
    const doc = await ensureDaily(day);
    const stats = await dailyStats(day, doc.target);
    io.to(`daily:${day}`).emit('daily:stats', { day, stats });
    if (solved) io.to(`daily:${day}`).emit('daily:solved', solved);
  }

  io.on('connection', socket => {
    const day = Number.parseInt(socket.handshake.query.day, 10) || dayNumber();
    socket.join(`daily:${day}`);
  });

  app.get('/healthz', async () => {
    return { ok: true };
  });

  app.get('/readyz', async () => {
    await db.command({ ping: 1 });
    return { ok: true, mongo: true };
  });

  app.post('/api/register', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async () => {
    const token = randomSecret();
    const now = new Date();
    const result = await collections.players.insertOne({
      tokenHash: sha256(token),
      name: 'Anonymous',
      createdAt: now,
      lastSeen: now,
      entitlements: [],
    });
    return { playerId: String(result.insertedId), token };
  });

  app.get('/api/me', { preHandler: auth }, async request => ({
    playerId: String(request.player._id),
    name: request.player.name || 'Anonymous',
    entitlements: request.player.entitlements || [],
    friendCode: signedFriendCode(String(request.player._id), shareSecret),
  }));

  app.post('/api/me/name', {
    preHandler: auth,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const name = validateName(request.body?.name);
    if (!name) return reply.code(400).send({ error: 'name must be 3-14 letters/numbers/spaces/_/-' });
    try {
      await collections.players.updateOne(
        { _id: request.player._id },
        { $set: { name, nameKey: name.toLowerCase() } },
      );
    } catch (error) {
      if (error.code === 11000) return reply.code(409).send({ error: 'name already taken' });
      throw error;
    }
    return { ok: true, name };
  });

  async function linkFriends(aId, bId) {
    const now = new Date();
    // Mutual friendship: both players see each other on friends boards.
    const pairs = [
      { playerId: aId, friendPlayerId: bId, createdAt: now },
      { playerId: bId, friendPlayerId: aId, createdAt: now },
    ];
    for (const doc of pairs) {
      try {
        await collections.friendships.insertOne(doc);
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    }
  }

  app.post('/api/friends', { preHandler: auth }, async (request, reply) => {
    const friendPlayerId = parseFriendCode(request.body?.code, shareSecret);
    if (!friendPlayerId) return reply.code(400).send({ error: 'invalid friend code' });
    if (friendPlayerId === String(request.player._id)) return reply.code(400).send({ error: 'cannot add yourself' });
    const friend = await collections.players.findOne({ _id: new ObjectId(friendPlayerId) });
    if (!friend) return reply.code(404).send({ error: 'friend not found' });
    await linkFriends(request.player._id, friend._id);
    return { ok: true, friend: { playerId: String(friend._id), name: friend.name || 'Anonymous' } };
  });

  app.get('/api/friends', { preHandler: auth }, async request => {
    const rels = await collections.friendships
      .find({ playerId: request.player._id }).sort({ createdAt: 1 }).toArray();
    const ids = rels.map(r => r.friendPlayerId);
    if (!ids.length) return { day: dayNumber(), friends: [] };
    const day = dayNumber();
    const [players, subs] = await Promise.all([
      collections.players.find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray(),
      collections.submissions
        .find({ kind: 'daily', day, playerId: { $in: ids } })
        .project({ playerId: 1, score: 1, stars: 1 }).toArray(),
    ]);
    const nameById = new Map(players.map(p => [String(p._id), p.name || 'Anonymous']));
    const subById = new Map(subs.map(s => [String(s.playerId), s]));
    const friends = ids.map(id => {
      const sid = String(id);
      const s = subById.get(sid);
      return {
        playerId: sid,
        name: nameById.get(sid) || 'Anonymous',
        daily: s ? { score: s.score, stars: s.stars } : null,
      };
    });
    return { day, friends };
  });

  app.delete('/api/friends/:playerId', { preHandler: auth }, async (request, reply) => {
    const other = request.params.playerId;
    if (!ObjectId.isValid(other)) return reply.code(400).send({ error: 'invalid player id' });
    const otherId = new ObjectId(other);
    await collections.friendships.deleteMany({
      $or: [
        { playerId: request.player._id, friendPlayerId: otherId },
        { playerId: otherId, friendPlayerId: request.player._id },
      ],
    });
    return { ok: true };
  });

  app.get('/api/daily', { preHandler: auth }, async request => {
    const day = request.query?.day ? Number.parseInt(request.query.day, 10) : dayNumber();
    const doc = await ensureDaily(day);
    const existing = await submissionResult('daily', doc.day, request.player._id);
    const base = { day: doc.day, def: doc.def, walls: doc.def.walls };
    if (!existing) return base;
    return {
      ...base,
      target: doc.target,
      solution: doc.solution,
      result: {
        score: existing.score,
        stars: existing.stars,
        fences: existing.fences,
        walls: doc.def.walls,
        breakdown: existing.breakdown || [],
      },
    };
  });

  app.post('/api/daily/submit', {
    preHandler: auth,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const day = request.body?.day ? Number.parseInt(request.body.day, 10) : dayNumber();
    const doc = await ensureDaily(day);
    const lv = parseLevel({ ...doc.def, target: doc.target, solution: doc.solution });
    const fences = parseFenceArray(request.body?.fences, lv);
    const ev = evaluate(lv, fences);
    if (ev.escaped) return reply.code(422).send({ error: 'cat can escape' });

    const score = ev.score;
    const stars = starCount(score, doc.target);
    const createdAt = new Date();
    const result = {
      playerId: request.player._id,
      kind: 'daily',
      day: doc.day,
      fences: [...fences],
      score,
      stars,
      breakdown: scoreBreakdown(lv, ev),
      createdAt,
    };
    try {
      await collections.submissions.insertOne(result);
    } catch (error) {
      if (error.code === 11000) return reply.code(409).send({ error: 'daily already submitted' });
      throw error;
    }
    const rank = await rankFor('daily', doc.day, score);
    const stats = await dailyStats(doc.day, doc.target);
    const solved = { name: request.player.name || 'Anonymous', score, stars, day: doc.day };
    await broadcastDaily(doc.day, solved);
    return {
      score,
      stars,
      fences: [...fences],
      walls: doc.def.walls,
      breakdown: result.breakdown,
      target: doc.target,
      solution: doc.solution,
      rank,
      stats,
    };
  });

  app.get('/api/archive', { preHandler: auth }, async request => {
    const today = dayNumber();
    const from = Math.max(1, Number.parseInt(request.query?.from || today - 60, 10));
    const to = Math.min(today, Number.parseInt(request.query?.to || today, 10));
    const days = [];
    const existing = await collections.submissions
      .find({ playerId: request.player._id, kind: { $in: ['daily', 'archive'] }, day: { $gte: from, $lte: to } })
      .toArray();
    const byDay = new Map(existing.map(s => [`${s.kind}:${s.day}`, s]));
    for (let day = to; day >= from; day--) {
      const live = byDay.get(`daily:${day}`);
      const archive = byDay.get(`archive:${day}`);
      const best = archive && (!live || archive.score > live.score) ? archive : live;
      days.push({
        day,
        date: new Date(EPOCH_UTC + (day - 1) * DAY_MS).toISOString().slice(0, 10),
        result: best ? { score: best.score, stars: best.stars, archived: best.kind === 'archive' } : null,
      });
    }
    return { days, archiveRequiresPremium: process.env.ARCHIVE_REQUIRES_PREMIUM === 'true' };
  });

  app.get('/api/archive/:day', { preHandler: auth }, async (request, reply) => {
    const day = Number.parseInt(request.params.day, 10);
    if (process.env.ARCHIVE_REQUIRES_PREMIUM === 'true' && !(request.player.entitlements || []).includes('archive')) {
      return reply.code(402).send({ error: 'archive premium required' });
    }
    const doc = await ensureDaily(day);
    const existing = await submissionResult('archive', doc.day, request.player._id)
      || await submissionResult('daily', doc.day, request.player._id);
    return {
      day: doc.day,
      def: doc.def,
      target: existing ? doc.target : undefined,
      solution: existing ? doc.solution : undefined,
      result: existing ? {
        score: existing.score,
        stars: existing.stars,
        fences: existing.fences,
        walls: doc.def.walls,
        breakdown: existing.breakdown || [],
        archived: existing.kind === 'archive',
      } : null,
    };
  });

  app.post('/api/archive/:day/submit', {
    preHandler: auth,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const day = Number.parseInt(request.params.day, 10);
    if (process.env.ARCHIVE_REQUIRES_PREMIUM === 'true' && !(request.player.entitlements || []).includes('archive')) {
      return reply.code(402).send({ error: 'archive premium required' });
    }
    const doc = await ensureDaily(day);
    const lv = parseLevel({ ...doc.def, target: doc.target, solution: doc.solution });
    const fences = parseFenceArray(request.body?.fences, lv);
    const ev = evaluate(lv, fences);
    if (ev.escaped) return reply.code(422).send({ error: 'cat can escape' });
    const score = ev.score;
    const stars = starCount(score, doc.target);
    const breakdown = scoreBreakdown(lv, ev);
    const previous = await collections.submissions.findOne({ playerId: request.player._id, kind: 'archive', day });
    if (!previous || score > previous.score) {
      await collections.submissions.updateOne(
        { playerId: request.player._id, kind: 'archive', day },
        { $set: { fences: [...fences], score, stars, breakdown, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
    }
    return { score, stars, fences: [...fences], walls: doc.def.walls, breakdown, target: doc.target, solution: doc.solution };
  });

  app.get('/api/leaderboard/:day', { preHandler: auth }, async request => {
    const day = Number.parseInt(request.params.day, 10);
    const scope = request.query?.scope === 'friends' ? 'friends' : 'global';
    const doc = await ensureDaily(day);
    const board = await leaderboard('daily', doc.day, request.player, scope);
    const stats = await dailyStats(doc.day, doc.target);
    return { day: doc.day, scope, ...board, stats };
  });

  // ---------- community levels ----------
  function communityRow(doc, likedByMe, playerId) {
    return {
      id: String(doc._id),
      name: doc.name,
      author: doc.authorName || 'Anonymous',
      def: doc.def,
      walls: doc.def.walls,
      target: doc.target,
      rows: doc.rows,
      cols: doc.cols,
      likes: doc.likes || 0,
      plays: doc.plays || 0,
      likedByMe: !!likedByMe,
      mine: playerId ? String(doc.authorId) === String(playerId) : false,
      status: doc.status,
      createdAt: doc.createdAt,
    };
  }

  app.get('/api/community/levels', { preHandler: auth }, async request => {
    const mine = request.query?.mine === '1' || request.query?.scope === 'mine';
    const sort = mine || request.query?.sort === 'new'
      ? { createdAt: -1 }
      : { likes: -1, createdAt: -1 };
    // Public lists show only active gardens; "mine" also shows the author's
    // hidden (under-review) gardens, but never removed ones.
    const query = mine
      ? { authorId: request.player._id, status: { $ne: 'removed' } }
      : { status: 'active' };
    const limit = Math.min(30, Math.max(1, Number.parseInt(request.query?.limit || 12, 10) || 12));
    const skip = Math.max(0, Number.parseInt(request.query?.skip || 0, 10) || 0);
    const docs = await collections.communityLevels
      .find(query).sort(sort).skip(skip).limit(limit + 1).toArray();
    const hasMore = docs.length > limit;
    const page = docs.slice(0, limit);
    const ids = page.map(d => d._id);
    const myVotes = ids.length
      ? await collections.communityVotes.find({ levelId: { $in: ids }, playerId: request.player._id }).toArray()
      : [];
    const liked = new Set(myVotes.map(v => String(v.levelId)));
    return {
      levels: page.map(d => communityRow(d, liked.has(String(d._id)), request.player._id)),
      hasMore,
    };
  });

  app.post('/api/community/levels', {
    preHandler: auth,
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const name = validateLevelName(request.body?.name);
    if (!name) return reply.code(400).send({ error: 'name must be 3-40 clean characters' });
    const seed = Number.parseInt(request.body?.seed, 10);
    const built = buildCommunityLevel(seed, name); // throws 400/422 on bad seed/garden

    const owned = await collections.communityLevels.countDocuments({ authorId: request.player._id, status: { $ne: 'removed' } });
    if (owned >= MAX_COMMUNITY_PER_AUTHOR) {
      return reply.code(400).send({ error: `you can publish up to ${MAX_COMMUNITY_PER_AUTHOR} gardens` });
    }

    const doc = {
      seed,
      name,
      def: built.def,
      target: built.target,
      solution: built.solution,
      rows: built.rows,
      cols: built.cols,
      authorId: request.player._id,
      authorName: request.player.name || 'Anonymous',
      status: 'active',
      likes: 0,
      reports: 0,
      plays: 0,
      createdAt: new Date(),
    };
    try {
      const res = await collections.communityLevels.insertOne(doc);
      doc._id = res.insertedId;
    } catch (error) {
      if (error.code === 11000) return reply.code(409).send({ error: 'you already published this garden' });
      throw error;
    }
    return { ok: true, level: communityRow(doc, false, request.player._id) };
  });

  app.post('/api/community/levels/:id/like', { preHandler: auth }, async (request, reply) => {
    if (!ObjectId.isValid(request.params.id)) return reply.code(400).send({ error: 'invalid level id' });
    const levelId = new ObjectId(request.params.id);
    const level = await collections.communityLevels.findOne({ _id: levelId, status: 'active' });
    if (!level) return reply.code(404).send({ error: 'level not found' });
    if (String(level.authorId) === String(request.player._id)) {
      return reply.code(400).send({ error: 'you cannot like your own garden' });
    }
    let liked;
    try {
      await collections.communityVotes.insertOne({ levelId, playerId: request.player._id, createdAt: new Date() });
      await collections.communityLevels.updateOne({ _id: levelId }, { $inc: { likes: 1 } });
      liked = true;
    } catch (error) {
      if (error.code !== 11000) throw error;
      await collections.communityVotes.deleteOne({ levelId, playerId: request.player._id });
      await collections.communityLevels.updateOne({ _id: levelId }, { $inc: { likes: -1 } });
      liked = false;
    }
    const fresh = await collections.communityLevels.findOne({ _id: levelId }, { projection: { likes: 1 } });
    return { ok: true, liked, likes: Math.max(0, fresh?.likes || 0) };
  });

  app.post('/api/community/levels/:id/report', { preHandler: auth }, async (request, reply) => {
    if (!ObjectId.isValid(request.params.id)) return reply.code(400).send({ error: 'invalid level id' });
    const levelId = new ObjectId(request.params.id);
    const level = await collections.communityLevels.findOne({ _id: levelId });
    if (!level || level.status === 'removed') return reply.code(404).send({ error: 'level not found' });
    if (String(level.authorId) === String(request.player._id)) {
      return reply.code(400).send({ error: 'you cannot report your own garden' });
    }
    const reason = String(request.body?.reason || 'inappropriate').slice(0, 200);
    try {
      await collections.communityReports.insertOne({ levelId, playerId: request.player._id, reason, createdAt: new Date() });
    } catch (error) {
      if (error.code === 11000) return { ok: true }; // already reported by this player
      throw error;
    }
    const updated = await collections.communityLevels.findOneAndUpdate(
      { _id: levelId },
      { $inc: { reports: 1 } },
      { returnDocument: 'after' },
    );
    const doc = updated.value || updated;
    if (doc && doc.status === 'active' && (doc.reports || 0) >= REPORT_HIDE_THRESHOLD) {
      await collections.communityLevels.updateOne({ _id: levelId }, { $set: { status: 'hidden' } });
    }
    return { ok: true };
  });

  app.post('/api/community/levels/:id/play', { preHandler: auth }, async (request, reply) => {
    if (!ObjectId.isValid(request.params.id)) return reply.code(400).send({ error: 'invalid level id' });
    await collections.communityLevels.updateOne(
      { _id: new ObjectId(request.params.id), status: 'active' },
      { $inc: { plays: 1 } },
    );
    return { ok: true };
  });

  app.post('/api/admin/login', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const hash = process.env.ADMIN_PASSWORD_HASH;
    if (!hash) return reply.code(503).send({ error: 'admin password not configured' });
    const ok = await argon2.verify(hash, String(request.body?.password || ''));
    if (!ok) return reply.code(401).send({ error: 'invalid password' });
    reply.setCookie(ADMIN_COOKIE, makeAdminSession(sessionSecret), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 24 * 60 * 60,
    });
    await audit('login');
    return { ok: true };
  });

  app.post('/api/admin/logout', { preHandler: adminAuth }, async (_request, reply) => {
    reply.clearCookie(ADMIN_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/admin/stats', { preHandler: adminAuth }, async () => {
    const [players, submissions, aiDrafts, published, community, reported] = await Promise.all([
      collections.players.countDocuments(),
      collections.submissions.countDocuments(),
      collections.aiLevels.countDocuments({ status: 'draft' }),
      collections.dailyLevels.countDocuments(),
      collections.communityLevels.countDocuments({ status: { $ne: 'removed' } }),
      collections.communityLevels.countDocuments({ status: 'active', reports: { $gt: 0 } }),
    ]);
    return { players, submissions, aiDrafts, published, community, reported };
  });

  app.get('/api/admin/community', { preHandler: adminAuth }, async request => {
    const filter = request.query?.filter === 'all' ? {} : { reports: { $gt: 0 } };
    const docs = await collections.communityLevels
      .find(filter).sort({ reports: -1, createdAt: -1 }).limit(100).toArray();
    const levels = [];
    for (const d of docs) {
      const reasons = d.reports
        ? (await collections.communityReports.find({ levelId: d._id }).sort({ createdAt: -1 }).limit(5).toArray()).map(r => r.reason)
        : [];
      levels.push({
        id: String(d._id),
        name: d.name,
        author: d.authorName || 'Anonymous',
        seed: d.seed,
        target: d.target,
        size: `${d.rows}×${d.cols}`,
        status: d.status,
        likes: d.likes || 0,
        plays: d.plays || 0,
        reports: d.reports || 0,
        reasons,
        createdAt: d.createdAt,
      });
    }
    return { levels };
  });

  app.post('/api/admin/community/:id/remove', { preHandler: adminAuth }, async (request, reply) => {
    if (!ObjectId.isValid(request.params.id)) return reply.code(400).send({ error: 'invalid level id' });
    const id = new ObjectId(request.params.id);
    const res = await collections.communityLevels.updateOne({ _id: id }, { $set: { status: 'removed' } });
    if (!res.matchedCount) return reply.code(404).send({ error: 'level not found' });
    await audit('remove_community_level', { id: request.params.id });
    return { ok: true };
  });

  app.post('/api/admin/community/:id/restore', { preHandler: adminAuth }, async (request, reply) => {
    if (!ObjectId.isValid(request.params.id)) return reply.code(400).send({ error: 'invalid level id' });
    const id = new ObjectId(request.params.id);
    const res = await collections.communityLevels.updateOne(
      { _id: id }, { $set: { status: 'active', reports: 0 } },
    );
    if (!res.matchedCount) return reply.code(404).send({ error: 'level not found' });
    await collections.communityReports.deleteMany({ levelId: id });
    await audit('restore_community_level', { id: request.params.id });
    return { ok: true };
  });

  async function callProvider(provider, prompt) {
    if (provider === 'anthropic') {
      const key = requiredEnv('ANTHROPIC_API_KEY');
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`Anthropic API ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
      return (data.content || []).map(block => block.text || '').join('');
    }
    const key = requiredEnv('OPENAI_API_KEY');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
    return data.choices?.[0]?.message?.content || '';
  }

  function extractJson(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('no JSON object in provider response');
    return JSON.parse(text.slice(start, end + 1));
  }

  app.get('/api/admin/levels', { preHandler: adminAuth }, async () => {
    const levels = await collections.aiLevels.find({}).sort({ createdAt: -1 }).limit(50).toArray();
    return {
      levels: levels.map(level => ({
        id: String(level._id),
        name: level.def.name,
        target: level.target,
        status: level.status,
        createdAt: level.createdAt,
      })),
    };
  });

  app.post('/api/admin/generate', {
    preHandler: adminAuth,
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const provider = request.body?.provider === 'openai' ? 'openai' : 'anthropic';
    const hint = String(request.body?.hint || 'a polished launch-quality garden').slice(0, 160);
    let lastErr = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      const extra = attempt === 1 ? '' : `\n\nYour previous attempt failed validation: ${lastErr}. Fix it and return corrected JSON only.`;
      const text = await callProvider(provider, AI_PROMPT(hint) + extra);
      let obj;
      try {
        obj = extractJson(text);
      } catch (error) {
        lastErr = error.message;
        continue;
      }
      const valid = validateAiLevel(obj);
      if (typeof valid === 'string') {
        lastErr = valid;
        continue;
      }
      const doc = {
        def: publicLevelDef(valid),
        target: valid.target,
        solution: valid.solution || [],
        provider,
        hint,
        status: 'draft',
        createdAt: new Date(),
      };
      const result = await collections.aiLevels.insertOne(doc);
      await audit('generate_level', { id: String(result.insertedId), provider, hint });
      return { id: String(result.insertedId), ...doc };
    }
    return reply.code(422).send({ error: `provider failed validation: ${lastErr}` });
  });

  app.post('/api/admin/daily/regenerate/:day', { preHandler: adminAuth }, async request => {
    const day = Number.parseInt(request.params.day, 10);
    const lv = generateLevel(dailySeed(day));
    lv.name = `Daily #${day}`;
    const doc = {
      day,
      date: new Date(EPOCH_UTC + (day - 1) * DAY_MS),
      def: publicLevelDef(lv),
      target: lv.target,
      solution: lv.solution || [],
      source: 'generator',
      publishedAt: new Date(),
    };
    await collections.dailyLevels.replaceOne({ day }, doc, { upsert: true });
    await collections.submissions.deleteMany({ day, kind: 'daily' });
    await audit('regenerate_daily', { day });
    await broadcastDaily(day);
    return { ok: true, daily: doc };
  });

  app.post('/api/admin/levels/:id/publish', { preHandler: adminAuth }, async (request, reply) => {
    if (!ObjectId.isValid(request.params.id)) return reply.code(400).send({ error: 'invalid level id' });
    const day = Number.parseInt(request.body?.day, 10);
    if (!Number.isInteger(day) || day < 1) return reply.code(400).send({ error: 'invalid publish day' });
    const level = await collections.aiLevels.findOne({ _id: new ObjectId(request.params.id) });
    if (!level) return reply.code(404).send({ error: 'level not found' });
    const doc = {
      day,
      date: new Date(EPOCH_UTC + (day - 1) * DAY_MS),
      def: level.def,
      target: level.target,
      solution: level.solution,
      source: 'admin',
      aiLevelId: level._id,
      publishedAt: new Date(),
    };
    await collections.dailyLevels.replaceOne({ day }, doc, { upsert: true });
    await collections.aiLevels.updateOne({ _id: level._id }, { $set: { status: 'published', publishedDay: day } });
    await audit('publish_level', { id: String(level._id), day });
    await broadcastDaily(day);
    return { ok: true, daily: doc };
  });

  app.setErrorHandler((error, _request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    app.log.error(error);
    reply.code(status).send({ error: status >= 500 ? 'internal server error' : error.message });
  });

  app.addHook('onClose', async () => {
    await client.close();
  });

  return app;
}

if (require.main === module) {
  buildServer()
    .then(app => app.listen({ host: '0.0.0.0', port: Number(process.env.PORT || 3000) }))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { buildServer, dailySeed, starCount, validateName, signedFriendCode, parseFriendCode };
