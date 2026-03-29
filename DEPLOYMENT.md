# KiranaBot Deployment Guide

## Hosting model

KiranaBot must run as an always-on Node service. It is not suitable for Firebase Hosting or stateless serverless functions in its current form.

Why:

- it maintains a live WhatsApp socket
- it stores auth state under `tokens/session-name`
- it stores local state in `botwhatsapp.db`
- it runs cron jobs

## Good deployment targets

- Railway with persistent storage
- VPS with PM2
- Docker on a VM or persistent container host

## Requirements for any host

- Node.js 18+
- persistent volume or disk mount for:
  - `tokens/`
  - `botwhatsapp.db`
- outbound network access to:
  - WhatsApp/Baileys endpoints
  - Firebase
  - Groq, if AI is enabled

## Railway

Recommended when you want the simplest cloud setup.

Steps:

1. push `kiranabot` to GitHub
2. create a Railway project from the repo
3. set the start command to `npm start`
4. add environment variables from `.env`
5. attach a persistent volume
6. mount the volume so `tokens/` and `botwhatsapp.db` survive restarts
7. deploy and scan the QR from logs

## VPS with PM2

```bash
npm install
pm2 start src/server.js --name kiranabot
pm2 save
```

Recommended extras:

- reverse proxy only if you add HTTP endpoints later
- log rotation
- regular backups for `botwhatsapp.db`

## Docker

Basic shape:

```dockerfile
FROM node:20
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
CMD ["npm", "start"]
```

Important:

- mount a volume for `/app/tokens`
- mount a volume for `/app/botwhatsapp.db` or the enclosing working directory

## Persistence checklist

If persistence is missing, expect:

- repeated QR scans
- dropped local stage state
- inconsistent abandoned-cart behavior

Persist at minimum:

- `tokens/session-name`
- `botwhatsapp.db`

## Not recommended right now

- Firebase Hosting
- Cloud Functions
- Vercel serverless functions
- Netlify functions

These are all poor fits for an app that needs a durable socket session plus filesystem state.
