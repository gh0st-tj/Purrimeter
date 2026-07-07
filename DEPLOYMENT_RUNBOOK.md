# Purrimeter Deployment Runbook

This is the practical path to get Purrimeter live with the least work possible while keeping the production plan intact.

## The honest shortest path

There are two different meanings of "live":

1. **Public beta live today:** deploy the existing `web/index.html` as a static Vercel site.
   - Works: tutorial, campaign, daily puzzle, archive, local progress, share cards, settings, AI Lab with user-supplied keys.
   - Does not work as production: real global leaderboard, anti-cheat, server-side one-submit daily, server-side AI generation, admin publishing.
   - Best for: getting a URL, testing the game, collecting feedback.

2. **Production live:** build the `/server` Railway API, Mongo persistence, server-side daily scoring, server-side AI generation, and admin area from `PRODUCTION_PLAN.md`.
   - Works as the real product.
   - Requires backend implementation first.

Recommendation: **ship static beta first, then build production milestones 1-4.** Do not block the first playable URL on the server.

## Before anything

Confirm these two choices:

- Mongo location: **MongoDB Atlas** is recommended unless you already have Railway Mongo. Atlas has clearer backups and is easier to keep outside Railway failures.
- AI Lab launch mode: **admin-only at first** is recommended. The current prototype exposes provider calls in the client and stores user-supplied keys in `localStorage`. Do not put your own OpenAI/Anthropic key into the public client.

## Current repo status

The current folder is not a git repository yet. The web app is under:

```sh
/Users/tom/Desktop/scripts/Purrimeter/web
```

The deployable file already exists:

```sh
web/index.html
```

It is generated from:

```sh
cat web/head.html web/style.css web/mid.html web/core.js web/ui.js web/tail.html > web/index.html
```

## Phase 1 - Put the project on GitHub

From your terminal:

```sh
cd /Users/tom/Desktop/scripts/Purrimeter
```

Create a `.gitignore` before the first commit:

```sh
cat > .gitignore <<'EOF'
.DS_Store
node_modules/
web/node_modules/
.env
.env.*
!.env.example
dist/
build/
coverage/
__pycache__/
*.pyc
*.zip
EOF
```

Initialize git:

```sh
git init
git branch -M main
git add .gitignore GAME_OVERVIEW.md PRODUCTION_PLAN.md DEPLOYMENT_RUNBOOK.md web Purrimeter levelcheck.py opt2.py
git commit -m "Initial Purrimeter web prototype"
```

Create the GitHub repo. Easiest path:

```sh
gh auth login
gh repo create purrimeter --private --source=. --remote=origin --push
```

If you do not use GitHub CLI:

1. Create a new GitHub repo named `purrimeter`.
2. Copy its remote URL.
3. Run:

