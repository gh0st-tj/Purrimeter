'use strict';

// Server tests. The pure-helper tests run whenever the server deps are installed
// (`cd server && npm ci`). The integration tests additionally require a MongoDB
// reachable via MONGODB_URI (CI provides a service container); otherwise skipped.
const test = require('node:test');
const assert = require('node:assert');

let server = null;
try {
  server = require('../server/src/index');
} catch (e) {
  // Server dependencies (fastify, mongodb, …) not installed — skip server tests.
}

const noServer = server ? false : 'server deps not installed (run: cd server && npm ci)';

test('starCount uses 3 / ceil(80%) / else thresholds', { skip: noServer }, () => {
  assert.equal(server.starCount(10, 10), 3);
  assert.equal(server.starCount(11, 10), 3);
  assert.equal(server.starCount(8, 10), 2); // ceil(8) = 8
  assert.equal(server.starCount(9, 10), 2);
  assert.equal(server.starCount(7, 10), 1);
});

test('validateName enforces the 3–14 charset rule', { skip: noServer }, () => {
  assert.equal(server.validateName('Mochi'), 'Mochi');
  assert.equal(server.validateName('  Mo  chi '), 'Mo chi');
  assert.equal(server.validateName('ab'), null);
  assert.equal(server.validateName('x'.repeat(15)), null);
  assert.equal(server.validateName('bad*name'), null);
});

test('signed friend codes round-trip and reject tampering', { skip: noServer }, () => {
  const secret = 'unit-test-secret';
  const id = '507f1f77bcf86cd799439011';
  const code = server.signedFriendCode(id, secret);
  assert.match(code, /^PURR2-/);
  assert.equal(server.parseFriendCode(code, secret), id);
  assert.equal(server.parseFriendCode(code, 'other-secret'), null);
  assert.equal(server.parseFriendCode(code.slice(0, -1) + '0', secret), null);
  assert.equal(server.parseFriendCode('not-a-code', secret), null);
});

const noDb = noServer || (process.env.MONGODB_URI ? false : 'no MONGODB_URI (integration test skipped)');

test('daily submit: abuse paths are rejected, valid solve scores once', { skip: noDb }, async (t) => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-session-secret';
  process.env.SHARE_SECRET = process.env.SHARE_SECRET || 'ci-share-secret';
  const core = require('../shared/core');

  const app = await server.buildServer();
  t.after(() => app.close());

  const reg = await app.inject({ method: 'POST', url: '/api/register', payload: {} });
  assert.equal(reg.statusCode, 200);
  const token = reg.json().token;
  const headers = { authorization: 'Bearer ' + token };

  // Missing token → 401.
  const noAuth = await app.inject({ method: 'GET', url: '/api/daily' });
  assert.equal(noAuth.statusCode, 401);

  const daily = await app.inject({ method: 'GET', url: '/api/daily', headers });
  assert.equal(daily.statusCode, 200);
  const d = daily.json();
  const lv = core.parseLevel(d.def);

  // No fences → the cat escapes → 422.
  const escaped = await app.inject({
    method: 'POST', url: '/api/daily/submit', headers,
    payload: { day: d.day, fences: [] },
  });
  assert.equal(escaped.statusCode, 422);

  // A real enclosing solution → 200 with a positive score.
  const sol = core.solve(lv, { iters: 6000, restarts: 3, seed: 1 });
  const first = await app.inject({
    method: 'POST', url: '/api/daily/submit', headers,
    payload: { day: d.day, fences: [...sol.fences] },
  });
  assert.equal(first.statusCode, 200);
  const body = first.json();
  assert.ok(body.score > 0);
  assert.ok(body.stars >= 1 && body.stars <= 3);

  // Second submit for the same day → 409 (one submission per player).
  const again = await app.inject({
    method: 'POST', url: '/api/daily/submit', headers,
    payload: { day: d.day, fences: [...sol.fences] },
  });
  assert.equal(again.statusCode, 409);

  // Invalid friend code → 400.
  const badFriend = await app.inject({
    method: 'POST', url: '/api/friends', headers,
    payload: { code: 'definitely-not-valid' },
  });
  assert.equal(badFriend.statusCode, 400);

  // Friends list has the expected shape.
  const friends = await app.inject({ method: 'GET', url: '/api/friends', headers });
  assert.equal(friends.statusCode, 200);
  assert.ok(Array.isArray(friends.json().friends));
});

test('friendships are mutual and removable', { skip: noDb }, async (t) => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-session-secret';
  process.env.SHARE_SECRET = process.env.SHARE_SECRET || 'ci-share-secret';

  const app = await server.buildServer();
  t.after(() => app.close());

  const makePlayer = async () => {
    const reg = await app.inject({ method: 'POST', url: '/api/register', payload: {} });
    const token = reg.json().token;
    const headers = { authorization: 'Bearer ' + token };
    const me = await app.inject({ method: 'GET', url: '/api/me', headers });
    return { headers, ...me.json() };
  };

  const a = await makePlayer();
  const b = await makePlayer();

  // A adds B by B's signed friend code.
  const add = await app.inject({
    method: 'POST', url: '/api/friends', headers: a.headers,
    payload: { code: b.friendCode },
  });
  assert.equal(add.statusCode, 200);
  assert.equal(add.json().friend.playerId, b.playerId);

  // Both directions exist (mutual).
  const aFriends = await app.inject({ method: 'GET', url: '/api/friends', headers: a.headers });
  const bFriends = await app.inject({ method: 'GET', url: '/api/friends', headers: b.headers });
  assert.deepEqual(aFriends.json().friends.map(f => f.playerId), [b.playerId]);
  assert.deepEqual(bFriends.json().friends.map(f => f.playerId), [a.playerId]);

  // Removing from one side clears the relationship both ways.
  const del = await app.inject({ method: 'DELETE', url: '/api/friends/' + b.playerId, headers: a.headers });
  assert.equal(del.statusCode, 200);
  const aAfter = await app.inject({ method: 'GET', url: '/api/friends', headers: a.headers });
  const bAfter = await app.inject({ method: 'GET', url: '/api/friends', headers: b.headers });
  assert.equal(aAfter.json().friends.length, 0);
  assert.equal(bAfter.json().friends.length, 0);
});

