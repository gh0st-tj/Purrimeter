/* ============================================================
   Purrimeter — game core (engine, solver, generator, codes)
   Pure logic, no DOM. Testable in Node.
   ============================================================ */

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BONUS = { y: 3, t: 10, u: -5 };
const EPOCH_UTC = Date.UTC(2026, 6, 1); // Daily #1 = July 1, 2026

// ---------- Level ----------
// map: array of equal-length strings.
// '.' grass  '~' pond  '#' rock  'C' cat  'y' yarn  't' tuna  'u' cucumber  '1'..'3' box pairs
function parseLevel(def) {
  const rows = def.map.length, cols = def.map[0].length;
  let cat = null;
  const pairs = {};
  for (let r = 0; r < rows; r++) {
    if (def.map[r].length !== cols) throw new Error('ragged map');
    for (let c = 0; c < cols; c++) {
      const ch = def.map[r][c];
      if (ch === 'C') cat = [r, c];
      if (ch >= '1' && ch <= '3') (pairs[ch] = pairs[ch] || []).push([r, c]);
    }
  }
  if (!cat) throw new Error('no cat');
  for (const k in pairs) if (pairs[k].length !== 2) throw new Error('unpaired box');
  return { ...def, rows, cols, cat, pairs };
}

// A cleared garden always opens its immediate successor. The previous-level
// check matters when a campaign update inserts new levels before a player's
// existing progress: old completions remain usable without skipping the new
// gardens or blocking the Next level button.
function campaignLevelUnlocked(levels, i, progress) {
  if (!Array.isArray(levels) || !Number.isInteger(i) || i < 0 || i >= levels.length) return false;
  const firstUncleared = levels.findIndex(lv => !(progress[lv.name] && progress[lv.name].stars));
  const frontier = firstUncleared < 0 ? levels.length - 1 : firstUncleared;
  return i <= frontier
    || !!(progress[levels[i].name] && progress[levels[i].name].stars)
    || !!(i > 0 && progress[levels[i - 1].name] && progress[levels[i - 1].name].stars);
}

const key = (r, c) => r * 100 + c;
const cellCh = (lv, r, c) => (lv.map[r][c] === 'C' ? '.' : lv.map[r][c]);
const isBlockTerrain = ch => ch === '~' || ch === '#';
const inB = (lv, r, c) => r >= 0 && r < lv.rows && c >= 0 && c < lv.cols;
const onBorder = (lv, r, c) => r === 0 || c === 0 || r === lv.rows - 1 || c === lv.cols - 1;

function boxTwin(lv) {
  const twin = new Map();
  for (const k in lv.pairs) {
    const [a, b] = lv.pairs[k];
    twin.set(key(a[0], a[1]), b);
    twin.set(key(b[0], b[1]), a);
  }
  return twin;
}

// ---------- Engine ----------
// fences: Set of key(r,c). Returns {reachable:Set, escaped, score, escapePath}
function evaluate(lv, fences) {
  const twin = boxTwin(lv);
  const seen = new Set([key(lv.cat[0], lv.cat[1])]);
  const q = [lv.cat];
  const parent = new Map();
  let escaped = false, escapeCell = null;
  for (let h = 0; h < q.length; h++) {
    const [r, c] = q[h];
    if (onBorder(lv, r, c) && !escaped) { escaped = true; escapeCell = [r, c]; }
    const nbrs = [];
    const tw = twin.get(key(r, c));
    if (tw && !fences.has(key(tw[0], tw[1]))) nbrs.push(tw);
    for (const [dr, dc] of DIRS) nbrs.push([r + dr, c + dc]);
    for (const [nr, nc] of nbrs) {
      if (!inB(lv, nr, nc)) continue;
      const k = key(nr, nc);
      if (seen.has(k) || fences.has(k)) continue;
      if (isBlockTerrain(cellCh(lv, nr, nc))) continue;
      seen.add(k); parent.set(k, key(r, c)); q.push([nr, nc]);
    }
  }
  let score = 0;
  if (!escaped) {
    for (const k of seen) {
      const r = Math.floor(k / 100), c = k % 100;
      score += 1 + (BONUS[cellCh(lv, r, c)] || 0);
    }
  }
  // Path from cat to the border (for the red "escape route" hint)
  let escapePath = null;
  if (escaped && escapeCell) {
    escapePath = [];
    let k = key(escapeCell[0], escapeCell[1]);
    while (k !== undefined) {
      escapePath.push(k);
      k = parent.get(k);
    }
  }
  return { reachable: seen, escaped, score, escapePath };
}

