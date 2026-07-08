# Purrimeter — Complete Game Overview (LLM Handoff Document)

*Written by the supervising agent. Read this fully before touching any code.*

## 1. What the game is

Purrimeter is an enclosure puzzle game, a cat-themed adaptation of the mechanics of **enclose.horse**.
The player places a limited number of **fences** on a grid to trap a cat (Mochi 🐈) in the largest,
most valuable meadow possible.

### Core rules (engine invariants — never change these without explicit approval)
- Grid of tiles: `.` grass, `~` pond (impassable), `#` rock (impassable), `C` cat (exactly one, on grass),
  `y` yarn (+3), `t` tuna (+10), `u` cucumber (−5), `1`/`2`/`3` box portal pairs (each digit appears exactly
  twice; the cat teleports between matching boxes).
- The cat moves **orthogonally only** (no diagonals). Reachability = BFS from the cat through grass/item
  tiles, blocked by water, rocks, and fences. Standing on a box teleports to its twin unless the twin is fenced.
- If any reachable tile is on the **grid border**, the cat escapes → score 0 / cannot submit.
- Score = 1 point per reachable tile + item bonuses on reachable tiles.
- Fences may be placed on any grass tile **including item tiles** (the item is then lost/neutralized —
  fencing a cucumber or a box is a legitimate strategy). Never on the cat, water, or rocks.
