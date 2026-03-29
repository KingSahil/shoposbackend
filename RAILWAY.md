# Railway Deployment

This bot is ready to run on Railway as a long-lived service.

## Service setup

1. Create a new Railway project from the GitHub repo.
2. Create a service from this repo.
3. Set the service root directory to `kiranabot`.
4. Railway should detect the `Dockerfile` automatically.
5. Add a volume and mount it at `/data`.

## Required environment variables

Set these in the Railway service:

- `DATA_DIR=/data`
- `PORT=3000`
- `ALLOWED_PHONE_NUMBER=...`
- `ADMIN_PHONE_NUMBER=...` if you want admin mode
- `ALLOWED_CHAT_JID=...` if you use chat-level allowlisting
- `ALLOW_FROM_ME=false`
- `GROQ_API_KEY=...`
- `GROQ_MODEL=llama-3.3-70b-versatile` unless you want another model
- `FIREBASE_EMAIL=...`
- `FIREBASE_PASSWORD=...`
- `FIREBASE_USER_ID=...` if you want to pin the merchant record

## Health check

Railway can probe either of these endpoints:

- `/health`
- `/healthz`

The service binds to `0.0.0.0:$PORT`.

## Persistence

Mount the Railway volume at `/data` so these survive restarts:

- `/data/tokens/session-name`
- `/data/botwhatsapp.db`

Without the volume, the bot will lose its WhatsApp login and conversation state after a restart.

## First deploy

1. Deploy the service.
2. Open the service logs.
3. Wait for the QR code.
4. Scan it from the WhatsApp account that should power the bot.
5. Confirm the health endpoint returns `connection: "open"` after pairing.
