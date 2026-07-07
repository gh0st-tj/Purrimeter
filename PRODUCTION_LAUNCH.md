# Purrimeter Production Launch - Exact Steps

Use this guide literally. Anywhere you see `YOUR_DOMAIN.com`, replace it with the domain you buy, for example `purrimeter.com`.

Important vocabulary:

- **Variable name**: the left side, such as `SESSION_SECRET`.
- **Variable value**: the right side, such as `vR9...abc=`.
- In Railway, each environment variable is entered as two fields: **Name** and **Value**.
- Do not paste real secrets into GitHub, Vercel, docs, screenshots, or chat.

Fake example:

```txt
Name:  SESSION_SECRET
Value: fake-example-abc123-do-not-use
```

That means you create a Railway variable whose name is exactly `SESSION_SECRET`, and whose value is the generated secret string.

## 0. What You Are Deploying

```txt
web/       -> Vercel static frontend
server/    -> Railway Node API
shared/    -> shared game rules engine used by the server
Mongo      -> your persistent database
```

Production features included:

- Anonymous device accounts.
- Server-scored daily submissions.
- One daily submission per player.
- Real Mongo leaderboards.
- Realtime daily solve/stats updates through Socket.IO.
- Owner-only admin page.
- AI level generation only from server/admin.
- Provider keys never appear in the browser app.

## 1. Pick Your Domain

Decide the final domain first.

Example:

```txt
purrimeter.com
```

Then your production URLs will be:

```txt
Frontend: https://purrimeter.com
API:      https://api.purrimeter.com
Admin:    https://purrimeter.com/admin.html
```

If your domain is different, replace every `purrimeter.com` example with your actual domain.

## 2. Generate Secrets Locally

Open Terminal:

```sh
cd /Users/tom/Desktop/scripts/Purrimeter/server
npm install
```

Generate the first random secret:

```sh
openssl rand -base64 32
```

It will print something shaped like this:

```txt
2Yl1FAKEEXAMPLEaGQ49uBUiQUZ6vCrXqNTq6Y=
```

Do not use the fake example above. Use the real output from your terminal.

In Railway, create this variable:

```txt
Name:  SESSION_SECRET
Value: <the first openssl output>
```

Example shape:

```txt
Name:  SESSION_SECRET
Value: 2Yl1FAKEEXAMPLEaGQ49uBUiQUZ6vCrXqNTq6Y=
```

Now generate the second random secret:

```sh
openssl rand -base64 32
```

In Railway, create this variable:

```txt
Name:  SHARE_SECRET
Value: <the second openssl output>
```

Example shape:

```txt
Name:  SHARE_SECRET
Value: x6/FAKEEXAMPLEuZJStVh5nnmP9a8e7dDqXb0=
```

What these do:

- `SESSION_SECRET` signs your admin login cookie.
- `SHARE_SECRET` signs server friend codes.
- They should be different values.
- They should stay private forever.

## 3. Create Your Admin Password Hash

Choose a long admin password and save it in your password manager.

Example password shape:

```txt
correct-horse-example-DO-NOT-USE-7291
```

Now generate its hash:

```sh
cd /Users/tom/Desktop/scripts/Purrimeter/server
npm run hash-admin-password -- "YOUR_REAL_LONG_ADMIN_PASSWORD"
```

The command prints a hash shaped like:

```txt
$argon2id$v=19$m=65536,t=3,p=4$FAKEEXAMPLE$FAKEEXAMPLE
```

In Railway, create:

```txt
Name:  ADMIN_PASSWORD_HASH
Value: <the full argon2 hash output>
```

Important:

- Railway gets the hash, not the raw password.
- You log into `/admin.html` using the raw password you chose.
- If you lose the raw password, generate a new hash for a new password and replace `ADMIN_PASSWORD_HASH`.

## 4. Prepare Mongo

Use your existing Mongo.

You need one Mongo connection string. It should look like this:

```txt
mongodb+srv://purrimeter_app:PASSWORD@cluster0.xxxxx.mongodb.net/purrimeter?retryWrites=true&w=majority
```