- Diagonal gaps are safe (the cat can't cut corners) — a core strategy the game teaches.
- Stars: 3 = score ≥ target, 2 = ≥80% of target, 1 = any valid enclosure.

## 2. Code layout (web version — the canonical one)

Located in `web/`. `index.html` is a small static shell that loads the CSS and
JS as **external files** (`style.css`, `core.js`, `ui.js`, `config.js`). This
keeps the production CSP strict (`script-src 'self'`, no `'unsafe-inline'`) —
inlining the scripts would get them blocked and render a blank page. Edit
`style.css` / `core.js` / `ui.js` directly; there is no build/concat step.
(The old `head.html`/`mid.html`/`tail.html` build parts have been removed.)

- **`core.js`** — pure logic, no DOM, Node-testable (`module.exports` guard at bottom):
  - `parseLevel(def)` — ASCII map parser.
  - `evaluate(lv, fencesSet)` — BFS engine; returns `{reachable, escaped, score, escapePath}`.
    Cell keys are encoded `key(r,c) = r*100+c` (assumes < 100 columns).
  - `solve(lv, {iters, restarts, seed})` — **region-based simulated annealing** solver. Grows/shrinks a
    connected region containing the cat; fences derived from the region boundary; portal twins outside the
    region must be fenced. Deterministic given a seed (uses `mulberry32`). Targets everywhere in the game
    are "best known" scores from this solver.
  - `generateLevel(seed)` — deterministic procedural generator (pond blobs, rocks, items, quality gate:
    solvable, target ≥ 12, at least one special inside the optimum). Attaches `target` and `solution`.
  - `dayNumber()` — daily index; epoch is `Date.UTC(2026, 6, 1)` = Daily #1. Daily seed = `day * 2654435761 % 2**31`.
  - `CAMPAIGN` — **35 hand/generator-crafted levels**, each with `walls`, `target`, and a **baked `solution`**
    (array of cell keys) verified to reproduce the target exactly. Never ship a level whose solution doesn't
    replay to its stated target.
  - Share: `shareText()` produces a **spoiler-safe** card (terrain+items emoji grid, NO fences/enclosure)
    plus a checksummed `PURR-<base64>` friend code; `parseFriendCode()` validates (tamper → null).
  - `dailyBots(day, target)` — legacy deterministic "global" leaderboard entries. **No longer used**: the
    UI now reads live standings from the server (`GET /api/leaderboard/:day`). Kept only for offline demos.
  - `AI_PROMPT` + `validateAiLevel(obj)` — prompt and validation/repair pipeline for LLM-generated levels.
- **`ui.js`** — all UI in an IIFE. Central state object `S` {view, mode, level, fences:Set, undo, submitted,
  result, review, day, archiveDay, ...}. Views: `home | game | ranks | ailab | settings | archive`.
  - **Incremental board rendering** (critical): `computeTile()` describes a tile; `updateBoard()` diffs each
    tile's class/innerHTML against cached `el._c`/`el._h` and only touches changed tiles, so CSS animations
    (water shimmer, item wobble, wheat) never restart on unrelated tiles. `primeBoard()` seeds the cache
    after full renders. Taps/undo/reset go through `updateBoard()`; view changes and submit do full `render()`.
  - `localStorage` keys (all prefixed `purr_`): `settings`, `stats`, `history` (last 200 submissions),
    `campaign` (per-index `{score, stars}`), `daily_<n>` (result; `archived:true` for archive replays),
    `dailycache`, `sol_<i>`, `friends`, `tutorialDone`.
- **`style.css`** — design system with CSS variables, light+dark mode.
- `newlevels*.js`, `sols*.json` — level-design workbenches (Node scripts using the solver). Keep for future level work.
- There is also an **iOS SwiftUI prototype** (`Purrimeter.zip` / earlier work) — functional but far behind
  the web version. Ignore unless asked.

## 3. Feature inventory

- **Tutorial** — auto-launches for new players (`tutorialDone` flag); scripted steps with a glowing target
  tile; only the scripted tile is tappable; replayable from home.
- **Campaign** — 35 levels on a winding "Campaign Trail" (SVG path, card nodes with icon/state/stars,
  progress bar). **Levels lock**: you must clear (≥1 star) level N to open N+1. Order is a deliberate
  difficulty curve: basics → mechanic lessons placed next to the mechanic they teach (Cucumber Shield after
  Cucumber Patch, Box Blocker after Box Magic, Great Wall = plug-pushing lesson) → mixed mid-game → open
  optimization boards (26→41 targets) → Grand Garden finale (43).
- **Daily Challenge** — deterministic per-day level, identical for everyone; **one submission** (locked after);
  Wordle-style. Result stored per day; feeds streaks.
- **Daily Archive** — last 60 dailies listed with dates/results; freely replayable; keeps best score; never
  affects streak. `ARCHIVE_FREE = true` flag exists as a future paywall hook ("Free during the beta" notice).
- **Community Gardens (Community tab)** — player-made levels built in a **tile editor**: the player places
  the cat, ponds, rocks, bonuses (yarn/tuna/cucumber) and portal pairs, sets grid size (6–12) and the fence
  budget, taps **Check** (client runs `validateAiLevel` to compute the goal), then publishes
  `{name, def:{walls, map}}`. The server re-validates authoritatively with `validateAiLevel` (legal grid,
  exactly one cat off the border, portal pairing, size/wall bounds, solver-computed target) and requires
  `target ≥ COMMUNITY_MIN_TARGET`. Maps carry no free text; the name is validated + profanity-filtered.
  Browse **Top**/**New**/**Mine** with **Load more** pagination; **like** (one per player, self-likes
  blocked), **report** (one per player; auto-hides after `REPORT_HIDE_THRESHOLD` pending admin review).
  Limits: per-author cap (`MAX_COMMUNITY_PER_AUTHOR`), publish rate-limit, and dedupe on `(authorId, mapHash)`.
- **AI Level Lab (admin only)** — AI generation runs **server-side from the admin area** (`/admin.html`);
  provider keys live only on the server, never in the browser. There is no public AI Lab tab. Server
  responses are validated by `validateAiLevel` (grid legality, cat placement, portal pairing, solver check
  target ≥ 6); on failure the error is sent back to the LLM once for a fix; final fallback = `generateLevel`.
- **Admin moderation** — the admin page lists community levels (Reported / All), with report reasons, and
  can **remove** or **restore** any level.
- **Optimal viewer** — after submit: "See optimal" shows the baked solution as golden fences; review bar
  toggles "View yours (N) / View optimal (M)", plus Results, **Keep improving** (unlocks board, keeps
  fences; hidden when already optimal / daily / tutorial), and **Next level**.
- **Results screen** — stars pop in, score breakdown ticks line-by-line (meadow tiles / yarn / tuna /
  cucumber), count-up total, share card, live community average, Next level.
- **Leaderboards (Ranks)** — Global and Friends tabs both read **live server submissions**
  (`GET /api/leaderboard/:day`), updated in real time over Socket.io. Friends are **mutual**: paste a
  friend's signed `PURR2-` code to add each other; the Friends tab lists your friends with today's status
  and a remove button, plus an invite/share flow. Community histogram + "Your stats" (submissions,
  avg % of optimal, optimal solves).
- **Share** — emoji-grid puzzle picture (never reveals the solution), stars, score, % of optimal, friend
  code, and a link back to the site.
- **Stats** — plays, daily streak, 3-star count, best score; full submission history in storage.
- **Design** (inspired by an enclose.horse visual review): enclosed area transforms into a **golden hay
  field** (straw striping + 🌾 on ~¾ of tiles, ripple out from the cat at the moment of enclosure), raised
  3D fence posts with ground shadows, pond depth rim + moving shimmer, deterministic flower decorations,
  item claim bounce / cucumber warning shake + red ring, Submit pulses when the pen is sealed, hover info
  strip under the board, dark mode throughout.

## 4. Hard-won product decisions (DO NOT regress these — the user explicitly requested each)

1. **No sound.** A WebAudio engine existed and was removed on request. Do not re-add.
2. **No drag-painting.** One pointerdown = one fence. No pointermove placement.
3. **Goals/targets are hidden until after submission** — never show a level's target on cards or in-game
   pre-submit (show garden size + fence count instead). Optimal is revealed only on the results screen.
4. **No in-game tip lines or "open route" style hint panels.** A live "escape route / seal the red route"
   panel was explicitly rejected. The status bar says only "🚨 Cat can escape!" / "✅ N pts".
5. **Animations must not restart on unrelated tiles** — preserve the incremental rendering contract.
6. **The cat does not move/wander.** Static with idle bob only.
7. Buttons must respect dark mode (`--btn-bg` variable — no hardcoded white pills).
8. Share cards must never leak the solution (no fence positions, no enclosure shading).
9. "Yours/Optimal" is a single toggle button, not two buttons.

## 5. Testing conventions

- Verification is:
  - `node --check` on each JS file (`npm run check`);
  - `npm run verify:core-sync` (web/shared engine parity) and `npm run verify:campaign` (solver reproduces
    every campaign target; solutions replay exactly);
  - the automated test suite under `test/` (`npm test`) — engine unit tests plus API integration tests for
    the daily-submit abuse paths;
  - GitHub Actions runs all of the above on every push/PR (`.github/workflows/ci.yml`).
- When adding levels: design map → `solve()` with ≥2 seeds → inspect the printed solution map → verify the
  special mechanics actually participate in the optimum (early designs repeatedly failed this) → bake
  `target` + `solution` into `CAMPAIGN`.

## 6. Status & remaining limitations

Now production-backed (Fastify + MongoDB + Socket.io on Railway; static frontend on Vercel):

- **Live leaderboards** — global + friends read real server submissions; community stats are live.
- **Server-authoritative daily/archive scoring** — the server re-runs `evaluate()`; the daily "one
  submission" rule is enforced with a unique index. Friend codes are HMAC-signed (`PURR2-`), so forged
  codes are rejected. AI keys are server-only.

Still open (see `PRODUCTION_PLAN.md`):

- Campaign & archive progress are still localStorage-only (server has an unused `campaignProgress`
  collection and a `GET /api/archive` the frontend doesn't call yet) — no cross-device sync for those.
- Campaign/tutorial scoring remains client-side (only daily/archive are server-scored).
- Anonymous `register` has no abuse controls (no captcha/fingerprint).
- No automated daily pre-generation cron (levels are generated lazily on first request).
