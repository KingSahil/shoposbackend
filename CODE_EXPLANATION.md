# KiranaBot Code Explanation

This document explains the current bot code as it exists in this repository.

## Entry point: `src/server.js`

`src/server.js` is the orchestration layer. It is responsible for:

- loading environment variables
- starting Baileys auth with `useMultiFileAuthState`
- maintaining a process lock so two bot instances do not share the same token directory
- printing QR codes to the terminal
- updating `users/{uid}/bot/status` in Firestore
- reconnecting after recoverable disconnects
- rejecting unsupported chats, groups, and unauthorized senders
- routing inbound messages through AI parsing first, then the stage system

Important behaviors:

- `ALLOWED_PHONE_NUMBER` or `ALLOWED_CHAT_JID` gates who can interact with the bot
- `ALLOW_FROM_ME` is intentionally off by default to avoid loops
- a Firestore listener watches `users/{uid}/bot/status.requestedAction` for remote logout commands
- non-recoverable disconnects such as `loggedOut`, `badSession`, and `connectionReplaced` shut the process down cleanly

## Local state: `src/db.js` and `src/storage.js`

The bot keeps lightweight chat state in SQLite:

- database file: `botwhatsapp.db`
- table: `user_state`
- columns:
  - `phone_number`
  - `stage`
  - `state_data`
  - `last_updated_at`

`src/storage.js` wraps this with:

- `getState(phoneNumber)`: returns either stored state or a default object
- `setState(phoneNumber, state)`: upserts the state row
- `getUsersByStage(stages)`: convenience lookup
- `getAbandonedCarts(stageList, timeThreshold)`: used for cart recovery logic

Default state currently contains:

```js
{
  phone_number,
  stage: 0,
  itens: [],
  address: '',
  history: [],
}
```

The `history` array is used by the AI flow to give Groq a small rolling context window.

## Catalog loading: `src/menu.js`

The exported `menu` object is resolved at module load time:

1. a small static fallback menu is defined first
2. `fetchMenuFromFirebase()` is called
3. if Firestore returns inventory rows, they replace the fallback menu

Each menu item is normalized into a numeric-key object shape like:

```js
{
  description,
  price,
  id,
  sku,
  stock,
}
```

This means the menu reflects the merchant's Firestore inventory when Firebase access succeeds.

## Firebase integration: `src/firebase_client.js`

This file is the bridge between the bot and the KiranaKeeper web app data.

It currently handles:

- Firebase app initialization
- email/password sign-in for Firestore access
- catalog reads from `inventory`
- order writes to `orders`
- inventory stock decrements after successful order creation
- udhaar writes/updates
- order cancellation lookup by phone
- bot status updates
- merchant summary fetches for admin AI queries

The merchant user ID is discovered by querying the `inventory` collection group and taking the first matching parent path. That assumption is important: the bot expects at least one inventory document to exist for the target merchant.

## AI flow: `src/nlp/index.js`, `src/nlp/groq.js`, `src/nlp/parser.js`

The AI pipeline is optional and only enabled when `GROQ_API_KEY` is present.

### `src/nlp/index.js`

This file exposes `processNaturalLanguage()` and contains the high-level rules:

- skip NL processing when AI is disabled
- skip AI when a chat is already in later stages where stage handling should win
- prefilter messages so short navigational input does not waste tokens
- route admin senders into the admin query flow
- route customers into order-intent parsing

Supported AI customer intents:

- `greeting`
- `show_menu`
- `confirm_order`
- `cancel_order`
- `new_order`
- `other`

Supported admin behavior:

- fetch all current order, inventory, and udhaar data
- answer natural-language business questions about the merchant's data

### `src/nlp/groq.js`

This file defines the actual Groq calls.

For customers, it uses tool calling with three functions:

- `create_order`
- `confirm_last_order`
- `not_an_order`

For admins, it sends a prompt containing summarized Firestore business data and asks the model to answer in a concise shopkeeper-friendly tone.

### `src/nlp/parser.js`

This file contains:

- `shouldAttemptNLParsing(message)`: fast keyword/pattern gate before calling Groq
- helper utilities for cart-building and summary generation

Some summary helpers here are not currently used by `server.js`, but the intent prefilter is active.

## Stage flow: `src/stages/*.js`

Even with AI enabled, the deterministic stage system still runs the bot's core transactional flow.

### `src/stages/0.js`

- greets the user
- moves them to stage 1

### `src/stages/1.js`

- handles greetings
- shows the menu
- strips common prefixes like "i want" or "give me"
- extracts simple numeric or word quantities
- performs fuzzy item matching
- stores `pendingItem` and `pendingQuantity`
- moves to stage 2 for confirmation

### `src/stages/2.js`

- expects yes/no style confirmation
- on yes:
  - moves to stage 3 if `customerName` is missing
  - otherwise jumps to stage 4
- on no:
  - clears the draft and returns to stage 1

### `src/stages/3.js`

- captures `customerName`
- moves to stage 4

### `src/stages/4.js`

- expects either immediate payment or udhaar
- builds a single-item order payload from the pending draft
- writes the order to Firestore
- optionally writes/updates udhaar
- clears `pendingItem` and `pendingQuantity`
- returns to stage 1

### `src/stages/5.js`

- resets some state
- reuses stage 1 logic immediately

### `src/stages/99.js`

- handles replies after abandoned-cart reminders
- can cancel or resume the flow

## Scheduled jobs: `src/cron_jobs.js`

The cron subsystem currently runs one recovery job:

- schedule: every 10 minutes
- selection rule: users in stages 2 or 3 with `last_updated_at` older than 1 hour
- action:
  - send a reminder listing their item descriptions
  - move them to stage 99

This relies on the local SQLite state, not Firestore order history.

## Utility helpers: `src/utils.js`

The helper module mainly exists for JID and phone normalization:

- `normalizePhoneNumber()`
- `extractPhoneFromJid()`
- `resolveLid()`

`resolveLid()` reads Baileys-generated mapping files from `tokens/session-name`, which matters when WhatsApp sends `@lid` identifiers instead of plain phone-number JIDs.

## Data flow summary

### Customer order flow

1. incoming message arrives in `server.js`
2. sender is validated
3. AI parser may turn natural language into an order draft
4. stage flow confirms item, asks for name, and asks for payment mode
5. `saveOrderToFirebase()` writes the order
6. inventory stock is decremented in Firestore
7. local stage state is reset for the next interaction

### Admin query flow

1. message arrives from the allowed admin sender
2. AI parser fetches merchant orders, inventory, and udhaar from Firestore
3. Groq generates a business-aware answer
4. the response is sent back on WhatsApp

## Most important operational assumptions

- only one process should own the token directory
- Firestore inventory must exist so the bot can resolve a merchant UID
- persistent disk is needed for `tokens/` and `botwhatsapp.db`
- Groq access is optional but strongly shapes the user experience when enabled