In Railway, create:

```txt
Name:  MONGODB_URI
Value: <your full Mongo connection string>
```

Example shape:

```txt
Name:  MONGODB_URI
Value: mongodb+srv://purrimeter_app:FAKE_PASSWORD@cluster0.abcde.mongodb.net/purrimeter?retryWrites=true&w=majority
```

Mongo checklist:

- Database name: `purrimeter`
- Database user: `purrimeter_app`
- User permission: read/write on `purrimeter`
- Network access: allow Railway to connect.
- Easiest Atlas network access: `0.0.0.0/0`

If your Mongo password contains symbols like `@`, `/`, `:`, `#`, `?`, or `&`, URL-encode the password before putting it in the connection string.

The server creates Mongo collections and indexes automatically on startup. You do not need to manually create tables.

## 5. Push Project To GitHub

From Terminal:

```sh
cd /Users/tom/Desktop/scripts/Purrimeter
npm run check
npm run verify:core-sync
npm run verify:campaign
```

Expected:

- `npm run check` exits without errors.
- `verify:campaign` says `"campaignLevels": 35` and `"bad": []`.

If this folder is not a git repo yet:

```sh
git init
git branch -M main
git add .
git commit -m "Production Purrimeter web app"
```

Create a private GitHub repo using GitHub CLI:

```sh
gh auth login
gh repo create purrimeter --private --source=. --remote=origin --push
```

If you do not use GitHub CLI:

1. Create a private repo on GitHub named `purrimeter`.
2. Copy the repo URL.
3. Run:

```sh
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

## 6. Create Railway API Service

In Railway:

1. Click **New Project**.
2. Choose **Deploy from GitHub repo**.
3. Pick your `purrimeter` repo.
4. Set the service root directory to:

```txt
server
```

5. Set the start command to:

```txt
npm start
```

6. Set the healthcheck path to:

```txt
/healthz
```

Now add these Railway variables.

Required variables:

```txt
Name:  NODE_ENV
Value: production

Name:  MONGODB_URI
Value: <your full Mongo connection string>

Name:  SITE_ORIGIN
Value: https://YOUR_DOMAIN.com

Name:  SITE_ORIGINS
Value: https://YOUR_DOMAIN.com,https://www.YOUR_DOMAIN.com

Name:  SESSION_SECRET
Value: <your first openssl secret>

Name:  SHARE_SECRET
Value: <your second openssl secret>

Name:  ADMIN_PASSWORD_HASH
Value: <your full argon2 hash>

Name:  ARCHIVE_REQUIRES_PREMIUM
Value: false
```

Optional AI variables. Add at least one provider if you want admin AI generation.

For OpenAI:

```txt
Name:  OPENAI_API_KEY
Value: <your real OpenAI API key>

Name:  OPENAI_MODEL
Value: gpt-4o
```

For Anthropic:

```txt
Name:  ANTHROPIC_API_KEY
Value: <your real Anthropic API key>