// ---------- Seeded RNG ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Solver (region-based simulated annealing) ----------
// Deterministic given the seed. Returns { best, fences:Set }
function solve(lv, { iters = 12000, restarts = 6, seed = 7 } = {}) {
  const rng = mulberry32(seed);
  const twin = boxTwin(lv);
  const passable = (r, c) => !isBlockTerrain(cellCh(lv, r, c));
  const interiorOk = (r, c) =>
    r > 0 && r < lv.rows - 1 && c > 0 && c < lv.cols - 1 && passable(r, c);

  const catK = key(lv.cat[0], lv.cat[1]);
  if (!interiorOk(lv.cat[0], lv.cat[1])) return { best: 0, fences: new Set() };

  const unkey = k => [Math.floor(k / 100), k % 100];

  function fencesFor(R) {
    const f = new Set();
    for (const k of R) {
      const [r, c] = unkey(k);
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (!inB(lv, nr, nc)) continue;
        const nk = key(nr, nc);
        if (!R.has(nk) && passable(nr, nc)) f.add(nk);
      }
      const tw = twin.get(k);
      if (tw) { const tk = key(tw[0], tw[1]); if (!R.has(tk)) f.add(tk); }
    }
    return f;
  }
  function scoreOf(R) {
    let s = 0;
    for (const k of R) { const [r, c] = unkey(k); s += 1 + (BONUS[cellCh(lv, r, c)] || 0); }
    return s;
  }
  function connected(R) {
    const it = R.values().next().value;
    const seen = new Set([it]); const st = [it];
    while (st.length) {
      const k = st.pop(); const [r, c] = unkey(k);
      for (const [dr, dc] of DIRS) {
        const nk = key(r + dr, c + dc);
        if (R.has(nk) && !seen.has(nk)) { seen.add(nk); st.push(nk); }
      }
      const tw = twin.get(k);
      if (tw) { const tk = key(tw[0], tw[1]); if (R.has(tk) && !seen.has(tk)) { seen.add(tk); st.push(tk); } }
    }
    return seen.size === R.size;
  }
  const pick = arr => arr[Math.floor(rng() * arr.length)];

  let bestS = 0, bestF = new Set();
  for (let rst = 0; rst < restarts; rst++) {
    let R = new Set([catK]);
    let curObj = -1e9;
    let T = 4.0;
    for (let i = 0; i < iters; i++) {
      T = Math.max(0.05, T * 0.9996);
      const R2 = new Set(R);
      if (rng() < 0.6 || R.size <= 1) {
        const frontier = [];
        for (const k of R) {
          const [r, c] = unkey(k);
          for (const [dr, dc] of DIRS) {
            const nr = r + dr, nc = c + dc;
            if (!R.has(key(nr, nc)) && inB(lv, nr, nc) && interiorOk(nr, nc)) frontier.push(key(nr, nc));
          }
          const tw = twin.get(k);
          if (tw && !R.has(key(tw[0], tw[1])) && interiorOk(tw[0], tw[1])) frontier.push(key(tw[0], tw[1]));
        }
        if (!frontier.length) continue;
        R2.add(pick(frontier));
      } else {
        const cand = pick([...R]);
        if (cand === catK) continue;
        R2.delete(cand);
        if (!connected(R2)) continue;
      }
      const f2 = fencesFor(R2);
      const s2 = scoreOf(R2);
      const over = Math.max(0, f2.size - lv.walls);
      const obj = s2 - 12 * over;
      if (obj >= curObj || rng() < Math.exp((obj - curObj) / T)) {
        R = R2; curObj = obj;
        if (over === 0) {
          const real = evaluate(lv, f2);
          if (!real.escaped && real.score > bestS) { bestS = real.score; bestF = f2; }
        }
      }
    }
  }
  return { best: bestS, fences: bestF };
}

