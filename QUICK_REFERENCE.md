# KiranaBot Quick Reference

## Commands

```bash
npm install
npm start
npm run dev
```

## Required files and folders

- `src/server.js`
- `src/firebase_client.js`
- `src/storage.js`
- `src/menu.js`
- `src/nlp/`
- `src/stages/`
- `tokens/session-name/`
- `botwhatsapp.db`

## Important environment variables

- `ALLOWED_PHONE_NUMBER`
- `ALLOWED_CHAT_JID`
- `ALLOW_FROM_ME`
- `GROQ_API_KEY`
- `GROQ_MODEL`
- `FIREBASE_EMAIL`
- `FIREBASE_PASSWORD`

## Core flows

### Customer

`message -> AI prefilter -> AI parse or stage router -> pending item -> name -> payment choice -> Firestore order write`

### Admin

`allowed sender -> AI admin query -> Firestore summary fetch -> WhatsApp response`

## Stage map

- `0`: welcome
- `1`: menu and fuzzy item lookup
- `2`: yes/no order draft confirmation
- `3`: capture customer name
- `4`: payment method and final write
- `5`: reset and re-enter stage 1
- `99`: abandoned-cart recovery reply

## SQLite table

```sql
SELECT phone_number, stage, state_data, last_updated_at
FROM user_state;
```

Useful queries:

```sql
SELECT phone_number, stage FROM user_state;
```

```sql
SELECT phone_number
FROM user_state
WHERE stage IN (2, 3)
AND last_updated_at < (strftime('%s','now') * 1000 - 3600000);
```

## Firestore collections the bot touches

- `users/{uid}/inventory`
- `users/{uid}/orders`
- `users/{uid}/udhar`
- `users/{uid}/bot/status`

## Common code entry points

- change reconnect or sender filtering: `src/server.js`
- change menu fetch behavior: `src/menu.js`
- change order confirmation language: `src/stages/2.js`
- change payment flow: `src/stages/4.js`
- change abandoned-cart message: `src/cron_jobs.js`
- change AI parsing behavior: `src/nlp/groq.js` and `src/nlp/index.js`

## Behavioral notes

- `pendingItem` and `pendingQuantity` drive the final order flow
- `customerName` is persisted in local state once collected
- inventory stock is decremented in Firestore only after order save succeeds
- admin behavior depends on the sender matching the configured allowlist

## Debugging checklist

1. Check that the bot is logged in and the QR has been scanned
2. Confirm only one process is using `tokens/session-name`
3. Confirm `.env` values are present
4. Confirm Firestore inventory exists for the merchant
5. Confirm the sender matches `ALLOWED_PHONE_NUMBER` or `ALLOWED_CHAT_JID`
6. If AI seems inactive, verify `GROQ_API_KEY`

## Common symptoms

- no replies at all: allowlist misconfiguration or no session
- menu falls back to static items: Firebase inventory fetch failed
- order saves fail: Firebase auth or Firestore access issue
- QR keeps reappearing after restart: token directory is not persisted
- self-message loops: `ALLOW_FROM_ME=true` in the wrong environment