Name:  ANTHROPIC_MODEL
Value: claude-sonnet-5
```

Provider key rule:

- Put provider keys in Railway only.
- Do not put provider keys in Vercel.
- Do not put provider keys in `web/`.
- Do not put provider keys in GitHub.

Deploy the Railway service.

After deploy, Railway gives you a temporary URL. Test:

```sh
curl https://YOUR-RAILWAY-URL.up.railway.app/healthz
```

Expected:

```json
{"ok":true}
```

## 7. Add Railway API Domain

In Railway:

1. Open your API service.
2. Go to networking/custom domain.
3. Add:

```txt
api.YOUR_DOMAIN.com
```

4. Railway will show a DNS record.
5. Go to your domain registrar.
6. Add exactly the DNS record Railway gives you.

After Railway says HTTPS is active, test:

```sh
curl https://api.YOUR_DOMAIN.com/healthz
```

Expected:

```json
{"ok":true}
```

## 8. Create Vercel Frontend

In Vercel:

1. Click **Add New Project**.
2. Import the same GitHub repo.
3. Use these settings:

```txt
Framework Preset: Other
Root Directory: web
Build Command: leave empty
Output Directory: .
Install Command: leave empty
```

Deploy.

Vercel gives you a temporary URL. Open it and confirm the game loads.

Then add your real domains in Vercel:

```txt
YOUR_DOMAIN.com
www.YOUR_DOMAIN.com
```

Go to your domain registrar and add the DNS records Vercel gives you.

After Vercel says the domains are valid, open:

```txt
https://YOUR_DOMAIN.com
```

The frontend automatically calls:

```txt
https://api.YOUR_DOMAIN.com
```

## 9. Lock CSP To Your Domain

Before your domain is final, `web/vercel.json` allows broad `https:` and `wss:` connections so deployment works.

After `api.YOUR_DOMAIN.com` is working, edit:

```txt
/Users/tom/Desktop/scripts/Purrimeter/web/vercel.json
```

Find:

```txt
script-src 'self' https:;
connect-src 'self' https: wss: http://localhost:3000 ws://localhost:3000;
```

Replace with:

```txt
script-src 'self' https://api.YOUR_DOMAIN.com;
connect-src 'self' https://api.YOUR_DOMAIN.com wss://api.YOUR_DOMAIN.com http://localhost:3000 ws://localhost:3000;
```

Then commit and push:

```sh
cd /Users/tom/Desktop/scripts/Purrimeter
git add web/vercel.json
git commit -m "Lock CSP to production API domain"
git push
```

Vercel redeploys automatically.

## 10. Final Security Checks

Run locally:

```sh
cd /Users/tom/Desktop/scripts/Purrimeter

find web -maxdepth 1 -type f \( -name '*.js' -o -name '*.html' -o -name '*.css' -o -name '*.json' \) -exec rg -n "sk-|api\.anthropic|api\.openai|dangerous-direct|x-api-key|apiKey|API key|mongodb\+srv" {} +
```

Expected:

```txt
no output
```

Then:

```sh
cd /Users/tom/Desktop/scripts/Purrimeter/server
npm audit --omit=dev
```

Expected:

```txt
found 0 vulnerabilities
```

## 11. Production Smoke Test

Use one normal browser and one private/incognito window.

Normal browser:

1. Open `https://YOUR_DOMAIN.com`.
2. Finish or skip tutorial.
3. Open Settings.
4. Set your player name.
5. Open Daily.
6. Submit a valid enclosure.
7. Open Ranks.
8. Confirm your score appears.

Private/incognito browser:

1. Open `https://YOUR_DOMAIN.com`.
2. Set a different player name.
3. Submit the Daily.
4. Confirm the normal browser leaderboard updates live or after refresh.

Admin:

1. Open `https://YOUR_DOMAIN.com/admin.html`.
2. Try a wrong password. It should fail.
3. Use your real admin password. It should log in.
4. Generate a draft level.
5. Publish it to a future day.

## 12. What Never Goes Where

Never put these in GitHub:

```txt
MONGODB_URI
SESSION_SECRET
SHARE_SECRET
ADMIN_PASSWORD_HASH
OPENAI_API_KEY
ANTHROPIC_API_KEY
```

Never put these in Vercel:

```txt
MONGODB_URI
OPENAI_API_KEY
ANTHROPIC_API_KEY
ADMIN_PASSWORD_HASH
SESSION_SECRET
SHARE_SECRET
```

Only Railway needs secrets.

Vercel only hosts static files from `web/`.

## 13. If Something Fails

Railway `/healthz` fails:

- Check `MONGODB_URI`.
- Check Mongo network access.
- Check Railway logs.

Frontend loads but daily/ranks fail:

- Check `https://api.YOUR_DOMAIN.com/healthz`.
- Check `SITE_ORIGIN` and `SITE_ORIGINS`.
- Check browser console for CORS errors.

Admin login fails:

- Make sure `ADMIN_PASSWORD_HASH` is the argon2 hash, not the raw password.
- Generate a new hash if needed.
- Redeploy Railway after changing the variable.

AI generation fails:

- Add `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` to Railway.
- Check Railway logs for provider errors.