test('community levels: publish validation, likes, and reports', { skip: noDb }, async (t) => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-session-secret';
  process.env.SHARE_SECRET = process.env.SHARE_SECRET || 'ci-share-secret';
  const core = require('../shared/core');

  // Find a seed that generates a good garden (target >= 12).
  let seed = 0;
  for (let s = 1; s <= 20 && !seed; s++) {
    const lv = core.generateLevel(s, { name: 'x' });
    if (lv && lv.target >= 12) seed = s;
  }
  assert.ok(seed, 'expected at least one good seed in 1..20');

  const app = await server.buildServer();
  t.after(() => app.close());

  const register = async () => {
    const reg = await app.inject({ method: 'POST', url: '/api/register', payload: {} });
    return { authorization: 'Bearer ' + reg.json().token };
  };
  const author = await register();
  const other = await register();

  // Invalid name (profanity) → 400.
  const bad = await app.inject({
    method: 'POST', url: '/api/community/levels', headers: author,
    payload: { seed, name: 'shitty garden' },
  });
  assert.equal(bad.statusCode, 400);

  // Invalid seed → 400.
  const badSeed = await app.inject({
    method: 'POST', url: '/api/community/levels', headers: author,
    payload: { seed: -5, name: 'Nice Garden' },
  });
  assert.equal(badSeed.statusCode, 400);

  // Valid publish → 200.
  const pub = await app.inject({
    method: 'POST', url: '/api/community/levels', headers: author,
    payload: { seed, name: 'Mochi Meadow' },
  });
  assert.equal(pub.statusCode, 200);
  const levelId = pub.json().level.id;

  // Duplicate publish (same author + seed) → 409.
  const dup = await app.inject({
    method: 'POST', url: '/api/community/levels', headers: author,
    payload: { seed, name: 'Mochi Meadow Again' },
  });
  assert.equal(dup.statusCode, 409);

  // Listing shows it; author sees mine=true.
  const list = await app.inject({ method: 'GET', url: '/api/community/levels?sort=new', headers: author });
  assert.equal(list.statusCode, 200);
  const mineRow = list.json().levels.find(l => l.id === levelId);
  assert.ok(mineRow && mineRow.mine);

  // Author cannot like own garden.
  const selfLike = await app.inject({ method: 'POST', url: `/api/community/levels/${levelId}/like`, headers: author, payload: {} });
  assert.equal(selfLike.statusCode, 400);

  // Another player likes, then unlikes (toggle).
  const like1 = await app.inject({ method: 'POST', url: `/api/community/levels/${levelId}/like`, headers: other, payload: {} });
  assert.equal(like1.json().liked, true);
  assert.equal(like1.json().likes, 1);
  const like2 = await app.inject({ method: 'POST', url: `/api/community/levels/${levelId}/like`, headers: other, payload: {} });
  assert.equal(like2.json().liked, false);
  assert.equal(like2.json().likes, 0);

  // Author cannot report own garden; another player can.
  const selfReport = await app.inject({ method: 'POST', url: `/api/community/levels/${levelId}/report`, headers: author, payload: { reason: 'x' } });
  assert.equal(selfReport.statusCode, 400);
  const report = await app.inject({ method: 'POST', url: `/api/community/levels/${levelId}/report`, headers: other, payload: { reason: 'spam' } });
  assert.equal(report.statusCode, 200);

  // Publish a second garden so we can exercise "mine" and pagination.
  let seed2 = 0;
  for (let s = seed + 1; s <= 40 && !seed2; s++) {
    const lv = core.generateLevel(s, { name: 'x' });
    if (lv && lv.target >= 12) seed2 = s;
  }
  assert.ok(seed2, 'expected a second good seed');
  const pub2 = await app.inject({
    method: 'POST', url: '/api/community/levels', headers: author,
    payload: { seed: seed2, name: 'Second Garden' },
  });
  assert.equal(pub2.statusCode, 200);

  // "Mine" scope returns only the author's gardens; another player sees none.
  const mine = await app.inject({ method: 'GET', url: '/api/community/levels?mine=1', headers: author });
  assert.equal(mine.statusCode, 200);
  assert.equal(mine.json().levels.length, 2);
  assert.ok(mine.json().levels.every(l => l.mine));
  const otherMine = await app.inject({ method: 'GET', url: '/api/community/levels?scope=mine', headers: other });
  assert.equal(otherMine.json().levels.length, 0);

  // Pagination: limit=1 yields hasMore, and skip=1 returns a different page.
  const p0 = await app.inject({ method: 'GET', url: '/api/community/levels?sort=new&limit=1&skip=0', headers: author });
  const p1 = await app.inject({ method: 'GET', url: '/api/community/levels?sort=new&limit=1&skip=1', headers: author });
  assert.equal(p0.json().levels.length, 1);
  assert.equal(p0.json().hasMore, true);
  assert.equal(p1.json().levels.length, 1);
  assert.notEqual(p0.json().levels[0].id, p1.json().levels[0].id);
});