// ---------- Daily / procedural generator ----------
function dayNumber(now = Date.now()) {
  return Math.floor((now - EPOCH_UTC) / 86400000) + 1;
}

function generateLevel(seed, opts = {}) {
  const rng = mulberry32(seed);
  const ri = n => Math.floor(rng() * n);

  for (let attempt = 0; attempt < 60; attempt++) {
    const rows = 8 + ri(3), cols = 8 + ri(3);
    const g = Array.from({ length: rows }, () => Array(cols).fill('.'));
    const put = (r, c, ch) => { if (r >= 0 && r < rows && c >= 0 && c < cols) g[r][c] = ch; };

    // pond blobs
    const ponds = 1 + ri(2);
    for (let p = 0; p < ponds; p++) {
      let r = ri(rows), c = ri(cols);
      const len = 3 + ri(4);
      for (let i = 0; i < len; i++) {
        put(r, c, '~');
        const [dr, dc] = DIRS[ri(4)];
        r += dr; c += dc;
      }
    }
    // rocks
    const rocks = ri(5);
    for (let i = 0; i < rocks; i++) put(1 + ri(rows - 2), 1 + ri(cols - 2), '#');

    const freeInterior = [];
    for (let r = 2; r < rows - 2; r++)
      for (let c = 2; c < cols - 2; c++)
        if (g[r][c] === '.') freeInterior.push([r, c]);
    if (freeInterior.length < 12) continue;

    const takeFree = () => {
      for (let t = 0; t < 40; t++) {
        const p = freeInterior[ri(freeInterior.length)];
        if (g[p[0]][p[1]] === '.') return p;
      }
      return null;
    };

    const catP = takeFree(); if (!catP) continue;
    g[catP[0]][catP[1]] = 'C';

    const nYarn = 2 + ri(3), nTuna = rng() < 0.75 ? 1 : 0, nCuke = 1 + ri(3);
    for (let i = 0; i < nYarn; i++) { const p = takeFree(); if (p) g[p[0]][p[1]] = 'y'; }
    for (let i = 0; i < nTuna; i++) { const p = takeFree(); if (p) g[p[0]][p[1]] = 't'; }
    for (let i = 0; i < nCuke; i++) { const p = takeFree(); if (p) g[p[0]][p[1]] = 'u'; }
    if (rng() < 0.35) {
      const a = takeFree(), b = takeFree();
      if (a && b && (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])) > 4) {
        g[a[0]][a[1]] = '1'; g[b[0]][b[1]] = '1';
      }
    }

    const walls = 7 + ri(4);
    let lv;
    try {
      lv = parseLevel({ name: opts.name || 'Daily Garden', walls, map: g.map(r => r.join('')) });
    } catch (e) { continue; }

    // quality gate: solvable, decent score, and at least one special inside the optimum
    const sol = solve(lv, { iters: 9000, restarts: 5, seed: seed ^ 0x5eed });
    if (sol.best < 12) continue;
    const ev = evaluate(lv, sol.fences);
    let specialInside = false;
    for (const k of ev.reachable) {
      const ch = cellCh(lv, Math.floor(k / 100), k % 100);
      if (ch === 'y' || ch === 't' || (ch >= '1' && ch <= '3')) specialInside = true;
    }
    if (!specialInside) continue;

    lv.target = sol.best;
    lv.solution = [...sol.fences];
    lv.genAttempt = attempt;
    return lv;
  }
  // ultra-safe fallback
  return parseLevel({
    name: 'Fallback Garden', walls: 6, target: 7,
    map: ['~~~~....', '~.C.....', '~.......', '~~......', '........', '........', '........', '........'],
  });
}

