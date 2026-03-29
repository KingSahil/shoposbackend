# KiranaBot

KiranaBot is the WhatsApp automation service for KiranaKeeper. It connects to WhatsApp through Baileys, reads the live catalog from Firebase, accepts natural-language or menu-style ordering, writes confirmed orders back to Firestore, optionally records udhaar balances, and keeps a small local SQLite database for conversational state.

## What it does

- Connects to WhatsApp Web multi-device using `@whiskeysockets/baileys`
- Restricts inbound handling to an allowed admin number or chat
- Loads inventory from Firebase and exposes it as the current menu
- Accepts both stage-based flows and Groq-powered natural language ordering
- **NEW: Admin Mode** - When messages come from the configured admin number, provides business analytics instead of customer ordering
- Stores per-chat state in `botwhatsapp.db`
- Sends abandoned-cart nudges every 10 minutes for carts idle over 1 hour
- Syncs orders, inventory changes, udhaar entries, and bot status to Firestore

## Current runtime architecture

```text
WhatsApp message
  -> src/server.js
  -> sender filtering / lock handling / reconnect logic
  -> src/nlp/index.js (if Groq is configured and message looks suitable)
  -> stage router in src/stages.js
  -> Firestore sync in src/firebase_client.js
  -> local state persistence in src/storage.js + botwhatsapp.db
```

## Project structure

- `src/server.js`: Baileys bootstrap, QR handling, reconnect logic, admin filtering, message dispatch
- `src/firebase_client.js`: Firebase auth plus Firestore reads and writes for orders, inventory, udhaar, bot status, and admin summaries
- `src/storage.js`: local SQLite-backed conversation state helpers
- `src/db.js`: SQLite initialization
- `src/menu.js`: Firebase-backed catalog loader with a static fallback menu
- `src/stages/*.js`: deterministic menu flow
- `src/nlp/*.js`: Groq integration, intent parsing, and prefilter logic
- `tokens/session-name/`: Baileys auth/session files
- `botwhatsapp.db`: local user state database

## Stage flow

The current stage labels in code are slightly older than the actual behavior, so use the behavior below as source of truth:

1. `stage 0`: greeting, moves the chat into ordering mode
2. `stage 1`: menu display, greetings, fuzzy product lookup, order draft creation
3. `stage 2`: yes/no confirmation for the draft item
4. `stage 3`: captures customer name if it is missing
5. `stage 4`: payment choice, final order write, optional udhaar entry
6. `stage 5`: pass-through helper that resets and reuses stage 1 logic
7. `stage 99`: abandoned-cart recovery reply handling

## Environment variables

Copy [.env.example](C:/projects/kiranaKeeper/kiranabot/.env.example) to `.env` and fill in the values you need.

Required for practical use:

- `ALLOWED_PHONE_NUMBER`: digits-only phone number allowed to trigger the bot
- `GROQ_API_KEY`: enables natural-language ordering and admin AI queries
- `FIREBASE_EMAIL`: Firebase email/password login used by the bot to access Firestore
- `FIREBASE_PASSWORD`: password for the account above

Optional:

- `ADMIN_PHONE_NUMBER`: your business phone number (digits only) - enables admin mode for business queries
- `ALLOWED_CHAT_JID`: exact WhatsApp JID allowed to trigger the bot
- `GROQ_MODEL`: defaults to `llama-3.3-70b-versatile`
- `ALLOW_FROM_ME`: set to `true` only for testing self-sent messages
- `FIREBASE_USER_ID`: explicit `users/{uid}` branch to use when you want to skip merchant UID discovery or work around broken Firebase Auth

## Local development

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example`
3. Start the bot:

```bash
npm start
```

For active development:

```bash
npm run dev
```

4. Watch the terminal for the QR code
5. Scan it from the WhatsApp account you want to pair

## Firebase expectations

The bot assumes a Firestore layout rooted under `users/{uid}` and discovers the merchant `uid` by querying the `inventory` collection group unless `FIREBASE_USER_ID` is provided. At minimum, the connected merchant should have:

- `users/{uid}/inventory`
- `users/{uid}/orders`
- `users/{uid}/udhar`
- `users/{uid}/bot/status`

If inventory is empty and `FIREBASE_USER_ID` is not set, the bot cannot resolve which merchant to sync against.

## Production notes

This app is not a Firebase Hosting target. It is a long-running Node process with:

- persistent WhatsApp auth files in `tokens/`
- a local SQLite file
- cron jobs
- a live socket connection

Best deployment options:

- Railway with persistent storage
- a VPS with PM2 or Docker
- another always-on container/VPS platform with a mounted volume

Avoid purely serverless hosting unless you first redesign session and database storage.

## Key limitations

- Only one bot process should run against the same token directory
- Without persistent storage, QR pairing will be lost on restart
- Menu freshness depends on Firestore inventory access
- AI flows are disabled when `GROQ_API_KEY` is missing

## Related docs

- [ADMIN_FEATURE.md](C:/projects/kiranaKeeper/kiranabot/ADMIN_FEATURE.md) - **NEW: Admin mode documentation**
- [CODE_EXPLANATION.md](C:/projects/kiranaKeeper/kiranabot/CODE_EXPLANATION.md)
- [QUICK_REFERENCE.md](C:/projects/kiranaKeeper/kiranabot/QUICK_REFERENCE.md)
- [TROUBLESHOOTING.md](C:/projects/kiranaKeeper/kiranabot/TROUBLESHOOTING.md)
- [DEPLOYMENT.md](C:/projects/kiranaKeeper/kiranabot/DEPLOYMENT.md)
- [DOCUMENTATION_MAP.md](C:/projects/kiranaKeeper/kiranabot/DOCUMENTATION_MAP.md)
