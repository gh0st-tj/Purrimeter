# Purrimeter Server

Railway service for production Purrimeter.

## Required Railway variables

```txt
NODE_ENV=production
PORT=3000
MONGODB_URI=<mongo connection string>
SITE_ORIGIN=https://<your-domain>
SITE_ORIGINS=https://<your-domain>,https://www.<your-domain>
SESSION_SECRET=<openssl rand -base64 32>
SHARE_SECRET=<openssl rand -base64 32>
ADMIN_PASSWORD_HASH=<npm run hash-admin-password output>
ARCHIVE_REQUIRES_PREMIUM=false
OPENAI_API_KEY=<optional, server only>
ANTHROPIC_API_KEY=<optional, server only>
```

## Admin password hash

```sh
cd server
npm install
npm run hash-admin-password -- "your-long-admin-password"
```

Put only the resulting hash in Railway as `ADMIN_PASSWORD_HASH`.

## Local run

```sh
cd server
cp .env.example .env
npm install
npm run dev
```

The frontend defaults to `http://localhost:3000` when served from localhost.
