# KiranaBot Troubleshooting

## 1. The bot starts but never replies

Check these first:

- `ALLOWED_PHONE_NUMBER` is set correctly in digits-only format
- or `ALLOWED_CHAT_JID` matches the exact WhatsApp JID
- the incoming chat is not a group
- the bot is actually connected and `connection === open`

The bot intentionally ignores most inbound traffic unless the sender is explicitly allowed.

## 2. The QR code keeps returning after every restart

Cause:

- `tokens/session-name` is not being persisted

Fix:

- deploy on a platform with mounted storage
- keep `tokens/` on persistent disk
- do not clear the tokens directory unless you want to re-pair

## 3. Orders are not syncing to the website

Check:

- `FIREBASE_EMAIL` and `FIREBASE_PASSWORD` are valid
- or set `FIREBASE_USER_ID` if you already know the merchant UID and want to bypass UID discovery
- Firestore rules allow the configured account to read and write
- the target merchant already has docs under `users/{uid}/inventory`

Why inventory matters:

- the bot resolves the merchant UID by querying the `inventory` collection group
- if inventory is empty and `FIREBASE_USER_ID` is not set, the bot does not know which `users/{uid}` branch to use

## 4. The bot only shows fallback menu items

Cause:

- `fetchMenuFromFirebase()` failed or returned no rows

Fix:

- confirm Firestore access
- confirm `users/{uid}/inventory` contains documents
- set `FIREBASE_USER_ID` when you want to pin the bot to a known merchant branch
- check terminal logs from `src/menu.js` and `src/firebase_client.js`

## 5. AI ordering is not working

Check:

- `GROQ_API_KEY` exists
- Groq network access is available
- the message is long enough to pass the prefilter in `src/nlp/parser.js`

Expected behavior:

- without `GROQ_API_KEY`, the bot still works, but only through stage-based flows

## 6. Admin questions are answered like a customer flow

Cause:

- the sender is not recognized as admin

Fix:

- verify the phone number extracted from the actual WhatsApp JID matches `ALLOWED_PHONE_NUMBER`
- if you rely on JID matching, verify `ALLOWED_CHAT_JID`

## 7. Another bot instance is already running

Cause:

- the lock file under `tokens/session-name/.bot.lock` points to a live process

Fix:

- stop the other process
- do not run `npm start` and `npm run dev` together
- only remove stale lock files after confirming the original process is gone

## 8. Disconnect loops or forced logout

Non-recoverable disconnects are intentionally treated as fatal in `src/server.js`.

Common reasons:

- WhatsApp session replaced by another client
- invalid or expired session state
- token mismatch after copying session files between environments

Fix:

1. stop all duplicate processes
2. if necessary, remove `tokens/session-name`
3. restart the bot
4. scan a fresh QR

## 9. Abandoned-cart reminders do not send

Check:

- the user state is still in stage 2 or 3
- `last_updated_at` is older than one hour
- the cron process has started
- the bot is still connected when the cron job runs

Reminder logic lives in [src/cron_jobs.js](C:/projects/kiranaKeeper/kiranabot/src/cron_jobs.js).

## 10. Where to look in code

- connection issues: [src/server.js](C:/projects/kiranaKeeper/kiranabot/src/server.js)
- Firestore issues: [src/firebase_client.js](C:/projects/kiranaKeeper/kiranabot/src/firebase_client.js)
- local state issues: [src/storage.js](C:/projects/kiranaKeeper/kiranabot/src/storage.js)
- AI intent issues: [src/nlp/groq.js](C:/projects/kiranaKeeper/kiranabot/src/nlp/groq.js)
- stage behavior: [src/stages](C:/projects/kiranaKeeper/kiranabot/src/stages)