// ---------- Handcrafted levels (validated targets) ----------
const CAMPAIGN = [
  { name: "Cozy Corner", tip: "Tap grass to drop a fence. The pond is a free wall — cats hate water. Seal Mochi in!",
    walls: 4, target: 7, solution: [104, 303, 204, 402],
    map: ["~~~~...", "~.C....", "~......", "~~.....", ".......", ".......", "......."] },
  { name: "Stretch Out", tip: "Mochi never moves diagonally, so diagonal gaps are safe. Step your fence inward at the corners.",
    walls: 8, target: 7, solution: [102, 201, 4, 105, 3, 404, 305, 206],
    map: [".......", ".......", "...C...", "..~~...", "..~....", ".......", "......."] },
  { name: "Yarn Day", tip: "🧶 Yarn is worth +3. Fit as many balls inside your meadow as your fences allow.",
    walls: 7, target: 10, solution: [502, 203, 304, 603, 405, 604, 505],
    map: ["........", "..y.....", ".~~.y...", ".~C.....", ".~......", "....y...", "........"] },
  { name: "Boulders", tip: "🪨 Rocks are free walls, just like ponds. The boulders already make three sides of a pen — fence the open side, then bulge out to scoop up the yarn.",
    walls: 6, target: 18, solution: [106, 207, 5, 505, 406, 307],
    map: ["........", ".####...", ".#......", ".#.C.y..", ".#......", ".####...", "........"] },
  { name: "Cucumber Shield", tip: "🥒 Cucumbers cost −5 inside your pen. This pond ring has gaps — plug them by fencing right on the cucumbers.",
    walls: 3, target: 16, solution: [103, 503, 306],
    map: [".........", ".~~u~~...", ".~.y.~...", ".~.C.....", ".~.y.~...", ".~~u~~...", ".........", "........."] },
  { name: "Cucumber Patch", tip: "Weave your fence between the cucumbers, or fence on top of one to save space.",
    walls: 9, target: 16, solution: [206, 504, 403, 506, 605, 105, 104, 203, 302],
    map: [".........", "..u......", "....y....", ".u..C..~~", "....y..~.", "..u......", "....u....", "........."] },
  { name: "Tuna Heist", tip: "🐟 Tuna is worth +10 — a jackpot. The rocks already guard it; just close the gap.",
    walls: 8, target: 21, solution: [503, 404, 3, 104, 305, 400, 205, 300],
    map: ["........", ".##.....", ".#t.....", "........", "..C.....", ".~~.....", ".~....y.", "........"] },
  { name: "Box Magic", tip: "📦 Boxes are portals — Mochi teleports between the pair, and BOTH ends count. Leave the box open and fence your pen: she also claims the hidden pond garden.",
    walls: 7, target: 16, solution: [103, 202, 304, 104, 205, 403, 302],
    map: ["..........", "..........", "...C1.....", "..........", "..........", "..~~~~....", "..~yy~....", "..~1y~....", "..~~~~....", ".........."] },
  { name: "Box Blocker", tip: "This pond pen looks perfect, but the box leads OUT. Block the escape box.",
    walls: 4, target: 15, solution: [703, 604, 702, 601],
    map: [".........", ".~~~~~...", ".~.y.~...", ".~.C.~...", ".~.1.~...", ".~~.~~...", ".........", "...1.....", "........."] },
  { name: "Garden Party", tip: "Grab the tuna, dodge the cucumbers, and spend every fence.",
    walls: 8, target: 17, solution: [303, 1, 100, 2, 103, 204, 300, 200],
    map: [".........", ".t...~~..", ".....~...", "..C......", ".~~....u.", ".~..y....", "....u..y.", "........."] },
  { name: "The Moat", tip: "The pond nearly encircles her — but the real riches sit just outside. Reach or retreat?",
    walls: 6, target: 19, solution: [705, 606, 804, 702, 601, 803],
    map: ["..........", "..~~~~~...", "..~...~...", "..~.C.~...", "..~...~t..", "..~~.~~...", "..........", "....y...y.", "..........", ".........."] },
  { name: "Fork in the Road", tip: "One corridor, two exits. You can't seal both cheaply — pick the richer side.",
    walls: 7, target: 22, solution: [3, 4, 603, 704, 5, 705, 606],
    map: [".........", ".~~.y.##.", ".~....#..", ".~..C.#..", ".~....#..", ".~~..##..", "...u.....", "..t......", "........."] },
  { name: "The Corridor", tip: "The rocks form a hallway. Seal the ends, and mind the side gaps!",
    walls: 7, target: 23, solution: [200, 5, 505, 404, 506, 407, 210],
    map: ["............", ".####.####..", ".C.......t..", ".####.####..", "............", "............"] },
  { name: "Double Trouble", tip: "TWO box pairs. Mochi can hop across the whole garden — block the leaks that matter.",
    walls: 8, target: 23, solution: [606, 406, 507, 902, 903, 204, 305, 502],
    map: [".........", ".~~~.....", ".~1y.....", ".~~......", "...###...", "....C12..", "...###...", ".~~~.....", ".~2t~....", "........."] },
  { name: "Bridge Toll", tip: "The bridge is valuable, but the cucumber toll means the tightest seal isn't always the best.",
    walls: 9, target: 24, solution: [4, 5, 106, 804, 705, 803, 702, 3, 102],
    map: ["..........", "....t.....", "..~~.~~...", "..~...~...", "..~.C.~...", "..~.u.~...", "..~~.~~...", "....y.....", ".........."] },
  { name: "Secret Tunnel", tip: "A hidden box pair opens up the best expansion — if you dare to use it.",
    walls: 9, target: 26, solution: [501, 301, 306, 505, 105, 206, 703, 400, 4],
    map: [".........", "..~~.....", "..~..1y..", "..tu..u..", "..y##.#..", "..C1yu...", "..~.#y...", "..~......", "..~......"] },
  { name: "Riverbend", tip: "The river does most of the work. Fence only the bank where it stops helping.",
    walls: 6, target: 27, solution: [300, 200, 400, 706, 1, 100],
    map: ["..........", "..~~~~~~..", ".......~..", ".y..C..~..", ".......~..", ".~~~~..~..", "....~..~..", ".t..~.u~..", "....~~~~..", ".........."] },
  { name: "Cucumber Crown", tip: "The crown looks costly. Place fences on the right cucumbers and the penalty disappears.",
    walls: 10, target: 24, solution: [605, 506, 504, 403, 407, 206, 307, 204, 303, 105],
    map: ["...........", "...u.u.u...", "..u.....u..", ".u..y.y..u.", "....t......", ".u...C...u.", "......y....", ".u.......u.", "..u.....u..", "...u.u.u...", "..........."] },
  { name: "Fishbone Canal", tip: "Use the canal like a spine. The best meadow has ribs, not a simple box.",
    walls: 10, target: 28, solution: [803, 702, 705, 804, 401, 601, 4, 3, 500, 5],
    map: ["............", "..~...~.....", "..~y..~..t..", "..~~~.~.....", "......~.~~~.", "..C...~...~.", "......~~~.~.", "..u.y.....~.", "..........~.", "............"] },
  { name: "Tuna Lock", tip: "The tuna sits in a rock pocket. Bend your fence around the pocket instead of boxing Mochi tightly.",
    walls: 9, target: 30, solution: [603, 606, 507, 704, 401, 206, 307, 705, 408],
    map: ["..........", "..####....", "..#t.#....", "..#..#....", "....C..y..", ".~~....u..", ".~.....y..", ".........."] },
  { name: "Stepping Stones", tip: "Scattered rocks are stepping stones for your wall. Weave between them to fence a big meadow.",
    walls: 12, target: 32, solution: [405, 206, 1006, 501, 204, 1004, 1003, 808, 1007, 802, 509, 1005],
    map: ["...........", "..#.....#..", ".....#.....", "...#.y.#...", "..#..u..#..", ".....C.....", "..#..u..#..", "...#.y.#...", ".....#.....", "..#.....#..", "..........."] },
  { name: "False Sanctuary", tip: "The pond sanctuary seems secure, but its box lands beside the edge. Seal the trick, then expand.",
    walls: 7, target: 32, solution: [809, 704, 605, 803, 802, 701, 600],
    map: ["...........", ".~~~~~~....", ".~....~....", ".~.Cy.~....", ".~..1.~....", ".~~~.~~....", "...........", "..t....u...", ".........1.", "..........."] },
  { name: "Pantry Portal", tip: "The little box opens into a stocked pantry. Keep both rooms safe without wasting the pond walls.",
    walls: 9, target: 34, solution: [705, 606, 603, 502, 704, 507, 107, 5, 6],
    map: ["............", ".~~~~.......", ".~ty~...~~~.", ".~.1~...~y~.", ".~~~~...~~~.", "............", "....1C......", "..u....y....", "............", "............"] },
  { name: "Ribbon Canal", tip: "A ribbon of water does half the work. Spend fences where the canal stops.",
    walls: 10, target: 34, solution: [106, 207, 5, 308, 503, 402, 606, 507, 604, 408],
    map: [".........", ".~~~~....", "..~~~....", "..~.t.y..", "..u.yC...", ".....#y..", ".........", "........."] },
  { name: "Winding Water", tip: "Follow the winding water — it wraps most of a huge meadow. You seal the rest.",
    walls: 9, target: 37, solution: [507, 803, 200, 400, 500, 701, 600, 608, 300],
    map: ["..........", ".~~~~~....", ".....~....", ".y...~~~..", "...C...~..", "..~~~.tu..", "..~.......", "..~.~~~~..", "..~....y..", ".........."] },
  { name: "Marsh Mirage", tip: "The marsh tempts you into odd shapes. Count the side gaps before chasing every yarn.",
    walls: 9, target: 39, solution: [206, 307, 408, 805, 706, 804, 402, 5, 803],
    map: [".........", "...~~.#..", "...~~yu..", "..~~y....", "..uyyt...", "...~..C#.", "..~~#.#..", ".~~......", "........."] },
  { name: "Split Pantry", tip: "A rock pocket and a pond pocket almost meet. Stitch them together for the tuna.",
    walls: 10, target: 39, solution: [604, 506, 302, 401, 106, 4, 5, 3, 102, 703],
    map: ["..........", "..........", ".#.....~..", "..u..t.~~.", "..yy...~..", "..#yC#.y..", "..#.......", "..........", ".........."] },
  { name: "Keyhole Cove", tip: "The cove is almost sealed. The keyhole can be a doorway to treasure—or the only escape.",
    walls: 7, target: 37, solution: [704, 603, 805, 807, 708, 906, 608],
    map: ["..........", "..~~~~~~..", "..~....~..", "..~.t..~..", "..~.C..~..", "..~~~.~~..", ".....y....", "..u....y..", "..........", ".........."] },
  { name: "The Great Wall", tip: "Two gaps in an ancient wall. The cheapest plug scores huge — spot it.",
    walls: 3, target: 41, solution: [605, 202, 207],
    map: ["...........", ".....y.....", "...........", "##.####.###", "~....C....~", "~.y.....t.~", "~....u....~", "~~~~~~~~~~~", "..........."] },
  { name: "Diamond District", tip: "The rocks form a perfect boundary with one weak point. How much can a single fence claim?",
    walls: 12, target: 40, solution: [605],
    map: ["...........", ".....#.....", "....#t#....", "...#...#...", "..#..y..#..", ".#...C...#.", "..#..u..#..", "...#...#...", "....#y#....", ".....#.....", "..........."] },
  { name: "Two Cathedrals", tip: "Two stone halls share a magical door. One fence plan can claim both interiors.",
    walls: 8, target: 40, solution: [803, 702, 601, 904, 805, 706, 607, 6],
    map: ["...........", ".#####.###.", ".#t..#.#y#.", ".#...#.#.#.", ".#.1.#.#1#.", ".##.##.###.", "...C.......", "..u....y...", "...........", "..........."] },
  { name: "Midnight Feast", tip: "This late-night feast mixes every trick: two portals, tempting tuna, and cucumbers guarding shortcuts.",
    walls: 13, target: 48, solution: [609, 209, 803, 904, 510, 310, 1005, 5, 4, 411, 6, 3, 401],
    map: ["............", ".~~....##...", ".~t.1..#y...", ".~~....#....", "....u....2..", "..###.C.....", "..#y..u.1...", "..#...~~~...", "....2.~t~...", ".u....~~~y..", "............", "............"] },
  { name: "Three Wishes", tip: "Three portal pairs offer three distant prizes. Your fence budget decides which wishes come true.",
    walls: 12, target: 50, solution: [705, 804, 700, 600, 4, 706, 607, 5, 6, 500, 7, 508],
    map: ["............", ".~~~....~~~.", ".~t~....~y~.", ".~1~....~2~.", ".~~~....~~~.", "............", "....1C2.....", ".....3......", ".~~~....~~~.", ".~u~....~t~.", ".~3~....~~~.", ".~~~........"] },
  { name: "Hourglass Garden", tip: "The narrow waist is cheap to close, but choosing only one half leaves a fortune behind.",
    walls: 9, target: 56, solution: [805, 503, 1005, 1004, 507, 5, 6, 1006, 4],
    map: ["...........", ".~~~...~~~.", ".~t.....y~.", ".~~~...~~~.", "....#.#....", ".....C.....", "....#.#....", ".~~~...~~~.", ".~y..u..t~.", ".~~~...~~~.", "..........."] },
  { name: "Grand Garden", tip: "Every old lesson returns: free walls, a portal pantry, tempting bonuses, and one costly shortcut.",
    walls: 11, target: 63, solution: [510, 705, 610, 809, 710, 5, 601, 500, 6, 410, 4],
    map: ["...........", ".~~~...~~~.", ".~t~...~y~.", ".~1~...~~~.", ".~~~.......", ".....C1....", "..##...##..", "..#y.u..#..", "..#..t..#..", "..######...", "..........."] },
].map(parseLevel);

