# Purrimeter — Production Plan (Web-first)

*Supervisor: the agent that built the prototype. Executor: you (the next LLM). Read `GAME_OVERVIEW.md`
first. Follow the milestones in order; each has acceptance criteria. Do not merge a milestone that fails
its criteria. Where this plan conflicts with prototype code, this plan wins; where it conflicts with the
"Hard-won product decisions" in the overview, the overview wins — those are user requirements.*

## 0. Target architecture

Owner's stack: custom domain (being purchased), **Vercel**, **Railway**, **MongoDB** (assume Atlas or
Railway Mongo plugin — confirm with owner which; either works, prefer whatever their existing Mongo is).

```
purrimeter.example (Vercel)          api.purrimeter.example (Railway)
┌──────────────────────────┐         ┌─────────────────────────────────┐
│ Static frontend           │  HTTPS  │ Node 20 + Fastify (or Express) │
│ (current single-file app, │ ──────► │ REST + WebSocket (Socket.IO)   │
│  split into modules, no   │         │ MongoDB driver / Mongoose      │
│  build framework needed)  │ ◄────── │ Server-side engine (core.js    │
└──────────────────────────┘   WS     │  reused verbatim — it is pure) │
                                      └─────────────────────────────────┘
```

Key principle: **`core.js` is isomorphic.** The exact same file runs in the browser (rendering/UX) and on
the server (authoritative scoring, level generation, solver). Never fork the rules logic; import one file
in both places. This is the anti-cheat foundation: the server re-evaluates every submission.

Repo restructure (monorepo, single GitHub repo):
```
/web        → static frontend (deployed to Vercel; root dir setting in Vercel)
/server     → Railway service (Fastify, Socket.IO, Mongo)
/shared     → core.js (+ its tests) imported by both
/docs       → GAME_OVERVIEW.md, this file, runbooks
```

## 1. Milestone 1 — Server skeleton + database (Railway)

Build `/server` with:
- Fastify + `@fastify/cors` (allow only the site origin + localhost dev), `@fastify/helmet`,
  `@fastify/rate-limit` (e.g. 60 req/min/IP; 5/min on auth + AI endpoints).
- Health route `GET /healthz`.
- Mongo connection via `MONGODB_URI` env var. Collections and indexes:

| Collection | Shape (essentials) | Indexes |
|---|---|---|
| `players` | `_id`, `token` (server-issued secret), `name`, `createdAt`, `lastSeen`, `entitlements: []` | unique `token` |
| `dailyLevels` | `day`, `def {name, walls, map}`, `target`, `solution`, `publishedAt`, `source: 'generator'\|'ai'\|'admin'` | unique `day` |
| `submissions` | `playerId`, `kind: 'daily'\|'archive'`, `day`, `fences: [int]`, `score`, `stars`, `createdAt` | unique `(playerId, day, kind:'daily')`; `(day, score desc)` |
| `friendships` | `playerId`, `friendPlayerId`, `createdAt` | unique pair |
| `campaignProgress` | `playerId`, `levelName`, `bestScore`, `stars` | unique `(playerId, levelName)` — key by **name**, not index (order changed twice already) |
| `aiLevels` | level def + target + solution + `createdBy`, `status: 'draft'\|'published'` | |
| `adminAudit` | every admin action, timestamped | |

**Identity (keep it simple, no passwords):** anonymous device accounts.
- `POST /api/register` → creates player, returns `{playerId, token}`; client stores token in localStorage
  and sends it as `Authorization: Bearer <token>` on all calls. Names are claimed via
  `POST /api/me/name` (unique, 3–14 chars, profanity-filtered, rate-limited).
- This preserves the current no-friction UX. Real OAuth can be added later without schema changes.
  Do NOT build password auth.

Acceptance: deployed on Railway, `/healthz` green, Mongo indexes created by a startup migration script,
rate limits verified with a loop test.

## 2. Milestone 2 — Authoritative daily + submissions + real leaderboard

- **Daily publishing:** a Railway cron (or `node-cron` in-process) generates each day's level at 00:00 UTC
  using `generateLevel(dailySeed(day))` from `/shared/core.js` — same formula as the prototype so results
  stay consistent — solves it (3 seeds, 16k iters) and stores def+target+solution in `dailyLevels`.
  `GET /api/daily` returns today's def + walls **without target/solution**. Target is revealed only by
  submitting (`GET /api/daily/:day/reveal` requires an existing submission).