```sh
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

Keep the repo private until you have removed or accepted the prototype limitations.

## Phase 2 - Deploy static beta on Vercel

This gets you a playable URL with almost no work.

1. Go to Vercel.
2. Choose **Add New Project**.
3. Import the GitHub repo.
4. Set these project settings:

| Setting | Value |
|---|---|
| Framework Preset | Other |
| Root Directory | `web` |
| Build Command | empty / none |
| Output Directory | `.` |
| Install Command | `npm install` or empty |

5. Click **Deploy**.
6. Open the generated `*.vercel.app` URL.

Smoke test the deployed site:

- New visitor sees tutorial.
- Campaign level opens and can submit.
- Daily challenge opens.
- Archive opens.
- Dark mode looks readable.
- Share card does not reveal fences.

Important beta warning:

- The current global leaderboard is fake/demo.
- Daily one-submit is only enforced in the browser.
- Do not enter your own paid provider API key into the hosted public prototype.

## Phase 3 - Add a custom domain

In Vercel:

1. Open the Purrimeter project.
2. Go to **Settings -> Domains**.
3. Add your domain, for example:

```txt
purrimeter.com
www.purrimeter.com
```

4. Follow Vercel's DNS instructions at your domain registrar.

Typical DNS shape:

```txt
www  CNAME  cname.vercel-dns.com
@    A      Vercel-provided apex record
```

Use the exact DNS values Vercel gives you, not guessed values.

## Phase 4 - Minimal beta hardening before sharing widely

Do these before sending the URL to a lot of people:

1. Rebuild `web/index.html` from source:

```sh
cd /Users/tom/Desktop/scripts/Purrimeter
cat web/head.html web/style.css web/mid.html web/core.js web/ui.js web/tail.html > web/index.html
```

2. Syntax-check the JavaScript:

```sh
node --check web/core.js
node --check web/ui.js
```

3. Search for committed secrets:

```sh
git grep -n -i -E "sk-|api[_-]?key|secret|mongodb\\+srv|anthropic_api_key|openai_api_key"
```

Expected result: only placeholder UI text or documentation, no real keys.

4. Commit and push:

```sh
git add web/index.html web/core.js web/ui.js web/style.css
git commit -m "Prepare beta web deploy"
git push
```

Vercel will redeploy automatically.

## Phase 5 - Build the production backend

Do this after the beta URL works. This is the least risky production order.

### 5.1 Restructure the repo

Create:

```txt
/web
/server
/shared
/docs
```

Move:

```txt
web/core.js -> shared/core.js
GAME_OVERVIEW.md -> docs/GAME_OVERVIEW.md
PRODUCTION_PLAN.md -> docs/PRODUCTION_PLAN.md
DEPLOYMENT_RUNBOOK.md -> docs/DEPLOYMENT_RUNBOOK.md
```

Then update imports/build concatenation so the browser still uses the exact same `core.js`.

Release gate:

```sh
node --check shared/core.js
```

### 5.2 Create Mongo

Recommended: MongoDB Atlas.

1. Create an Atlas project.
2. Create a cluster.
3. Create a database user just for Purrimeter.
4. Allow Railway to connect. The lazy beta approach is Atlas network access `0.0.0.0/0`; the stricter approach is Railway static outbound networking if you add it later.
5. Copy the connection string.

The final variable should look like:

```txt
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<database>?retryWrites=true&w=majority
```

Use a database name like:

```txt
purrimeter
```

### 5.3 Create Railway service

In Railway:

1. Create a new project.
2. Deploy from the same GitHub repo.
3. Set the service root directory to:

```txt
server
```

4. Add service variables:

```txt
NODE_ENV=production
PORT=3000
MONGODB_URI=<your Mongo connection string>
SITE_ORIGIN=https://purrimeter.com
SESSION_SECRET=<random 32+ byte string>
SHARE_SECRET=<random 32+ byte string>
ADMIN_PASSWORD_HASH=<argon2 hash>
ANTHROPIC_API_KEY=<optional, server only>
OPENAI_API_KEY=<optional, server only>
ARCHIVE_REQUIRES_PREMIUM=false
```

Generate secrets locally:

```sh
openssl rand -base64 32
```

Generate the admin argon2 hash from the future server project, not from an online website.

### 5.4 Backend endpoints to build first

Build only this first slice:

```txt
GET  /healthz
POST /api/register
GET  /api/daily
POST /api/daily/submit
GET  /api/leaderboard/:day
```

This is enough to replace the fake daily/leaderboard flow.

Do not build payments, OAuth, cosmetics, or social features first.

Acceptance criteria:

- `GET /healthz` returns 200 on Railway.
- The server creates Mongo indexes at startup.
- A new browser can register anonymously.
- Two browsers receive the same daily.
- A submitted score is calculated by server-side `shared/core.js`, not trusted from the client.
- A second submit for the same player/day returns 409.
- Editing the request payload to add illegal fences is rejected.

### 5.5 Add realtime after real submit works

Only after submit and leaderboard are correct:

```txt
Socket.IO namespace: /live
Broadcast: daily:solved
Broadcast: daily:stats
```

The frontend should still work without WebSocket by refetching the leaderboard.

### 5.6 Move AI generation server-side

Remove provider-key UI from public settings.

Build:

```txt
POST /api/admin/login
POST /api/admin/generate
POST /api/admin/levels/:id/publish
GET  /api/admin/stats
```

Security rules:

- Provider keys live only in Railway variables.
- Admin password is stored only as `ADMIN_PASSWORD_HASH`.
- Admin session uses `HttpOnly; Secure; SameSite=Strict` cookie.
- Login is rate-limited.
- Every admin action writes to `adminAudit`.

Launch recommendation: keep AI generation **admin-only** at first.

## Phase 6 - Wire production frontend to API

Add a tiny frontend config file or build-time replacement:

```js
window.PURRIMETER_API_BASE = 'https://api.purrimeter.com';
```

Local fallback:

```js
const API_BASE = window.PURRIMETER_API_BASE || 'http://localhost:3000';
```

Required frontend behavior:

- On first load, register anonymous device if no token exists.
- Store `{ playerId, token }` in localStorage.
- Send `Authorization: Bearer <token>` to API calls.
- Keep campaign playable offline.
- Daily submission requires network.
- Delete old stored user API keys:

```js
const settings = JSON.parse(localStorage.getItem('purr_settings') || '{}');
if (settings.apiKey) {
  delete settings.apiKey;
  localStorage.setItem('purr_settings', JSON.stringify(settings));
}
```

## Phase 7 - Add API domain

In Railway:

1. Open the API service.
2. Go to networking/public domain.
3. Add:

```txt
api.purrimeter.com
```

4. Railway will provide DNS records. Add exactly those records at your registrar.
5. Wait for SSL to become active.

Then set:

```txt
SITE_ORIGIN=https://purrimeter.com
```

And set frontend API base to:

```txt
https://api.purrimeter.com
```

## Phase 8 - Final production launch checklist

Do not call it production until all are true:

- Vercel site is on the real domain.
- Railway API is on `api.<domain>`.
- CORS allows only your domain and localhost dev.
- No client-served file contains real provider keys.
- No provider call goes directly from browser to OpenAI/Anthropic.
- Mongo indexes exist.
- Every daily level has solver-verified `target` and `solution`.
- Submissions are server-scored using the shared engine.
- Resubmission is blocked for daily.
- Archive paywall flag exists but is set to free:

```txt
ARCHIVE_REQUIRES_PREMIUM=false
```

- CSP headers are set on Vercel.
- `npm audit --omit=dev` is clean or triaged in `/server`.
- You have a Mongo backup story.
- You have checked logs after a real submission.

## What to ask the next executor to do

Use this exact prompt:

```txt
Read docs/GAME_OVERVIEW.md, docs/PRODUCTION_PLAN.md, and docs/DEPLOYMENT_RUNBOOK.md.

Goal: implement production milestones 1 and 2 only.

Constraints:
- Reuse shared/core.js as the only rules engine.
- Do not change scoring rules.
- Do not show goals before submission.
- Do not add sound, drag-painting, route hints, visible pre-submit targets, or a wandering cat.
- Keep tutorial/campaign offline-capable.
- Keep AI generation admin-only for now.

Deliver:
- /server Railway-ready Node API.
- Mongo startup indexes.
- Anonymous device registration.
- Authoritative daily endpoint and submit endpoint.
- Real leaderboard endpoint.
- Integration tests for register, daily fetch, valid submit, duplicate submit, illegal fence rejection, forged score rejection.
```

## Quick decision tree

If you want a URL today:

```txt
GitHub -> Vercel root web -> deploy -> custom domain
```

If you want a real competitive daily game:

```txt
Build /server -> Mongo -> Railway -> API domain -> frontend API integration -> Vercel production
```

If you want the least work and least risk:

```txt
Static beta now, production backend next, AI admin-only until usage/cost is understood.
```