// ---------- Share / friend codes ----------
// Spoiler-safe puzzle picture: terrain + items + cat, but NO fences and NO enclosure —
// it shows which garden you played, never how you solved it.
function levelEmojiGrid(lv) {
  const M = { '.': '🟩', '~': '🌊', '#': '🪨', C: '🐱', y: '🧶', t: '🐟', u: '🥒', 1: '📦', 2: '📦', 3: '📦' };
  return lv.map.map(row => [...row].map(ch => M[ch] || '🟩').join('')).join('\n');
}
function shareText(day, name, score, target, stars, fencesUsed, walls, lv) {
  const starStr = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
  const code = friendCode(day, name, score, stars);
  const pct = target ? Math.round(100 * score / target) : 100;
  const grid = lv ? '\n' + levelEmojiGrid(lv) : '';
  return `🐈 Purrimeter #${day}\n${starStr} ${score} pts (${pct}% of optimal) · ${fencesUsed}/${walls} fences${grid}\ncode: ${code}`;
}
function friendCode(day, name, score, stars) {
  const payload = `${day}|${name.slice(0, 14).replace(/\|/g, '')}|${score}|${stars}`;
  let sum = 0;
  for (const ch of payload) sum = (sum * 31 + ch.charCodeAt(0)) % 997;
  const b64 = (typeof btoa !== 'undefined' ? btoa(payload + '|' + sum)
    : Buffer.from(payload + '|' + sum).toString('base64'));
  return 'PURR-' + b64.replace(/=+$/, '');
}
function parseFriendCode(code) {
  try {
    const m = code.trim().match(/PURR-([A-Za-z0-9+/]+)/);
    if (!m) return null;
    const raw = (typeof atob !== 'undefined' ? atob(m[1]) : Buffer.from(m[1], 'base64').toString());
    const parts = raw.split('|');
    if (parts.length !== 5) return null;
    const [day, name, score, stars, sum] = parts;
    let s = 0;
    const payload = parts.slice(0, 4).join('|');
    for (const ch of payload) s = (s * 31 + ch.charCodeAt(0)) % 997;
    if (String(s) !== sum) return null;
    return { day: +day, name, score: +score, stars: +stars };
  } catch (e) { return null; }
}