- **Submit:** `POST /api/daily/submit {fences:[keys]}` → server loads the level, runs `evaluate()`,
  rejects if escaped / fence count > walls / fences on illegal cells / already submitted (unique index
  enforces). Returns `{score, stars, target, solution, rank, percentile}`. **Never trust client scores.**
- **Archive:** `GET /api/archive?from=&to=` (past days list + player's results), `POST /api/archive/:day/submit`
  (upsert best, `kind:'archive'`). Enforce `entitlements` check behind a flag `ARCHIVE_REQUIRES_PREMIUM=false`
  (the future paywall switch — mirrors the client's `ARCHIVE_FREE`).
- **Leaderboards:** `GET /api/leaderboard/:day?scope=global|friends` → top 100 + player's own rank.
  Replace `dailyBots` demo entirely. Friends: `POST /api/friends {code}` still accepts the PURR-code UX,
  but codes are now **server-issued** (contain playerId, HMAC-signed with `SHARE_SECRET`) so they can't be
  forged. Keep the share-text format otherwise.
- **Realtime (the "realtime" requirement):** Socket.IO namespace `/live`:
  - `daily:solved` broadcast (name, score, stars) → live-updating leaderboard and a subtle
    "🐾 Whiskers just scored 31" ticker on the daily panel;
  - `daily:stats` (submission count, average, histogram buckets) pushed on change — replaces demo
    community stats with real ones;
  - reconnect-safe: all live data also available via REST polling fallback.
- Frontend changes: swap localStorage-only paths for API calls where online (keep localStorage as offline
  cache + optimistic UI; the game must still be fully playable offline for campaign/tutorial).

Acceptance: two browsers on different machines see the same daily, both submit once (second attempt 409),
leaderboard updates live in <1s, forged score attempts (edited payload, extra fences, resubmission) all rejected —
write jsdom/integration tests for each rejection path.

## 3. Milestone 3 — AI generation server-side + Admin area

**Move all LLM calls to the server.** Remove the client-side provider calls and the user API-key settings
UI. `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` live only in Railway env vars.

- `POST /api/admin/generate {provider, hint, difficulty}` → runs the existing prompt + `validateAiLevel`
  + solver pipeline server-side, stores result as `aiLevels` draft, returns preview (map + target + solution map).
- `POST /api/admin/levels/:id/publish` → publishes as a future daily (`dailyLevels` for a chosen day) or
  as a community level.
- `POST /api/admin/daily/regenerate/:day`, `GET /api/admin/stats` (players, submissions, retention).
- **Admin auth (owner-only requirement):** single-owner model, keep it minimal and safe:
  1. `ADMIN_PASSWORD_HASH` (argon2) in env; `/admin` login form posts the password over HTTPS;
  2. on success server sets an `HttpOnly; Secure; SameSite=Strict` session cookie (signed with `SESSION_SECRET`, 24h);
  3. all `/api/admin/*` routes check the cookie; 5 attempts/hour/IP rate limit; every action → `adminAudit`.
  - The admin UI is a separate route/page in the frontend (`/admin.html`), which is harmless to ship publicly
    since all power is server-side. Do NOT gate by hiding the URL; gate by the session.
- Optional user-facing AI Lab can remain, but calls go through `POST /api/ailab/generate` with a strict
  per-player quota (e.g. 3/day) since the owner now pays for tokens — or keep AI Lab admin-only initially
  (recommended; ask the owner).

Acceptance: no provider key appears in any client-served byte (verify: `grep -r "sk-\|api.anthropic\|api.openai" web/dist`);
admin routes 401 without cookie; wrong password lockout works; generated level publishes and appears as a future daily.

## 4. Milestone 4 — Domain, deployment, hardening

- **Vercel:** project rooted at `/web`. It's a static site — no framework needed. Add
  `vercel.json` headers: CSP (`default-src 'self'; connect-src 'self' https://api.<domain> wss://api.<domain>`,
  no `unsafe-inline` for scripts — move the inline script to a `.js` file during the split),
  `X-Content-Type-Options`, `Referrer-Policy`.
- **Railway:** service from `/server`, add custom domain `api.<domain>`, enable HTTPS (automatic).
- **DNS:** apex + `www` → Vercel; `api` → Railway CNAME.
- **Frontend config:** `API_BASE` injected at build (`https://api.<domain>`); localhost fallback for dev.
- **Security checklist (run explicitly before launch and paste results in the PR):**
  - [ ] `git log -p | grep -iE "sk-|key|secret|mongodb\+srv"` — no secrets ever committed; add `.env` to `.gitignore` from commit one.
  - [ ] All secrets in Railway/Vercel env vars: `MONGODB_URI`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
        `SESSION_SECRET`, `SHARE_SECRET`, `ADMIN_PASSWORD_HASH`.
  - [ ] CORS locked to the production origin(s). No `*`.
  - [ ] All inputs schema-validated (fastify schemas / zod): fence arrays (ints, bounds, count ≤ walls),
        names, day numbers, level JSON from LLM (already have `validateAiLevel` — enforce again server-side).
  - [ ] Rate limits on: register, name claim, submit, AI generate, admin login.
  - [ ] Mongo queries use typed values only (cast day → int, never spread client objects into queries — no operator injection).
  - [ ] No stack traces to clients; structured logs on server.
  - [ ] Dependency audit: `npm audit --omit=dev` clean or triaged.
  - [ ] Legacy prototype caveat: the OLD client stored user AI keys in localStorage under `purr_settings`.
        On first load of the new client, **delete `settings.apiKey`** from localStorage (migration line).
- **Ops:** Railway healthcheck on `/healthz`; Mongo backups (Atlas automatic or Railway backup add-on);
  basic uptime alert (Better Uptime/UptimeRobot free tier); Sentry (or console-only) for server errors.

Acceptance: site live on the domain, API on api.<domain>, CSP passes, checklist all green.

## 5. Milestone 5 — polish for launch (small but important)

- Migrate local progress: on first API registration, upload existing localStorage campaign/stats/history
  so current players keep progress.
- PWA manifest + service worker (offline campaign; the daily requires network by design).
- Share deep link: `https://<domain>/#d<day>` opens that daily (or its archive page after the day passes).
- OG meta tags + a static social image so shares unfurl nicely.
- Future (explicitly out of scope now, leave hooks): Stripe for archive premium (`entitlements: ['archive']`),
  seasonal campaigns, native iOS port of the final web feature set.

## 6. Working agreements for the executing LLM

1. **Never regress the "Hard-won product decisions"** in `GAME_OVERVIEW.md` §4. The owner rejected those
   features personally; re-adding them is the fastest way to fail review.
2. `shared/core.js` is the single source of rules. Server and client import the same file. If you must
   change rules, change them once, re-validate all 35 campaign solutions (script exists), and re-solve the daily pipeline.
3. Every level published (daily, AI, campaign) must have a solver-verified `target` and a `solution` that
   replays to exactly that target. This is a release gate, not a suggestion.
4. Keep the game fully playable offline for tutorial/campaign; degrade gracefully when the API is down
   (show demo-free UI states, not errors).
5. Test discipline: extend the jsdom harness for every UI change; add supertest/integration tests for every
   endpoint (happy path + at least the abuse paths listed in acceptance criteria).
6. Ask the owner before: adding third-party services beyond Vercel/Railway/Mongo, changing the visual
   design language, changing scoring rules, or enabling user-facing AI generation quotas.
7. Deployment order: server first (M1–M3 behind `api.` domain), verify with the prototype pointed at it
   locally, then cut the frontend over (M4). Do not big-bang.

## 7. Current-state pointers

- Latest playable build: `web/index.html` (also mirrored in the owner's Cowork outputs; both identical as of handoff).
- Level workbenches: `web/newlevels.js`, `web/newlevels2.js`, `web/sols*.json` — reuse for future level batches.
- Solver params that reliably reproduce targets: `iters:14000–16000, restarts:5–6, seeds [7, 99, 555]`.
- The 35-level campaign order and rationale are in `GAME_OVERVIEW.md` §3.
- Daily epoch: `2026-07-01` = Daily #1. The production daily generator MUST keep this epoch and seed
  formula (`day * 2654435761 % 2**31`) so pre-launch archive days match what early players saw.
