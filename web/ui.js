/* ============================================================
   Purrimeter — UI layer (browser only)
   ============================================================ */
(function () {
  if (typeof document === 'undefined') return;

  // ---------- storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('purr_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('purr_' + k, JSON.stringify(v)); } catch (e) {} },
  };
  let settings = store.get('settings', { name: 'You' });
  const legacyKeyField = 'api' + 'Key';
  if (settings[legacyKeyField] || settings.provider || settings.model) {
    settings = { name: settings.name || 'You' };
    store.set('settings', settings);
  }

  // ---------- production API ----------
  function apiBase() {
    if (window.PURRIMETER_API_BASE) return window.PURRIMETER_API_BASE.replace(/\/$/, '');
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3000';
    return `${location.protocol}//api.${h.replace(/^www\./, '')}`;
  }
  const API_BASE = apiBase();
  let auth = store.get('auth', null);
  async function apiFetch(path, opts = {}) {
    const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
    if (auth && auth.token) headers.authorization = 'Bearer ' + auth.token;
    const res = await fetch(API_BASE + path, { ...opts, headers, credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `API ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  async function ensureAuth() {
    if (auth && auth.token) return auth;
    const created = await apiFetch('/api/register', { method: 'POST', body: '{}' });
    auth = created;
    store.set('auth', auth);
    return auth;
  }
  async function loadMe() {
    try {
      await ensureAuth();
      const me = await apiFetch('/api/me');
      S.me = me; S.online = true;
      if (me.name && me.name !== 'Anonymous' && settings.name !== me.name) {
        settings.name = me.name; store.set('settings', settings);
      }
      connectLive();
      return me;
    } catch (e) {
      S.online = false;
      return null;
    } finally {
      S.booting = false;
    }
  }

  // ---------- game state ----------
  const S = {
    view: 'home',          // home | game | ranks | community | settings | archive
    mode: 'campaign',      // campaign | daily | archive | community | tutorial
    level: null, levelIndex: 0,
    fences: new Set(), undo: [],
    roam: false, submitted: false, result: null,
    showOverlay: false,
    review: 'mine',        // mine | optimal
    day: dayNumber(), dailyLv: null,
    archiveDay: null,      // which past daily is being played (mode 'archive')
    lbTab: 'global',
    online: false, me: null,
    leaderboard: null, liveStats: null,
    friends: null, friendsLoading: false,
    submitting: false, booting: true,
    communityTab: 'top',        // top | new | mine | create
    community: { top: null, new: null, mine: null }, // each: { items, hasMore } | null
    communityLoading: false,
    draft: null,                // { seed, lv, name } generated preview awaiting publish
    animKey: '',           // board entrance animation guard
    lastFence: null,       // only the newest fence pops
  };

  const $ = sel => document.querySelector(sel);
  const app = () => $('#app');
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  let liveSocket = null;
  function connectLive() {
    if (liveSocket || !S.online) return;
    const scriptId = 'socket-io-client';
    const start = () => {
      if (!window.io || liveSocket) return;
      liveSocket = window.io(API_BASE, { transports: ['websocket'], query: { day: S.day } });
      liveSocket.on('daily:stats', msg => {
        if (msg.day === S.day) {
          S.liveStats = msg.stats;
          if (S.view === 'ranks') refreshLeaderboard();
        }
      });
      liveSocket.on('daily:solved', msg => {
        if (msg.day === S.day) {
          toast(`${msg.name} scored ${msg.score}`);
          if (S.view === 'ranks') refreshLeaderboard();
        }
      });
    };
    if (window.io) return start();
    if (!document.getElementById(scriptId)) {
      const s = document.createElement('script');
      s.id = scriptId;
      s.src = API_BASE + '/socket.io/socket.io.js';
      s.onload = start;
      document.head.appendChild(s);
    }
  }

  // ---------- daily level (cached, incl. optimal solution) ----------
  function getDaily() {
    if (S.dailyLv) return S.dailyLv;
    const cached = store.get('dailycache', null);
    if (cached && cached.day === S.day) {
      S.dailyLv = parseLevel(cached.def);
      S.dailyLv.target = cached.target;
      S.dailyLv.solution = cached.sol || null;
    } else {
      const lv = generateLevel(S.day * 2654435761 % 2 ** 31);
      lv.name = 'Daily #' + S.day;
      store.set('dailycache', { day: S.day, target: lv.target, sol: lv.solution, def: { name: lv.name, walls: lv.walls, map: lv.map } });
      S.dailyLv = lv;
    }
    return S.dailyLv;
  }
  const dailyResult = (day = S.day) => store.get('daily_' + day, null);
  async function getOnlineDaily(day = S.day) {
    await ensureAuth();
    const data = await apiFetch('/api/daily?day=' + encodeURIComponent(day));
    const lv = parseLevel(data.def);
    lv.name = data.def.name || ('Daily #' + day);
    if (data.target) lv.target = data.target;
    if (data.solution) lv.solution = data.solution;
    S.dailyLv = lv;
    store.set('dailycache', { day, def: data.def, target: data.target || null, sol: data.solution || null });
    if (data.result) {
      const result = { ...data.result, target: data.target };
      store.set('daily_' + day, result);
    }
    S.online = true;
    return { lv, result: data.result || null, target: data.target, solution: data.solution };
  }

  // Ensure we have the best-known solution for the current level (campaign: cached).
  function ensureSolution() {
    const lv = S.level;
    if (lv.solution && lv.solution.length) return lv.solution;
    if (S.mode === 'campaign') {
      const cached = store.get('sol_' + S.levelIndex, null);
      if (cached) { lv.solution = cached; return cached; }
    }
    const sol = solve(lv, { iters: 15000, restarts: 6, seed: 7 });
    lv.solution = [...sol.fences];
    if (sol.best > (lv.target || 0)) lv.target = sol.best;
    if (S.mode === 'campaign') store.set('sol_' + S.levelIndex, lv.solution);
    if (S.mode === 'daily') {
      const cached = store.get('dailycache', null);
      if (cached && cached.day === S.day) { cached.sol = lv.solution; store.set('dailycache', cached); }
    }
    return lv.solution;
  }

  // ---------- stats ----------
  function stats() { return store.get('stats', { played: 0, three: 0, streak: 0, lastDay: 0, bestScore: 0 }); }
  function campaignFrontier(prog = store.get('campaign', {})) {
    const i = CAMPAIGN.findIndex((_, idx) => !(prog[idx] && prog[idx].stars));
    return i < 0 ? CAMPAIGN.length - 1 : i;
  }
  function isCampaignUnlocked(i, prog = store.get('campaign', {})) {
    return i <= campaignFrontier(prog) || !!(prog[i] && prog[i].stars);
  }
  function bumpStats(score, starsN, isDaily) {
    const st = stats();
    st.played++; if (starsN === 3) st.three++;
    st.bestScore = Math.max(st.bestScore, score);
    if (isDaily) {
      st.streak = (st.lastDay === S.day - 1) ? st.streak + 1 : 1;
      st.lastDay = S.day;
    }
    store.set('stats', st);
  }

  // ---------- start games ----------
  function startCampaign(i) {
    if (!isCampaignUnlocked(i)) { toast('Clear the next garden to unlock this one.'); return; }
    S.mode = 'campaign'; S.levelIndex = i; S.level = CAMPAIGN[i];
    resetPlay(); S.view = 'game'; render();
  }

  // ---------- tutorial ----------
  const TUT_STEPS = [
    { type: 'info', msg: 'Meet Mochi 🐈 — she wanders ⬆️⬇️⬅️➡️ (never diagonally). If she can reach the edge of the garden, she escapes!' },
    { type: 'info', msg: 'Your job: trap her in the biggest possible meadow. The pond blocks her for free — cats hate water — so only the open side needs fences.' },
    { type: 'fence', cell: [1, 4], msg: 'Tap the glowing tile to place your first fence.' },
    { type: 'fence', cell: [2, 4], msg: 'Nice! Keep building the wall downward.' },
    { type: 'fence', cell: [3, 3], msg: 'Step it inward diagonally — diagonal gaps are safe, Mochi can’t cut corners!' },
    { type: 'fence', cell: [4, 2], msg: 'One more to seal the meadow.' },
    { type: 'info', msg: 'She’s enclosed! The glowing tiles are her meadow — each one is a point. In later gardens: 🧶+3 · 🐟+10 · 🥒−5.' },
    { type: 'done', msg: 'A cozy 7-point meadow. Tap ✓ Submit to lock in your score!' },
  ];
  function startTutorial() {
    S.mode = 'tutorial'; S.levelIndex = 0; S.level = CAMPAIGN[0];
    resetPlay(); S.tutStep = 0; S.view = 'game'; render();
  }
  const tutStep = () => S.mode === 'tutorial' && !S.submitted ? TUT_STEPS[S.tutStep] : null;
  function tutAdvance() { S.tutStep = Math.min(S.tutStep + 1, TUT_STEPS.length - 1); }
  async function startDaily() {
    S.mode = 'daily';
    try {
      const online = await getOnlineDaily(S.day);
      S.level = online.lv;
    } catch (e) {
      S.online = false;
      S.level = getDaily();
      toast('Offline daily preview. Connect to submit.');
    }
    resetPlay();
    const r = dailyResult();
    if (r) { S.submitted = true; S.result = r; S.fences = new Set(r.fences); S.showOverlay = true; }
    S.view = 'game'; render();
  }
  const dailySeed = day => day * 2654435761 % 2 ** 31;
  async function startArchive(day) {
    if (day === S.day) { startDaily(); return; }
    let lv;
    try {
      await ensureAuth();
      const data = await apiFetch('/api/archive/' + encodeURIComponent(day));
      lv = parseLevel(data.def);
      lv.target = data.target || undefined;
      lv.solution = data.solution || null;
      if (data.result) store.set('daily_' + day, { ...data.result, archived: true });
      S.online = true;
    } catch (e) {
      S.online = false;
      lv = generateLevel(dailySeed(day));
      lv.name = 'Daily #' + day;
      toast('Offline archive preview. Connect to submit.');
    }
    S.mode = 'archive'; S.archiveDay = day; S.level = lv;
    resetPlay();
    const r = dailyResult(day);
    if (r) { S.submitted = true; S.result = r; S.fences = new Set(r.fences); S.showOverlay = true; }
    S.view = 'game'; render();
  }
  function resetPlay() {
    S.fences = new Set(); S.undo = []; S.submitted = false;
    S.result = null; S.showOverlay = false; S.review = 'mine'; S.lastFence = null;
    S.wasEnclosed = false;
  }

  // Fences currently displayed on the board (yours vs. optimal review)
  function displayedFences() {
    if (S.submitted && S.review === 'optimal' && S.level.solution) return new Set(S.level.solution);
    return S.fences;
  }

  // ---------- interactions ----------
  function tileTap(r, c) {
    if (S.submitted) return;
    const lv = S.level, k = key(r, c);
    const step = tutStep();
    if (step) { // tutorial: only the scripted tile is interactive
      if (step.type !== 'fence') { nudgeTut(); return; }
      if (r !== step.cell[0] || c !== step.cell[1]) { nudgeHintTile(); return; }
      S.fences.add(k); S.lastFence = k; tutAdvance(); render();
      return;
    }
    if (r === lv.cat[0] && c === lv.cat[1]) return;
    const ch = cellCh(lv, r, c);
    if (ch === '~' || ch === '#') return;
    if (S.fences.has(k)) {
      S.fences.delete(k); S.undo.push({ op: 'del', k }); S.lastFence = null;
    } else {
      if (S.fences.size >= lv.walls) { nudgeHud(); return; }
      S.fences.add(k); S.undo.push({ op: 'add', k }); S.lastFence = k;
    }
    updateBoard();
  }
  function nudgeHud() {
    const h = $('#hud'); if (!h) return;
    h.style.animation = 'none'; void h.offsetWidth; h.style.animation = 'shake .35s';
  }
  // Tutorial: the player tapped while a "read this first" step is up.
  function nudgeTut() {
    const b = $('#tut-banner');
    if (b) { b.style.animation = 'none'; void b.offsetWidth; b.style.animation = 'tutNudge .45s'; }
    toast('👆 Read the tip, then tap “Got it”');
  }
  // Tutorial: the player tapped a non-target tile during a fence step.
  function nudgeHintTile() {
    const t = document.querySelector('#board .tile.hint');
    if (!t) return;
    t.classList.remove('tap-wrong'); void t.offsetWidth; t.classList.add('tap-wrong');
    toast('👆 Tap the glowing tile');
  }
  function undo() {
    const u = S.undo.pop(); if (!u || S.submitted) return;
    if (u.op === 'add') S.fences.delete(u.k); else S.fences.add(u.k);
    S.lastFence = null; updateBoard();
  }
  function scoreBreakdown(lv, ev) {
    let tiles = 0, ny = 0, nt = 0, nu = 0, boxes = 0;
    for (const k of ev.reachable) {
      tiles++;
      const ch = cellCh(lv, Math.floor(k / 100), k % 100);
      if (ch === 'y') ny++; else if (ch === 't') nt++;
      else if (ch === 'u') nu++; else if (ch >= '1' && ch <= '3') boxes++;
    }
    const lines = [{ label: `🌱 ${tiles} meadow tile${tiles === 1 ? '' : 's'}`, pts: tiles }];
    if (ny) lines.push({ label: `🧶 yarn ×${ny}`, pts: 3 * ny });
    if (nt) lines.push({ label: `🐟 tuna ×${nt}`, pts: 10 * nt });
    if (nu) lines.push({ label: `🥒 cucumber ×${nu}`, pts: -5 * nu });
    return { tiles, yarn: ny, tuna: nt, cucumber: nu, boxes, lines };
  }
  async function submit() {
    const ev = evaluate(S.level, S.fences);
    if (ev.escaped || S.submitted || S.submitting) return;
    if (S.mode === 'daily' || S.mode === 'archive') {
      S.submitting = true;
      const btn = $('#btn-submit');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Submitting…'; }
      try {
        await ensureAuth();
        const path = S.mode === 'daily' ? '/api/daily/submit' : `/api/archive/${S.archiveDay}/submit`;
        const body = S.mode === 'daily'
          ? { day: S.day, fences: [...S.fences] }
          : { fences: [...S.fences] };
        const server = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
        S.level.target = server.target;
        S.level.solution = server.solution || null;
        S.result = {
          score: server.score,
          stars: server.stars,
          fences: server.fences,
          walls: server.walls,
          breakdown: server.breakdown || scoreBreakdown(S.level, ev).lines,
          rank: server.rank,
        };
        S.submitted = true; S.showOverlay = true; S.review = 'mine';
        bumpStats(server.score, server.stars, S.mode === 'daily');
        const hist = store.get('history', []);
        hist.push({ mode: S.mode, day: S.mode === 'daily' ? S.day : S.archiveDay, score: server.score, target: server.target, stars: server.stars, t: Date.now() });
        store.set('history', hist.slice(-200));
        store.set('daily_' + (S.mode === 'daily' ? S.day : S.archiveDay), { ...S.result, archived: S.mode === 'archive', target: server.target });
        if (server.stars === 3) confetti();
        refreshLeaderboard();
        render();
      } catch (e) {
        if (e.status === 409) {
          toast('Daily already submitted. Loading your result.');
          S.dailyLv = null;
          await startDaily();
        } else {
          toast(e.message || 'Network submit failed');
          const b = $('#btn-submit');
          if (b) { b.disabled = false; b.textContent = '✓ Submit'; }
        }
      } finally {
        S.submitting = false;
      }
      return;
    }
    if (S.mode === 'tutorial') store.set('tutorialDone', true);
    const target = S.level.target || ev.score;
    const starsN = ev.score >= target ? 3 : ev.score >= Math.ceil(0.8 * target) ? 2 : 1;
    const breakdown = scoreBreakdown(S.level, ev).lines;
    S.result = { score: ev.score, stars: starsN, fences: [...S.fences], walls: S.level.walls, breakdown };
    S.submitted = true; S.showOverlay = true; S.review = 'mine';
    bumpStats(ev.score, starsN, S.mode === 'daily');
    // personal submission history (for the stats screen)
    const hist = store.get('history', []);
    hist.push({ mode: S.mode, day: S.day, score: ev.score, target, stars: starsN, t: Date.now() });
    store.set('history', hist.slice(-200));
    if (S.mode === 'daily') store.set('daily_' + S.day, S.result);
    if (S.mode === 'archive') {
      // archived dailies keep your best result, never touch the streak
      const prev = store.get('daily_' + S.archiveDay, null);
      if (!prev || ev.score > prev.score) store.set('daily_' + S.archiveDay, { ...S.result, archived: true });
    }
    if (S.mode === 'campaign' || S.mode === 'tutorial') {
      const prog = store.get('campaign', {});
      const p = prog[S.levelIndex] || { score: 0, stars: 0 };
      prog[S.levelIndex] = { score: Math.max(p.score, ev.score), stars: Math.max(p.stars, starsN) };
      store.set('campaign', prog);
    }
    if (starsN === 3) confetti();
    render();
  }
  function confetti() {
    const em = ['🎉', '⭐', '🐾', '🧶', '✨'];
    for (let i = 0; i < 26; i++) {
      const d = document.createElement('div');
      d.className = 'confetti'; d.textContent = em[i % em.length];
      d.style.left = Math.random() * 100 + 'vw';
      d.style.animationDuration = 1.8 + Math.random() * 1.6 + 's';
      d.style.animationDelay = Math.random() * 0.5 + 's';
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 4200);
    }
  }

  // ---------- share ----------
  function currentShare() {
    const r = S.result; if (!r) return '';
    let body;
    if (S.mode === 'daily' || S.mode === 'archive') {
      const day = S.mode === 'archive' ? S.archiveDay : S.day;
      const base = shareText(day, settings.name || 'You', r.score, S.level.target, r.stars, r.fences.length, r.walls, S.level)
        .replace(/\ncode: PURR-[A-Za-z0-9+/]+$/, '');
      body = base + (S.me && S.me.friendCode ? '\ncode: ' + S.me.friendCode : '');
    } else {
      // non-daily: same spoiler-safe puzzle picture, no friend code
      const starLine = '⭐'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
      const pct = Math.round(100 * r.score / S.level.target);
      body = `🐈 Purrimeter — ${S.level.name}\n${starLine} ${r.score} pts (${pct}% of optimal) · ${r.fences.length}/${r.walls} fences\n${levelEmojiGrid(S.level)}`;
    }
    return `${body}\n${location.origin}`;
  }
  async function copyText(txt, okMsg) {
    try {
      await navigator.clipboard.writeText(txt);
      toast(okMsg || 'Copied to clipboard!');
    } catch (e) { toast('Copy failed — select the text manually'); }
  }
  async function shareOrCopy(txt, okMsg) {
    try {
      if (navigator.share) { await navigator.share({ text: txt }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    await copyText(txt, okMsg);
  }
  const doShare = () => shareOrCopy(currentShare());
  function inviteText() {
    const code = S.me && S.me.friendCode;
    return `🐈 Add me on Purrimeter — a daily "fence in the cat" puzzle!` +
      (code ? `\nMy friend code: ${code}` : '') +
      `\nPlay: ${location.origin}`;
  }
  const doInvite = () => shareOrCopy(inviteText(), 'Invite copied!');
  let toastTimer;
  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:86px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--bg1);padding:10px 18px;border-radius:999px;font-weight:800;z-index:70;font-size:14px';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 2200);
  }

  // ---------- AI generation ----------
  // Public AI calls were removed for production. Owner generation lives behind /admin.html.

  // ---------- rendering ----------
  function render() {
    const views = { home: renderHome, game: renderGame, ranks: renderRanks, community: renderCommunity, settings: renderSettings, archive: renderArchive };
    app().innerHTML = views[S.view]();
    bindNav();
    if (S.view === 'home') { const t = $('#btn-tutorial'); if (t) t.onclick = startTutorial; }
    if (S.view === 'game') { bindBoard(); animateOverlay(); primeBoard(); }
    if (S.view === 'community') bindCommunity();
    if (S.view === 'settings') bindSettings();
    if (S.view === 'ranks') bindRanks();
    updateConnPill();
  }
  function updateConnPill() {
    let pill = document.getElementById('conn-pill');
    if (S.online || S.booting) { if (pill) pill.remove(); return; }
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'conn-pill';
      pill.textContent = '⚠️ Offline — playing locally, scores won’t sync';
      document.body.appendChild(pill);
    }
  }

  function navBar() {
    if (S.view === 'game') return ''; // immersive play — no tab bar
    let items = [['ranks', '🏆', 'Ranks'], ['community', '🧩', 'Community'], ['settings', '⚙️', 'Settings']];
    if (S.view !== 'home') items = [['home', '🏡', 'Home'], ...items];
    return '<nav>' + items.map(([v, ico, label]) =>
      `<button data-nav="${v}" class="${S.view === v ? 'active' : ''}"><span class="ico">${ico}</span>${label}</button>`).join('') + '</nav>';
  }
  function bindNav() {
    document.querySelectorAll('button[data-nav]').forEach(b => b.onclick = () => { S.view = b.dataset.nav; render(); });
  }
  const starStr = n => '<span class="stars">' + '★'.repeat(n) + '<span class="off">' + '★'.repeat(3 - n) + '</span></span>';

  // --- home ---
  function renderHome() {
    const st = stats();
    const prog = store.get('campaign', {});
    const dr = dailyResult();
    const beaten = CAMPAIGN.filter((_, i) => prog[i] && prog[i].stars).length;
    const totalStars = CAMPAIGN.reduce((sum, _, i) => sum + ((prog[i] && prog[i].stars) || 0), 0);
    const progressPct = CAMPAIGN.length <= 1 ? 100 : Math.round(100 * Math.max(0, beaten - 1) / (CAMPAIGN.length - 1));
    const levelIcon = lv => {
      const flat = lv.map.join('');
      if (flat.includes('1')) return '📦';
      if (lv.target >= 39) return '🏆';
      if ((flat.match(/~/g) || []).length >= 8) return '🌊';
      if ((flat.match(/#/g) || []).length >= 6) return '🪨';
      if (flat.includes('t')) return '🐟';
      if (flat.includes('u')) return '🥒';
      return '🧶';
    };
    const daily = `
      <section class="daily-panel card">
        <div class="lv-item daily-feature" data-daily>
          <div class="lv-num daily">📅</div>
          <div class="grow">
            <h3>Daily Challenge #${S.day}</h3>
            <div class="small soft">${dr ? `Done: ${dr.score} pts ` + '★'.repeat(dr.stars) : 'One try. Same garden for everyone.'}</div>
          </div>
          <button class="btn primary">${dr ? 'View' : 'Play'}</button>
        </div>
        <div class="row" style="padding: 2px 12px 4px">
          <div class="grow small soft">Missed a day? Replay any past garden.</div>
          <button class="btn ghost" data-nav="archive">📚 Archive</button>
        </div>
      </section>`;
    // winding garden path: cat stands at the next unbeaten level
    const xs = [24, 72, 58, 30, 76, 24, 48, 70];
    const stepY = 122, padY = 92;
    const pathH = padY + stepY * (CAMPAIGN.length - 1) + 92;
    let catAt = campaignFrontier(prog);
    const pts = CAMPAIGN.map((_, i) => [xs[i % xs.length], padY + i * stepY]);
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      d += ` C ${x0} ${y0 + stepY * 0.55}, ${x1} ${y1 - stepY * 0.55}, ${x1} ${y1}`;
    }
    const nodes = CAMPAIGN.map((lv, i) => {
      const p = prog[i] || { stars: 0, score: 0 };
      const done = p.stars > 0;
      const unlocked = isCampaignUnlocked(i, prog);
      const state = done ? 'done' : i === catAt ? 'next' : 'locked';
      return `<div class="path-node ${done ? 'done' : ''} ${i === catAt ? 'next' : ''} ${unlocked ? '' : 'locked'}" data-lv="${i}"
        style="left:${pts[i][0]}%;top:${pts[i][1]}px">
        ${i === catAt ? '<div class="path-cat cat">🐈</div>' : ''}
        <div class="path-card">
          <div class="node-top">
            <span class="node-badge">${levelIcon(lv)}</span>
            <span class="node-meta">${state === 'done' ? 'Cleared' : state === 'next' ? 'Next' : 'Locked'}</span>
          </div>
          <b>${esc(lv.name)}</b>
          <span class="node-stats">${lv.rows}×${lv.cols} garden · ${lv.walls} fences</span>
          <span class="stars small">${'★'.repeat(p.stars)}<span class="off">${'★'.repeat(3 - p.stars)}</span></span>
        </div>
      </div>`;
    }).join('');
    const camp = `
      <section class="trail-card card">
        <div class="section-head">
          <div>
            <h3>Campaign Trail</h3>
            <div class="small soft">${beaten}/${CAMPAIGN.length} gardens cleared · ${totalStars}/${CAMPAIGN.length * 3} stars</div>
          </div>
          <div class="progress-pill">${Math.round(100 * beaten / CAMPAIGN.length)}%</div>
        </div>
        <div class="trail-progress"><span style="width:${Math.round(100 * beaten / CAMPAIGN.length)}%"></span></div>
        <div class="path-wrap" style="height:${pathH}px">
        <svg viewBox="0 0 100 ${pathH}" preserveAspectRatio="none">
          <path class="trail-shadow" d="${d}" fill="none"/>
          <path class="trail-path" d="${d}" fill="none" pathLength="100"/>
          <path class="trail-path trail-done" d="${d}" fill="none" pathLength="100" style="stroke-dasharray:${progressPct} 100"/>
        </svg>
        ${nodes}
        </div>
      </section>`;
    return `
      <section class="hero-card">
        <div>
          <div class="eyebrow">Enclosure puzzle</div>
          <h1>Purrimeter</h1>
          <p>Fence in the cat, claim the best meadow, and spend every fence with intent.</p>
        </div>
        <div class="hero-art" aria-hidden="true">
          <span class="hero-sun">☀</span>
          <span class="hero-cat cat">🐈</span>
          <span class="hero-fence">▥▥▥</span>
        </div>
      </section>
      <div class="stats home-stats">
        <div class="stat"><b>${st.played}</b><span>played</span></div>
        <div class="stat"><b>${st.streak}${st.streak > 1 ? '🔥' : ''}</b><span>daily streak</span></div>
        <div class="stat"><b>${st.three}</b><span>3-star</span></div>
        <div class="stat"><b>${st.bestScore}</b><span>best score</span></div>
      </div>
      ${daily}
      ${camp}
      <div class="card">
        <div class="row">
          <div class="grow small soft">
            <b style="color:var(--ink)">New here?</b> Learn the game in 30 seconds with a guided garden.
          </div>
          <button class="btn primary" id="btn-tutorial">🎓 Tutorial</button>
        </div>
      </div>
      <div class="card small soft">
        <b style="color:var(--ink)">Quick rules:</b> tap grass to place fences. The cat moves ↑↓←→ only — if it reaches the edge, it escapes.
        Once it's trapped, its meadow lights up: every glowing tile is a point, plus 🧶+3 · 🐟+10 · 🥒−5 · 📦 teleports.
        Diagonal gaps are safe!
      </div>
      ${navBar()}`;
  }

  // --- game ---
  const DECO = ['🌼', '🌿', '🌸', '🍄'];
  function decoFor(lv, r, c) {
    let h = r * 73 + c * 151 + lv.map.length * 7 + lv.walls * 13;
    h = (h * 2654435761) >>> 0;
    if ((h % 100) < 14) return DECO[h % DECO.length];
    return null;
  }
  // Pure description of one tile — shared by the full render and the incremental update.
  function computeTile(lv, r, c, ev, ctx) {
    const ch = cellCh(lv, r, c), k = key(r, c);
    const fenced = ctx.shown.has(k);
    const isCat = r === lv.cat[0] && c === lv.cat[1];
    let cls = 'tile ';
    if (ch === '~') cls += 'water';
    else if (ch === '#') cls += 'rock grass-' + ((r + c) % 2 ? 'b' : 'a');
    else cls += 'grass-' + ((r + c) % 2 ? 'b' : 'a');
    if (fenced) cls += ' fence' + (ctx.optimalView ? ' optimal' : '');
    else if (ch !== '~' && ch !== '#') cls += ' placeable';
    const inMeadow = !ev.escaped && ev.reachable.has(k);
    if (inMeadow) cls += ' roam' + (ctx.justEnclosed ? ' pop' : '');
    if (ctx.step && ctx.step.type === 'fence' && r === ctx.step.cell[0] && c === ctx.step.cell[1]) cls += ' hint';
    let inner = '';
    const deco = ch === '.' && !isCat ? decoFor(lv, r, c) : null;
    if (deco && !fenced && !inMeadow) inner += `<span class="deco">${deco}</span>`;
    // inside the pen, plain grass turns into a hay field (enclose.horse-style biome change)
    if (inMeadow && !fenced && !isCat && ch === '.' && (r * 7 + c * 13) % 4 !== 0) inner += '<span class="wheat">🌾</span>';
    if (fenced) inner += `<div class="fpost${k === S.lastFence && !ctx.optimalView ? ' new' : ''}"></div>`;
    else if (isCat) inner += '<span class="cat tile-cat">🐈</span>';
    else if (ch === 'y') inner += '<span class="item goodie">🧶</span>'; else if (ch === 't') inner += '<span class="item goodie">🐟</span>';
    else if (ch === 'u') inner += '<span class="item baditem">🥒</span>'; else if (ch >= '1' && ch <= '3') inner += `<span class="item boxitem">📦<em>${ch}</em></span>`;
    let info = '';
    if (fenced) info = '🚧 Your fence — tap to remove it';
    else if (isCat) info = '🐈 Mochi — enclose her before she reaches the edge!';
    else if (ch === 'y') info = '🧶 Yarn — +3 points if it ends up inside your fence';
    else if (ch === 't') info = '🐟 Tuna — +10 points if enclosed. Worth going for!';
    else if (ch === 'u') info = '🥒 Cucumber — −5 points if enclosed. Keep it out, or fence on top of it';
    else if (ch >= '1' && ch <= '3') info = `📦 Box ${ch} — the cat teleports between matching boxes`;
    else if (ch === '~') info = '🌊 Pond — blocks the cat. A free wall!';
    else if (ch === '#') info = '🪨 Rock — blocks the cat. A free wall!';
    const meadowDelay = inMeadow && ctx.justEnclosed
      ? (Math.abs(r - lv.cat[0]) + Math.abs(c - lv.cat[1])) * 55 : null;
    return { cls, inner, info, meadowDelay };
  }
  function statusHTML(ev, optimalView) {
    return optimalView
      ? `<span id="status" class="gold">🏆 Optimal: ${ev.score} pts</span>`
      : ev.escaped
        ? '<span id="status" class="bad">🚨 Cat can escape!</span>'
        : `<span id="status" class="ok">✅ ${ev.score} pts</span>`;
  }
  const pipsHTML = (lv, shown) =>
    Array.from({ length: lv.walls }, (_, i) => `<div class="pip ${i < shown.size ? 'used' : ''}"></div>`).join('');

  // After a full render, record each tile's expected class/inner so the first
  // incremental update doesn't see them as "changed" and rewrite the whole board.
  function primeBoard() {
    const board = $('#board');
    if (!board || !S.level) return;
    const lv = S.level;
    const shown = displayedFences();
    const ev = evaluate(lv, shown);
    const ctx = { shown, optimalView: S.submitted && S.review === 'optimal', step: tutStep(), justEnclosed: false };
    board.querySelectorAll('.tile').forEach(el => {
      const t = computeTile(lv, +el.dataset.r, +el.dataset.c, ev, ctx);
      el._c = t.cls; el._h = t.inner;
    });
  }

  // Incremental board update: touches ONLY changed tiles so running CSS animations
  // (water shimmer, cat bob, item wobble, wheat) never restart on unrelated tiles.
  function updateBoard() {
    const board = $('#board');
    if (S.view !== 'game' || !board) { render(); return; }
    const lv = S.level;
    const shown = displayedFences();
    const ev = evaluate(lv, shown);
    const justEnclosed = !ev.escaped && !S.wasEnclosed;
    S.wasEnclosed = !ev.escaped;
    const ctx = { shown, optimalView: S.submitted && S.review === 'optimal', step: tutStep(), justEnclosed };
    board.querySelectorAll('.tile').forEach(el => {
      const r = +el.dataset.r, c = +el.dataset.c;
      const t = computeTile(lv, r, c, ev, ctx);
      if (el._c !== t.cls) { el.className = t.cls; el._c = t.cls; }
      if (el._h !== t.inner) { el.innerHTML = t.inner; el._h = t.inner; }
      if (t.info) { el.dataset.info = t.info; el.title = t.info; }
      else { delete el.dataset.info; el.removeAttribute('title'); }
      el.style.animationDelay = t.meadowDelay !== null ? t.meadowDelay + 'ms' : '';
    });
    const pips = $('#hud .pips'); if (pips) pips.innerHTML = pipsHTML(lv, shown);
    const st = $('#status'); if (st) st.outerHTML = statusHTML(ev, ctx.optimalView);
    const sub = $('#game-sub'); if (sub && !S.submitted) sub.textContent = `${lv.walls - S.fences.size} of ${lv.walls} fences left`;
    const undoB = $('#btn-undo'); if (undoB) undoB.disabled = !S.undo.length;
    const resetB = $('#btn-reset'); if (resetB) resetB.disabled = !S.fences.size;
    const subB = $('#btn-submit');
    if (subB && !ctx.step) {
      subB.disabled = ev.escaped;
      subB.classList.toggle('ready', !ev.escaped && !S.submitted);
    }
  }

  function renderGame() {
    const lv = S.level;
    const shown = displayedFences();
    const ev = evaluate(lv, shown);
    const optimalView = S.submitted && S.review === 'optimal';
    const step = tutStep();
    const status = statusHTML(ev, optimalView);
    const pips = pipsHTML(lv, shown);
    const ts = Math.min(46, Math.floor((Math.min(window.innerWidth, 560) - 60) / lv.cols));
    const freshBoard = S.animKey !== S.mode + lv.name;
    S.animKey = S.mode + lv.name;
    const justEnclosed = !ev.escaped && !S.wasEnclosed && !freshBoard;
    S.wasEnclosed = !ev.escaped;
    const ctx = { shown, optimalView, step, justEnclosed };
    let tiles = '';
    for (let r = 0; r < lv.rows; r++) for (let c = 0; c < lv.cols; c++) {
      const t = computeTile(lv, r, c, ev, ctx);
      const cls = t.cls + (freshBoard ? ' enter' : '');
      let delay = '';
      if (freshBoard) delay = `animation-delay:${(r + c) * 28}ms`;
      else if (t.meadowDelay !== null) delay = `animation-delay:${t.meadowDelay}ms`;
      const infoAttr = t.info ? ` data-info="${t.info}" title="${t.info}"` : '';
      tiles += `<div class="${cls}" data-r="${r}" data-c="${c}"${infoAttr} style="${delay}">${t.inner}</div>`;
    }
    const tutDots = TUT_STEPS.map((_, i) =>
      `<span class="${i < S.tutStep ? 'done' : i === S.tutStep ? 'on' : ''}"></span>`).join('');
    const tutBanner = step ? `
      <div class="card tut-banner" id="tut-banner">
        <div class="row">
          <div class="tut-icon">🎓</div>
          <div class="grow tut-msg">${esc(step.msg)}</div>
          ${step.type === 'info' ? '<button class="btn primary attn" id="tut-next">Got it</button>' : ''}
        </div>
        <div class="tut-dots">${tutDots}</div>
      </div>` : '';
    const overlay = S.submitted && S.showOverlay ? renderResultOverlay() : '';
    const nextInBar = (S.mode === 'campaign' || S.mode === 'tutorial') && S.levelIndex < CAMPAIGN.length - 1
      ? '<button class="btn primary" id="btn-next-bar">Next level ▶</button>' : '';
    const canEditBar = S.mode !== 'daily' && S.mode !== 'tutorial' && S.result && S.result.score < lv.target;
    const continueInBar = S.submitted && canEditBar
      ? '<button class="btn" id="btn-continue-bar">✏️ Keep improving</button>' : '';
    const reviewBar = S.submitted && !S.showOverlay ? `
      <div class="actions review-bar">
        <button class="btn toggled" id="btn-review-toggle">${S.review === 'mine'
          ? `🏆 View optimal (${lv.target})`
          : `🐾 View yours (${S.result.score})`}</button>
        ${continueInBar}
        <button class="btn" id="btn-results">🏁 Results</button>
        ${nextInBar}
      </div>` : '';
    const playActions = !S.submitted ? `
      <div class="actions">
        ${step ? '' : `<button class="btn" id="btn-undo" ${S.undo.length ? '' : 'disabled'}>↶ Undo</button>`}
        ${step ? '' : `<button class="btn" id="btn-reset" ${S.fences.size ? '' : 'disabled'}>↺ Reset</button>`}
        <button class="btn good ${step && step.type === 'done' ? 'attn' : ''} ${!ev.escaped && !step ? 'ready' : ''}" id="btn-submit" ${ev.escaped || (step && step.type !== 'done') ? 'disabled' : ''}>✓ Submit</button>
      </div>` : '';
    return `
      <div class="row" style="margin-bottom:8px">
        <button class="btn ghost" data-nav="home">← ${step ? 'Skip' : 'Back'}</button>
        <div class="grow center"><b>${esc(step ? 'Tutorial' : lv.name)}</b>
          <div class="small soft" id="game-sub">${S.submitted ? `Optimal: ${lv.target} pts` : `${lv.walls - S.fences.size} of ${lv.walls} fences left`}</div></div>
        <span style="width:70px"></span>
      </div>
      ${tutBanner}
      <div id="hud"><div class="pips">${pips}</div>${status}</div>
      <div id="board-wrap" class="${step && step.type === 'info' && S.fences.size === 0 ? 'tut-wait' : ''}"><div id="board" style="--ts:${ts}px;grid-template-columns:repeat(${lv.cols},${ts}px)">${tiles}</div></div>
      <div id="tile-hint" class="center"> </div>
      ${optimalView ? '<div class="center small soft" style="margin-bottom:6px">✨ Best-known solution found by the solver</div>' : ''}
      ${playActions}${reviewBar}
      ${overlay}${navBar()}`;
  }
  function renderResultOverlay() {
    const r = S.result;
    const perfect = r.score >= S.level.target;
    const share = currentShare();
    const pct = Math.round(100 * r.score / S.level.target);
    const lbBtn = S.mode === 'daily' ? '<button class="btn" data-nav="ranks">🏆 Ranks</button>' : '';
    const canEdit = S.mode !== 'daily' && S.mode !== 'tutorial';
    const keepGoing = canEdit && !perfect ? '<button class="btn" id="btn-continue">✏️ Keep improving</button>' : '';
    const retry = canEdit ? '<button class="btn ghost" id="btn-retry">↺ Start over</button>' : '';
    const isCamp = S.mode === 'campaign' || S.mode === 'tutorial';
    const nextBtn = isCamp && S.levelIndex < CAMPAIGN.length - 1
      ? `<button class="btn primary" id="btn-next">Next level ▶</button>` : '';
    const communityNext = S.mode === 'community' ? '<button class="btn" data-nav="community">🧩 More gardens</button>' : '';
    const archBtn = S.mode === 'archive' ? '<button class="btn" data-nav="archive">📚 Archive</button>' : '';
    // community comparison (daily only; live server stats)
    let community = '';
    if (S.mode === 'daily') {
      const stats = S.liveStats || S.leaderboard?.stats;
      community = stats
        ? `<div class="small soft" style="margin-top:4px">Community today: <b>${stats.count}</b> solves · avg <b>${stats.average || '—'}</b>${r.rank ? ` · rank <b>#${r.rank}</b>` : ''}</div>`
        : `<div class="small soft" style="margin-top:4px">Submit recorded. Open Ranks for live standings.</div>`;
    }
    const bd = (r.breakdown || []).map((b, i) =>
      `<div class="bd-line" style="animation-delay:${350 + i * 380}ms">
        <span>${esc(b.label)}</span><span class="bd-pts ${b.pts < 0 ? 'neg' : ''}">${b.pts >= 0 ? '+' : ''}${b.pts}</span>
      </div>`).join('');
    const starsHtml = [0, 1, 2].map(i =>
      `<span class="pop-star ${i < r.stars ? '' : 'off'}" style="animation-delay:${300 + i * 220}ms">★</span>`).join('');
    return `<div id="overlay"><div class="card center">
      <h2 style="font-size:26px">${perfect ? 'Purrfect! 🐾' : 'Enclosed!'}</h2>
      <div class="bigstars">${starsHtml}</div>
      <div class="bd-list">${bd}</div>
      <div style="font-size:22px;font-weight:900;margin:4px"><span id="score-count">0</span> points</div>
      <div class="small soft">Optimal: ${S.level.target} — you got ${pct}%${perfect ? '' : '. See how below!'}</div>
      ${community}
      <div class="share-pre">${esc(share)}</div>
      <div class="actions">
        ${nextBtn}${keepGoing}
        <button class="btn" id="btn-see-optimal">👀 See optimal</button>
        <button class="btn" id="btn-share">📣 Share</button>
        ${lbBtn}${retry}${communityNext}${archBtn}
        <button class="btn ghost" id="btn-close-overlay">✕ Close</button>
      </div>
    </div></div>`;
  }
  function animateOverlay() {
    const el = $('#score-count');
    if (!el || !S.result) return;
    const lines = (S.result.breakdown || []).length;
    // tick sound as each breakdown line lands
    const startDelay = 350 + lines * 380;
    const target = S.result.score, dur = 800;
    setTimeout(() => {
      const t0 = performance.now();
      (function tick(t) {
        const p = Math.min(1, (t - t0) / dur);
        el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick);
      })(t0);
    }, startDelay);
  }
  function bindBoard() {
    const board = $('#board');
    const cellOf = el => el && el.closest ? el.closest('.tile') : null;
    // strictly one tap = one fence (no drag-painting)
    board.addEventListener('pointerdown', e => {
      const t = cellOf(e.target); if (!t) return;
      tileTap(+t.dataset.r, +t.dataset.c);
    });
    // hover hints for objects (desktop)
    const hint = $('#tile-hint');
    board.addEventListener('mouseover', e => {
      const t = cellOf(e.target);
      if (hint) hint.textContent = (t && t.dataset.info) || ' ';
    });
    board.addEventListener('mouseleave', () => { if (hint) hint.textContent = ' '; });
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    on('#tut-next', () => { tutAdvance(); render(); });
    on('#btn-undo', undo);
    on('#btn-submit', submit);
    on('#btn-reset', () => { if (!(S.submitted && S.mode === 'daily')) { resetPlay(); updateBoard(); } });
    on('#btn-retry', () => { resetPlay(); render(); });
    const keepImproving = () => {
      // keep the fences on the board, unlock editing, and let them refine
      S.submitted = false; S.result = null; S.showOverlay = false; S.review = 'mine';
      render();
    };
    on('#btn-continue', keepImproving);
    on('#btn-continue-bar', keepImproving);
    on('#btn-next', () => startCampaign(S.levelIndex + 1));
    on('#btn-next-bar', () => startCampaign(S.levelIndex + 1));
    on('#btn-share', doShare);
    on('#btn-close-overlay', () => { S.showOverlay = false; render(); });
    on('#btn-results', () => { S.showOverlay = true; S.review = 'mine'; render(); });
    on('#btn-review-toggle', () => {
      if (S.review === 'mine') { ensureSolution(); S.review = 'optimal'; }
      else S.review = 'mine';
      render();
    });
    on('#btn-see-optimal', () => {
      ensureSolution();
      S.showOverlay = false; S.review = 'optimal'; render();
    });
  }

  // --- daily archive ---
  const ARCHIVE_FREE = true; // future: gate old dailies behind premium
  function renderArchive() {
    const rows = [];
    for (let day = S.day; day >= Math.max(1, S.day - 60); day--) {
      const r = store.get('daily_' + day, null);
      const date = new Date(EPOCH_UTC + (day - 1) * 86400000)
        .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const isToday = day === S.day;
      const status = r
        ? `${r.score} pts ${'★'.repeat(r.stars)}${r.archived ? ' · replayed' : ''}`
        : isToday ? 'Not played yet' : 'Never played';
      rows.push(`
        <div class="lv-item" data-arch="${day}">
          <div class="lv-num ${isToday ? 'daily' : ''}">${isToday ? '📅' : day}</div>
          <div class="grow"><b>Daily #${day}</b>${isToday ? ' <span class="small soft">(today)</span>' : ''}
            <div class="small soft">${date} · ${esc(status)}</div></div>
          <button class="btn ${r && !isToday ? '' : 'primary'}">${isToday ? (r ? 'View' : 'Play') : r ? 'Replay' : 'Play'}</button>
        </div>`);
    }
    return `
      <h1 style="margin:10px 0">📚 Daily Archive</h1>
      <div class="small soft" style="margin-bottom:8px">Every past garden, replayable. Archived runs keep your best score and never affect your streak.${ARCHIVE_FREE ? ' Free during the beta.' : ''}</div>
      <div class="card">${rows.join('')}</div>
      ${navBar()}`;
  }

  // --- leaderboard ---
  function renderRanks() {
    const lv = getDaily();
    const dr = dailyResult();
    const rows = (S.leaderboard && S.leaderboard.scope === S.lbTab ? S.leaderboard.rows : []).map(r => ({
      ...r,
      me: S.me && r.playerId === S.me.playerId,
    }));
    const list = rows.length ? rows.map((r, i) =>
      `<div class="lb-row ${r.me ? 'me' : ''}">
        <div class="lb-rank">${i + 1}</div>
        <div class="grow"><b>${esc(r.name)}</b> ${r.me ? '<span class="small soft">(you)</span>' : ''}</div>
        ${starStr(r.stars)} <div class="lb-score">${r.score}</div>
      </div>`).join('')
      : `<div class="center soft" style="padding:20px">${S.online ? 'No entries yet today.' : 'Connecting to live ranks…'}</div>`;
    const stats = (S.leaderboard && S.leaderboard.stats) || S.liveStats;
    const buckets = stats?.buckets || [0, 0, 0, 0];
    const maxB = Math.max(1, ...buckets);
    const bLabels = ['<50%', '50–79%', '80–99%', 'optimal'];
    const histo = buckets.map((b, i) =>
      `<div class="bar-row"><span class="bar-label">${bLabels[i]}</span>
        <div class="bar-track"><div class="bar ${i === 3 ? 'bar-gold' : ''}" style="width:${Math.round(100 * b / maxB)}%"></div></div>
        <span class="bar-n">${b}</span></div>`).join('');
    const hist = store.get('history', []);
    const subs = hist.filter(h => h.target > 0);
    const avgPct = subs.length ? Math.round(100 * subs.reduce((a, h) => a + h.score / h.target, 0) / subs.length) : null;
    const myStats = `
      <div class="card">
        <h3>Your stats</h3>
        <div class="stats" style="margin-top:8px">
          <div class="stat"><b>${subs.length}</b><span>submissions</span></div>
          <div class="stat"><b>${avgPct === null ? '—' : avgPct + '%'}</b><span>avg of optimal</span></div>
          <div class="stat"><b>${subs.filter(h => h.stars === 3).length}</b><span>optimal solves</span></div>
        </div>
      </div>`;
    const community = `
      <div class="card">
        <h3>Today's community <span class="small soft">live</span></h3>
        <div class="small soft" style="margin:2px 0 8px">Submissions: <b>${stats?.count || 0}</b> · Average score: <b>${stats?.average || '—'}</b>${dr && lv.target ? ` · optimal is ${lv.target}` : ' · play to reveal the optimal!'}</div>
        ${histo}
      </div>`;
    return `
      <h1 style="margin:10px 0">🏆 Daily #${S.day}</h1>
      <div class="small soft" style="margin-bottom:8px">${dr ? `You scored ${dr.score} · optimal was ${lv.target}` : 'Not played yet — scores hide the optimal until you submit.'}</div>
      <div class="tabs">
        <button class="btn ${S.lbTab === 'global' ? 'primary' : ''}" data-tab="global">Global</button>
        <button class="btn ${S.lbTab === 'friends' ? 'primary' : ''}" data-tab="friends">Friends</button>
      </div>
      <div class="card">${list}</div>
      ${S.lbTab === 'friends' ? renderFriendsPanel() : `
      <div class="card small soft">Global scores are live server submissions. Daily scores are accepted once per player.</div>`}
      ${community}${myStats}
      ${navBar()}`;
  }
  function renderFriendsPanel() {
    const code = S.me && S.me.friendCode;
    const data = S.friends && S.friends.friends;
    let friendList;
    if (!data) friendList = '<div class="center soft" style="padding:14px">Loading friends…</div>';
    else if (!data.length) friendList = '<div class="center soft" style="padding:14px">No friends yet — share your code below to add some! 🐾</div>';
    else friendList = data.map(f => `
      <div class="lb-row">
        <div class="grow"><b>${esc(f.name)}</b>
          <div class="small soft">${f.daily ? `Today: ${f.daily.score} pts ${starStr(f.daily.stars)}` : 'Hasn’t played today'}</div></div>
        <button class="btn ghost btn-rmfriend" data-friend="${f.playerId}" title="Remove friend" aria-label="Remove ${esc(f.name)}">✕</button>
      </div>`).join('');
    return `
      <div class="card">
        <h3>Your friends</h3>
        ${friendList}
      </div>
      <div class="card">
        <h3>Invite friends</h3>
        <div class="small soft">Share your code. When they add it, you'll see each other's daily scores here.</div>
        ${code ? `
        <div class="row" style="margin-top:8px">
          <input readonly id="my-code" value="${esc(code)}" onclick="this.select()">
          <button class="btn" id="btn-copycode" type="button">Copy</button>
        </div>
        <button class="btn primary" id="btn-invite" type="button" style="margin-top:8px;width:100%">📣 Share invite</button>`
        : '<div class="small soft" style="margin-top:8px">Connect to the server to get your friend code.</div>'}
        <div class="row" style="margin-top:12px">
          <input id="friend-code" placeholder="Paste a PURR2-… code">
          <button class="btn primary" id="btn-addfriend" type="button">Add</button>
        </div>
      </div>`;
  }
  async function refreshFriends() {
    if (S.friendsLoading) return;
    S.friendsLoading = true;
    try {
      await ensureAuth();
      S.friends = await apiFetch('/api/friends');
      S.online = true;
      if (S.view === 'ranks') render();
    } catch (e) {
      S.online = false;
    } finally {
      S.friendsLoading = false;
    }
  }
  async function refreshLeaderboard() {
    if (S.ranksLoading) return;
    S.ranksLoading = true;
    try {
      await ensureAuth();
      const data = await apiFetch(`/api/leaderboard/${S.day}?scope=${encodeURIComponent(S.lbTab)}`);
      S.leaderboard = data;
      S.liveStats = data.stats;
      S.online = true;
      if (S.view === 'ranks') render();
    } catch (e) {
      S.online = false;
    } finally {
      S.ranksLoading = false;
    }
  }
  function bindRanks() {
    if (!S.leaderboard || S.leaderboard.scope !== S.lbTab) refreshLeaderboard();
    if (S.lbTab === 'friends' && !S.friends) refreshFriends();
    document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { S.lbTab = b.dataset.tab; S.leaderboard = null; render(); });
    const add = $('#btn-addfriend');
    if (add) add.onclick = async () => {
      const input = $('#friend-code');
      const code = input ? input.value.trim() : '';
      if (!code) { toast('Paste a friend code first'); return; }
      try {
        await ensureAuth();
        const res = await apiFetch('/api/friends', { method: 'POST', body: JSON.stringify({ code }) });
        toast('Added ' + res.friend.name + '! 🎉');
        S.friends = null; refreshFriends(); refreshLeaderboard();
      } catch (e) {
        toast(e.message || 'Invalid code');
      }
    };
    const copyCode = $('#btn-copycode');
    if (copyCode) copyCode.onclick = () => copyText(S.me.friendCode, 'Friend code copied!');
    const invite = $('#btn-invite');
    if (invite) invite.onclick = doInvite;
    document.querySelectorAll('.btn-rmfriend').forEach(b => b.onclick = async () => {
      try {
        await ensureAuth();
        await apiFetch('/api/friends/' + encodeURIComponent(b.dataset.friend), { method: 'DELETE' });
        S.friends = null; refreshFriends(); refreshLeaderboard();
      } catch (e) {
        toast(e.message || 'Could not remove');
      }
    });
  }

  // --- community levels ---
  const COMMUNITY_CAP = 30;
  function renderCommunity() {
    const tab = S.communityTab;
    const body = tab === 'create' ? renderCommunityCreate() : renderCommunityList(tab);
    return `
      <h1 style="margin:10px 0">🧩 Community Gardens</h1>
      <div class="small soft" style="margin-bottom:8px">Player-made gardens — generate one, publish it, and see which get the most love. 🐾</div>
      <div class="tabs">
        <button class="btn ${tab === 'top' ? 'primary' : ''}" data-ctab="top">🔥 Top</button>
        <button class="btn ${tab === 'new' ? 'primary' : ''}" data-ctab="new">🆕 New</button>
        <button class="btn ${tab === 'mine' ? 'primary' : ''}" data-ctab="mine">🐾 Mine</button>
        <button class="btn ${tab === 'create' ? 'primary' : ''}" data-ctab="create">✏️ Create</button>
      </div>
      ${body}
      ${navBar()}`;
  }
  function renderCommunityList(tab) {
    if (!S.online) return '<div class="card center soft" style="padding:20px">Connect to the server to browse community gardens.</div>';
    const data = S.community[tab];
    if (!data) return '<div class="card center soft" style="padding:20px">Loading gardens…</div>';
    if (!data.items.length) {
      const empty = tab === 'mine'
        ? "You haven't published any gardens yet. Tap ✏️ Create!"
        : 'No gardens yet — be the first! Tap ✏️ Create.';
      return `<div class="card center soft" style="padding:20px">${empty}</div>`;
    }
    const cards = data.items.map(l => `
      <div class="card cg-card">
        <pre class="cg-thumb">${esc(levelEmojiGrid(l.def))}</pre>
        <div class="grow">
          <b>${esc(l.name)}</b>${l.status && l.status !== 'active' ? ' <span class="small soft">(under review)</span>' : ''}
          <div class="small soft">by ${esc(l.author)}${l.mine ? ' (you)' : ''} · ${l.rows}×${l.cols} · goal ${l.target} · ♥ ${l.likes} · ▶ ${l.plays}</div>
          <div class="actions" style="justify-content:flex-start;margin-top:8px">
            <button class="btn primary cg-play" data-id="${l.id}">▶ Play</button>
            <button class="btn cg-like ${l.likedByMe ? 'toggled' : ''}" data-id="${l.id}" ${l.mine ? 'disabled' : ''}>♥ ${l.likes}</button>
            ${l.mine ? '' : `<button class="btn ghost cg-report" data-id="${l.id}" title="Report" aria-label="Report ${esc(l.name)}">🚩</button>`}
          </div>
        </div>
      </div>`).join('');
    const more = data.hasMore
      ? `<div class="actions" style="justify-content:center"><button class="btn" id="cg-more" ${S.communityLoading ? 'disabled' : ''}>${S.communityLoading ? 'Loading…' : 'Load more'}</button></div>`
      : '';
    return cards + more;
  }
  function renderCommunityCreate() {
    if (!S.online) return '<div class="card center soft" style="padding:20px">Connect to the server to publish gardens.</div>';
    const d = S.draft;
    const inner = d ? `
      <pre class="cg-thumb cg-thumb-lg">${esc(levelEmojiGrid(d.lv))}</pre>
      <div class="small soft center">${d.lv.rows}×${d.lv.cols} garden · goal ${d.lv.target} pts · ${d.lv.walls} fences</div>
      <label style="margin-top:10px">Name your garden</label>
      <input id="cg-name" maxlength="40" placeholder="Mochi's Meadow" value="${esc(d.name || '')}">
      <div class="actions" style="justify-content:flex-start;margin-top:8px">
        <button class="btn primary" id="cg-publish">🚀 Publish</button>
        <button class="btn" id="cg-reroll">🎲 Re-roll</button>
      </div>` : `
      <div class="center soft" style="padding:6px 0 12px">Generate a random garden, re-roll until you like it, then name and publish it.</div>
      <div class="actions" style="justify-content:center"><button class="btn primary" id="cg-generate">🎲 Generate a garden</button></div>`;
    return `<div class="card">${inner}</div>
      <div class="card small soft">Gardens are procedurally generated, so they're always solvable and fair. You can publish up to ${COMMUNITY_CAP}. Keep names friendly — reports go to the moderators.</div>`;
  }
  function genDraft() {
    for (let i = 0; i < 8; i++) {
      const seed = Math.floor(Math.random() * 2 ** 31);
      const lv = generateLevel(seed, { name: 'Community Garden' });
      if (lv && lv.target >= 12) { S.draft = { seed, lv, name: (S.draft && S.draft.name) || '' }; return; }
    }
  }
  async function fetchCommunity(tab, append = false) {
    if (S.communityLoading) return;
    S.communityLoading = true;
    if (append) render(); // reflect "Loading…" on the button
    try {
      await ensureAuth();
      const cur = S.community[tab];
      const skip = append && cur ? cur.items.length : 0;
      const q = tab === 'mine'
        ? `mine=1&skip=${skip}`
        : `sort=${tab === 'new' ? 'new' : 'top'}&skip=${skip}`;
      const data = await apiFetch(`/api/community/levels?${q}`);
      const items = append && cur ? cur.items.concat(data.levels) : data.levels;
      S.community[tab] = { items, hasMore: data.hasMore };
      S.online = true;
    } catch (e) {
      S.online = false;
    } finally {
      S.communityLoading = false;
      if (S.view === 'community') render();
    }
  }
  function findCommunity(id) {
    for (const tab of ['top', 'new', 'mine']) {
      const d = S.community[tab];
      if (d) { const l = d.items.find(x => x.id === id); if (l) return l; }
    }
    return null;
  }
  function startCommunity(l) {
    const lv = parseLevel(l.def);
    lv.name = l.name;
    lv.target = l.target;
    S.mode = 'community'; S.level = lv; resetPlay(); S.view = 'game'; render();
    apiFetch(`/api/community/levels/${l.id}/play`, { method: 'POST', body: '{}' }).catch(() => {});
  }
  async function publishDraft() {
    if (!S.draft) return;
    const nameEl = $('#cg-name');
    const name = (nameEl ? nameEl.value : '').trim();
    if (name.length < 3) { toast('Give your garden a name (3+ characters)'); return; }
    S.draft.name = name;
    const btn = $('#cg-publish');
    if (btn) { btn.disabled = true; btn.textContent = '🚀 Publishing…'; }
    try {
      await ensureAuth();
      await apiFetch('/api/community/levels', { method: 'POST', body: JSON.stringify({ seed: S.draft.seed, name }) });
      toast('Published! 🎉');
      S.draft = null;
      S.community.new = null; S.community.top = null; S.community.mine = null;
      S.communityTab = 'mine';
      render();
    } catch (e) {
      toast(e.message || 'Could not publish');
      if (btn) { btn.disabled = false; btn.textContent = '🚀 Publish'; }
    }
  }
  async function likeCommunity(id) {
    try {
      await ensureAuth();
      const res = await apiFetch(`/api/community/levels/${id}/like`, { method: 'POST', body: '{}' });
      for (const tab of ['top', 'new', 'mine']) {
        const d = S.community[tab];
        if (d) { const l = d.items.find(x => x.id === id); if (l) { l.likedByMe = res.liked; l.likes = res.likes; } }
      }
      render();
    } catch (e) {
      toast(e.message || 'Could not like');
    }
  }
  async function reportCommunity(id) {
    if (!window.confirm('Report this garden as inappropriate? Moderators will review it.')) return;
    try {
      await ensureAuth();
      await apiFetch(`/api/community/levels/${id}/report`, { method: 'POST', body: JSON.stringify({ reason: 'inappropriate' }) });
      toast('Reported — thanks for keeping the garden friendly.');
    } catch (e) {
      toast(e.message || 'Could not report');
    }
  }
  function bindCommunity() {
    document.querySelectorAll('[data-ctab]').forEach(b => b.onclick = () => { S.communityTab = b.dataset.ctab; render(); });
    if (S.communityTab !== 'create' && S.online && !S.community[S.communityTab] && !S.communityLoading) fetchCommunity(S.communityTab);
    const more = $('#cg-more');
    if (more) more.onclick = () => fetchCommunity(S.communityTab, true);
    const gen = $('#cg-generate');
    if (gen) gen.onclick = () => { gen.disabled = true; gen.textContent = '🎲 Generating…'; setTimeout(() => { genDraft(); render(); }, 20); };
    const reroll = $('#cg-reroll');
    if (reroll) reroll.onclick = () => {
      const n = $('#cg-name'); if (n && S.draft) S.draft.name = n.value;
      reroll.disabled = true; reroll.textContent = '🎲 …';
      setTimeout(() => { genDraft(); render(); }, 20);
    };
    const pub = $('#cg-publish');
    if (pub) pub.onclick = publishDraft;
    document.querySelectorAll('.cg-play').forEach(b => b.onclick = () => { const l = findCommunity(b.dataset.id); if (l) startCommunity(l); });
    document.querySelectorAll('.cg-like').forEach(b => b.onclick = () => likeCommunity(b.dataset.id));
    document.querySelectorAll('.cg-report').forEach(b => b.onclick = () => reportCommunity(b.dataset.id));
  }

  // --- settings ---
  function renderSettings() {
    return `
      <h1 style="margin:10px 0">⚙️ Settings</h1>
      <div class="card">
        <label>Your name (for leaderboards & sharing)</label>
        <input id="set-name" value="${esc(settings.name)}" maxlength="14">
        <div class="small soft" style="margin-top:8px">Your device account is anonymous. This name is shown on daily leaderboards after you submit.</div>
        ${S.me && S.me.friendCode ? `<label>Friend code</label>
        <div class="row">
          <input readonly id="set-code" value="${esc(S.me.friendCode)}" onclick="this.select()">
          <button class="btn" id="btn-copycode2" type="button">Copy</button>
        </div>` : ''}
        <div class="actions" style="justify-content:flex-start">
          <button class="btn primary" id="btn-save">Save</button>
          ${S.me && S.me.friendCode ? '<button class="btn" id="btn-invite2" type="button">📣 Invite a friend</button>' : ''}
        </div>
      </div>
      <div class="card small soft">
        <b style="color:var(--ink)">About:</b> Purrimeter is an enclosure puzzle. Campaign targets and daily/AI goals are computed by a built-in solver, so 3 stars is always achievable — and after any game you can view the solver's optimal fences.
      </div>
      ${navBar()}`;
  }
  function bindSettings() {
    const copyCode = $('#btn-copycode2');
    if (copyCode) copyCode.onclick = () => copyText(S.me.friendCode, 'Friend code copied!');
    const invite = $('#btn-invite2');
    if (invite) invite.onclick = doInvite;
    $('#btn-save').onclick = async () => {
      settings = {
        name: $('#set-name').value.trim() || 'You',
      };
      store.set('settings', settings);
      try {
        await ensureAuth();
        const saved = await apiFetch('/api/me/name', { method: 'POST', body: JSON.stringify({ name: settings.name }) });
        settings.name = saved.name;
        store.set('settings', settings);
        await loadMe();
      } catch (e) {
        toast(e.message || 'Saved locally only');
        S.view = 'home'; render();
        return;
      }
      toast('Saved!'); S.view = 'home'; render();
    };
  }

  // ---------- boot ----------
  document.addEventListener('click', e => {
    const nav = e.target.closest && e.target.closest('a[data-nav]');
    if (nav) { e.preventDefault(); S.view = nav.dataset.nav; render(); }
    const dl = e.target.closest && e.target.closest('[data-daily]');
    if (dl) startDaily();
    const arch = e.target.closest && e.target.closest('[data-arch]');
    if (arch) startArchive(+arch.dataset.arch);
    const lvEl = e.target.closest && e.target.closest('[data-lv]');
    if (lvEl) startCampaign(+lvEl.dataset.lv);
  });
  window.addEventListener('resize', () => { if (S.view === 'game') render(); });
  app().innerHTML = '<div class="boot"><div class="boot-cat">🐈</div><div class="small soft">Loading your garden…</div></div>';
  loadMe().then(() => {
    if (!store.get('tutorialDone', false)) startTutorial(); else render();
  });
})();