// ---------- Demo "global" bots (deterministic per day) ----------
const BOT_NAMES = ['Whiskers', 'MittensMax', 'PurrLord', 'CatioQueen', 'FenceFan42', 'TunaTycoon', 'SirPounce', 'YarnYoda'];
function dailyBots(day, target) {
  const rng = mulberry32(day * 7919 + 13);
  const n = 5 + Math.floor(rng() * 3);
  const out = [];
  for (let i = 0; i < n; i++) {
    const name = BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)] + (rng() < 0.3 ? Math.floor(rng() * 90 + 10) : '');
    const deficit = rng() < 0.25 ? 0 : Math.floor(rng() * Math.max(3, target * 0.45));
    const score = Math.max(1, target - deficit);
    out.push({ name, score, stars: score >= target ? 3 : score >= 0.8 * target ? 2 : 1 });
  }
  const seen = new Set();
  return out.filter(b => !seen.has(b.name) && seen.add(b.name)).sort((a, b) => b.score - a.score);
}

// ---------- AI level generation ----------
const AI_PROMPT = (seedHint) => `You are a puzzle designer for "Purrimeter", an enclosure puzzle game.

RULES OF THE GAME:
- Rectangular grid. '.'=grass, '~'=pond (impassable), '#'=rock (impassable), 'C'=cat (exactly one, on grass), 'y'=yarn(+3), 't'=tuna(+10), 'u'=cucumber(-5), '1'/'2'/'3'=cardboard box portals (each used digit must appear exactly twice; the cat teleports between matching boxes).
- The player places a limited number of fences on grass tiles to trap the cat. The cat moves only up/down/left/right. If it can reach the board edge, it escapes.
- Score = number of tiles the cat can roam inside the fence, plus item bonuses.

DESIGN PRINCIPLES for a great level:
- Put the cat near partial natural barriers (pond/rocks) so early fences feel efficient.
- Include one tempting "pitfall" area that costs more fences than it earns.
- Place a high-value item just outside the lazy enclosure so a smarter shape wins.
- Cucumbers should punish greedy expansion.
- 8-11 rows, 8-11 columns, 6-11 fences. Cat NOT on or adjacent to the border.
- Mix: 2-4 yarn, 0-1 tuna, 1-3 cucumbers, optionally 1-2 box pairs placed far apart.

Theme hint for variety: ${seedHint}

Respond with ONLY a JSON object, no markdown fences:
{"name": "<2-3 word level name>", "walls": <int>, "map": ["<row string>", ...]}`;

function validateAiLevel(obj) {
  if (!obj || !Array.isArray(obj.map) || !obj.map.length) return 'missing map';
  if (typeof obj.walls !== 'number' || obj.walls < 4 || obj.walls > 14) return 'bad wall count';
  const w = obj.map[0].length;
  if (obj.map.some(r => typeof r !== 'string' || r.length !== w)) return 'ragged rows';
  if (obj.map.length < 6 || obj.map.length > 14 || w < 6 || w > 14) return 'bad size';
  const flat = obj.map.join('');
  if (/[^.~#Cytu123]/.test(flat)) return 'illegal characters';
  if ((flat.match(/C/g) || []).length !== 1) return 'need exactly one cat';
  for (const digit of ['1', '2', '3']) {
    const n = (flat.match(new RegExp(digit, 'g')) || []).length;
    if (n !== 0 && n !== 2) return 'box portals must come in matching pairs';
  }
  let lv;
  try { lv = parseLevel({ name: obj.name || 'AI Garden', walls: Math.round(obj.walls), map: obj.map }); }
  catch (e) { return e.message; }
  const [cr, cc] = lv.cat;
  if (cr <= 0 || cc <= 0 || cr >= lv.rows - 1 || cc >= lv.cols - 1) return 'cat on border';
  const sol = solve(lv, { iters: 10000, restarts: 5, seed: 42 });
  if (sol.best < 6) return 'not solvable well enough (best ' + sol.best + ')';
  lv.target = sol.best;
  lv.solution = [...sol.fences];
  return lv; // object = success
}

// Node export for testing
if (typeof module !== 'undefined') {
  module.exports = { parseLevel, evaluate, solve, generateLevel, dayNumber, CAMPAIGN, shareText, friendCode, parseFriendCode, dailyBots, validateAiLevel, key, cellCh, mulberry32, AI_PROMPT, EPOCH_UTC, levelEmojiGrid, campaignLevelUnlocked };
}
