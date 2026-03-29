import 'dotenv/config';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { createServer } from "node:http";
import { rm, mkdir, readFile, unlink, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stages } from "./stages.js";
import { getState, setState } from "./storage.js";
import { startCronJobs } from "./cron_jobs.js";
import { processNaturalLanguage } from "./nlp/index.js";
import Pino from "pino";
import qrcode from "qrcode-terminal";
import { normalizePhoneNumber, extractPhoneFromJid } from './utils.js';
import { getMenu } from './menu.js';
import { updateBotStatusInFirebase, db, resolveStoreUserId } from './firebase_client.js';
import { onSnapshot, doc, collection, query, where, updateDoc } from 'firebase/firestore';
import { AUTH_PATH, DATA_DIR } from "./runtime_paths.js";

const LOCK_PATH = resolve(AUTH_PATH, ".bot.lock");
const ALLOWED_PHONE_NUMBER = (process.env.ALLOWED_PHONE_NUMBER || "").replace(/\D/g, "");
const ALLOWED_CHAT_JID = String(process.env.ALLOWED_CHAT_JID || "").trim();
const ALLOW_FROM_ME = String(process.env.ALLOW_FROM_ME || "false").toLowerCase() === "true";
const ADMIN_PHONE_NUMBER = (process.env.ADMIN_PHONE_NUMBER || "").replace(/\D/g, "");
const HEALTH_PORT = Number.parseInt(process.env.PORT || "3000", 10);

let client = null;
let reconnectAttempts = 0;
let reconnectInProgress = false;
let cronStarted = false;
let lockHandle = null;
let lockAcquired = false;
let shuttingDown = false;
let loggedMissingAllowedNumber = false;
const loggedIgnoredReasons = new Set();
const outboundQueueInFlight = new Set();
let outboundQueueUnsubscribe = null;
let botConnectionState = "starting";
let healthServer = null;

// Helper functions moved to utils.js

function isDirectChatJid(jid) {
  return (
    jid.endsWith("@s.whatsapp.net") ||
    jid.endsWith("@lid") ||
    jid.endsWith("@c.us")
  );
}

function logIgnoredReasonOnce(reason, details = "") {
  const key = `${reason}|${details}`;
  if (loggedIgnoredReasons.has(key)) {
    return;
  }

  loggedIgnoredReasons.add(key);
  const suffix = details ? ` (${details})` : "";
  console.log(`ℹ️ Ignored incoming message: ${reason}${suffix}`);
}

function extractIncomingText(messageContent) {
  if (!messageContent || typeof messageContent !== "object") {
    return "";
  }

  if (typeof messageContent.conversation === "string" && messageContent.conversation.trim()) {
    return messageContent.conversation;
  }

  if (typeof messageContent.extendedTextMessage?.text === "string" && messageContent.extendedTextMessage.text.trim()) {
    return messageContent.extendedTextMessage.text;
  }

  if (typeof messageContent.imageMessage?.caption === "string" && messageContent.imageMessage.caption.trim()) {
    return messageContent.imageMessage.caption;
  }

  if (typeof messageContent.videoMessage?.caption === "string" && messageContent.videoMessage.caption.trim()) {
    return messageContent.videoMessage.caption;
  }

  if (typeof messageContent.buttonsResponseMessage?.selectedDisplayText === "string" && messageContent.buttonsResponseMessage.selectedDisplayText.trim()) {
    return messageContent.buttonsResponseMessage.selectedDisplayText;
  }

  const listReply = messageContent.listResponseMessage?.singleSelectReply;
  if (typeof listReply?.selectedRowId === "string" && listReply.selectedRowId.trim()) {
    return listReply.selectedRowId;
  }

  const nestedCandidates = [
    messageContent.ephemeralMessage?.message,
    messageContent.viewOnceMessage?.message,
    messageContent.viewOnceMessageV2?.message,
    messageContent.viewOnceMessageV2Extension?.message,
    messageContent.documentWithCaptionMessage?.message,
  ];

  for (const nested of nestedCandidates) {
    const text = extractIncomingText(nested);
    if (text) {
      return text;
    }
  }

  return "";
}

function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function acquireProcessLock() {
  await mkdir(dirname(LOCK_PATH), { recursive: true });

  try {
    lockHandle = await open(LOCK_PATH, "wx");
    await lockHandle.writeFile(String(process.pid));
    lockAcquired = true;
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }

    let existingPid = null;
    try {
      const raw = (await readFile(LOCK_PATH, "utf8")).trim();
      existingPid = Number.parseInt(raw, 10);
    } catch {
      // Ignore malformed lock files and let stale lock cleanup logic handle it.
    }

    if (!isPidRunning(existingPid)) {
      await unlink(LOCK_PATH).catch(() => {});
      lockHandle = await open(LOCK_PATH, "wx");
      await lockHandle.writeFile(String(process.pid));
      lockAcquired = true;
      console.warn("⚠️ Recovered stale process lock file.");
      return true;
    }

    console.error("🚫 Another bot instance is already running.");
    console.error(`   Lock file: ${LOCK_PATH}`);
    console.error(`   Existing PID: ${existingPid}`);
    console.error("   Stop the other process before starting this one.");
    return false;
  }
}

async function releaseProcessLock() {
  if (!lockAcquired) {
    return;
  }

  try {
    await lockHandle?.close();
  } catch {
    // Ignore close errors during shutdown.
  }

  await unlink(LOCK_PATH).catch(() => {});
  lockHandle = null;
  lockAcquired = false;
}

async function shutdownAndExit(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  try {
    outboundQueueUnsubscribe?.();
    outboundQueueUnsubscribe = null;
  } catch {
    // Ignore unsubscribe errors during shutdown.
  }

  try {
    if (client) {
      client.end();
      client = null;
    }
  } catch {
    // Ignore close errors during shutdown.
  }

  try {
    await new Promise((resolve, reject) => {
      if (!healthServer) {
        resolve();
        return;
      }

      healthServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  } catch {
    // Ignore HTTP server close errors during shutdown.
  }

  await releaseProcessLock();
  process.exit(code);
}

function startHealthServer() {
  if (healthServer) {
    return;
  }

  healthServer = createServer((req, res) => {
    if (req.url !== "/" && req.url !== "/health" && req.url !== "/healthz") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }

    const isOnline = botConnectionState === "open";
    const statusCode = botConnectionState === "closed" ? 503 : 200;

    res.writeHead(statusCode, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: isOnline,
        connection: botConnectionState,
        dataDir: DATA_DIR,
        authPath: AUTH_PATH,
        botJid: client?.user?.id || null,
      }),
    );
  });

  healthServer.listen(HEALTH_PORT, "0.0.0.0", () => {
    console.log(`🌐 Health server listening on port ${HEALTH_PORT}`);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDisconnectCode(lastDisconnect) {
  return (
    lastDisconnect?.error?.output?.statusCode ??
    lastDisconnect?.error?.statusCode ??
    lastDisconnect?.error?.data?.statusCode ??
    null
  );
}

function getDisconnectReason(statusCode) {
  if (!statusCode) return "unknown";

  const match = Object.entries(DisconnectReason).find(([, code]) => code === statusCode);
  return match ? match[0] : "unknown";
}

function shouldResetSession(statusCode) {
  return [
    405,
    DisconnectReason.loggedOut,
    DisconnectReason.badSession,
    DisconnectReason.multideviceMismatch,
  ].includes(statusCode);
}

function isNonRecoverableDisconnect(statusCode) {
  return [
    405,
    DisconnectReason.loggedOut,
    DisconnectReason.badSession,
    DisconnectReason.connectionReplaced,
  ].includes(statusCode);
}

async function resetAuthSessionIfNeeded(statusCode) {
  if (!shouldResetSession(statusCode)) {
    return;
  }

  try {
    await rm(AUTH_PATH, { recursive: true, force: true });
    console.log("🧹 Session tokens reset. Please scan a fresh QR code.");
  } catch (error) {
    console.error("⚠️ Failed to reset session tokens:", error.message || error);
  }
}

async function scheduleReconnect() {
  if (reconnectInProgress) {
    return;
  }

  reconnectInProgress = true;
  reconnectAttempts += 1;

  const delayMs = Math.min(30000, 5000 * reconnectAttempts);
  console.log(`\n❌ Connection closed. Reconnecting in ${Math.round(delayMs / 1000)} seconds...\n`);

  await wait(delayMs);
  console.log("🔄 Attempting to reconnect...\n");

  try {
    if (client) {
      client.end();
      client = null;
    }
    await start();
  } finally {
    reconnectInProgress = false;
  }
}

function formatOutboundWhatsAppJid(rawPhone) {
  const digits = normalizePhoneNumber(rawPhone);
  if (!digits) {
    return null;
  }

  // Default 10-digit local numbers to India country code for this deployment.
  const normalized = digits.length === 10 ? `91${digits}` : digits;
  return `${normalized}@s.whatsapp.net`;
}

async function setupOutboundWhatsAppQueueListener() {
  if (outboundQueueUnsubscribe) {
    return;
  }

  const userId = await resolveStoreUserId();
  if (!userId) {
    console.warn("No store userId found for outbound WhatsApp queue.");
    return;
  }

  const queueRef = collection(db, `users/${userId}/whatsapp_messages`);
  const pendingQueue = query(queueRef, where('status', '==', 'pending'));

  outboundQueueUnsubscribe = onSnapshot(pendingQueue, async (snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type !== 'added' && change.type !== 'modified') {
        continue;
      }

      const messageId = change.doc.id;
      if (outboundQueueInFlight.has(messageId)) {
        continue;
      }

      const payload = change.doc.data() || {};
      const targetJid = formatOutboundWhatsAppJid(payload.to);
      const text = String(payload.message || '').trim();

      if (!targetJid) {
        outboundQueueInFlight.add(messageId);
        try {
          await updateDoc(change.doc.ref, {
            status: 'failed',
            error: 'Missing or invalid phone number',
            failedAt: new Date().toISOString(),
          });
        } finally {
          outboundQueueInFlight.delete(messageId);
        }
        continue;
      }

      if (!text) {
        outboundQueueInFlight.add(messageId);
        try {
          await updateDoc(change.doc.ref, {
            status: 'failed',
            error: 'Message body is empty',
            failedAt: new Date().toISOString(),
          });
        } finally {
          outboundQueueInFlight.delete(messageId);
        }
        continue;
      }

      if (!client) {
        continue;
      }

      outboundQueueInFlight.add(messageId);

      try {
        console.log(`📤 Sending queued WhatsApp message ${messageId} to ${targetJid}`);
        await client.sendMessage(targetJid, { text });
        await updateDoc(change.doc.ref, {
          status: 'sent',
          sentAt: new Date().toISOString(),
          sentVia: client.user?.id || null,
          error: null,
        });
      } catch (error) {
        console.error(`❌ Failed to send queued WhatsApp message ${messageId}:`, error);
        await updateDoc(change.doc.ref, {
          status: 'failed',
          failedAt: new Date().toISOString(),
          error: error?.message || String(error),
        });
      } finally {
        outboundQueueInFlight.delete(messageId);
      }
    }
  }, (error) => {
    console.error("Error listening to outbound WhatsApp queue:", error);
  });

  console.log(`📬 Outbound WhatsApp queue listener ready for users/${userId}/whatsapp_messages`);
}

async function start() {
  botConnectionState = "connecting";
  const { state, saveCreds } = await useMultiFileAuthState(
    AUTH_PATH
  );

  let version;
  try {
    const latest = await fetchLatestBaileysVersion();
    version = latest.version;
    console.log(`📦 Using Baileys WA version ${version.join(".")} (isLatest=${latest.isLatest})`);
  } catch (error) {
    console.warn("⚠️ Could not fetch latest Baileys WA version, using default.");
  }

  client = makeWASocket({
    auth: state,
    logger: Pino({ level: "silent" }),
    browser: Browsers.ubuntu("Chrome"),
    ...(version ? { version } : {}),
    syncFullHistory: false,
    defaultQueryTimeoutMs: 60000,
    generateHighQualityLinkPreview: true,
    markOnlineOnConnect: true,
    printQRInTerminal: false,
  });

  client.ev.on("creds.update", saveCreds);

  // 📡 Listen for remote commands (like logout/unlink)
  setTimeout(async () => {
    try {
      const userId = await resolveStoreUserId();
      if (userId) {
        const botStatusRef = doc(db, `users/${userId}/bot/status`);
        
        onSnapshot(botStatusRef, async (snapshot) => {
          const data = snapshot.data();
          if (data?.requestedAction === 'logout') {
            console.log("🛑 Remote logout requested via Firestore.");
            // Clear the action first to avoid loop
            await updateDoc(botStatusRef, { requestedAction: null });
            
            if (client) {
              await client.logout();
              // Baileys documentation says logout() will cause connection.open to close and clear creds
              // but we'll also clean tokens folder just in case
              await rm(AUTH_PATH, { recursive: true, force: true }).catch(() => {});
              console.log("✅ Bot logged out and sessions cleared.");
              // The process will naturally restart via nodemon or we can just exit
              await shutdownAndExit(0);
            }
          }
        });
      }
    } catch (error) {
       console.error("Error setting up remote command listener:", error);
    }
  }, 5000); // Wait for bot to stabilize

  client.ev.on("connection.update", async (update) => {
    const { qr, connection, lastDisconnect, isOnline } = update;

      if (qr) {
        botConnectionState = "waiting-for-scan";
        console.log("\n\n████████████████████████████████████████");
        console.log("👇👇👇 SCAN THIS QR CODE 👇👇👇");
        console.log("████████████████████████████████████████\n");
        qrcode.generate(qr, { small: true });
        console.log("\n████████████████████████████████████████");
        console.log("👆👆👆 USE YOUR PHONE TO SCAN 👆👆👆");
        console.log("████████████████████████████████████████\n\n");
        updateBotStatusInFirebase({ qr, connection: "waiting-for-scan", isOnline: false });
      }

      if (connection === "open") {
        botConnectionState = "open";
        reconnectAttempts = 0;
        console.log("\n✅✅✅ WhatsApp connection is OPEN! ✅✅✅\n");
        updateBotStatusInFirebase({ qr: null, connection: "open", isOnline: true });
        await setupOutboundWhatsAppQueueListener();
        
        if (ALLOWED_PHONE_NUMBER) {
          console.log(`🔒 Customer whitelist active for: ${ALLOWED_PHONE_NUMBER}`);
        }
        if (ADMIN_PHONE_NUMBER) {
          console.log(`� Admin whitelist active for: ${ADMIN_PHONE_NUMBER}`);
        }
        if (ALLOWED_CHAT_JID) {
          console.log(`🔒 Chat whitelist active for: ${ALLOWED_CHAT_JID}`);
        }
        if (!ALLOWED_PHONE_NUMBER && !ADMIN_PHONE_NUMBER && !ALLOWED_CHAT_JID) {
          console.warn("⚠️ No whitelist configured. Incoming messages will be ignored.");
        }
        if (ALLOW_FROM_ME) {
          console.warn("⚠️ ALLOW_FROM_ME is enabled. Use only for testing to avoid accidental loops.");
        }

        if (!cronStarted) {
          startCronJobs(client);
          cronStarted = true;
        }
      }

      if (connection === "close") {
        botConnectionState = "closed";
        const statusCode = getDisconnectCode(lastDisconnect);
        const reason = getDisconnectReason(statusCode);

        console.log(
          `⚠️ WhatsApp disconnected (reason=${reason}, code=${statusCode ?? "unknown"}).`
        );
        updateBotStatusInFirebase({ qr: null, connection: "closed", isOnline: false, reason });

        await resetAuthSessionIfNeeded(statusCode);

        if (isNonRecoverableDisconnect(statusCode)) {
          console.error("🚫 Non-recoverable disconnect detected.");
          if (statusCode === 405) {
            console.error("   WhatsApp rejected the session handshake (code 405).");
            console.error("   1) Delete tokens and re-run the bot.");
            console.error("   2) Scan a fresh QR on your primary WhatsApp device.");
            console.error("   3) If it persists, try a different network/VPN or newer Baileys version.");
          } else if (statusCode === DisconnectReason.connectionReplaced) {
            console.error("   Another WhatsApp/Baileys session replaced this one (code 440).");
            console.error("   1) Ensure only one bot process is running.");
            console.error("   2) Do not run npm start and npm run dev at the same time.");
            console.error("   3) Restart a single instance after other sessions are closed.");
          }
          
          // 🔥 PROACTIVE FIX: If we reset the session, immediately try to connect again
          // instead of exiting and waiting for nodemon.
          if (shouldResetSession(statusCode)) {
            console.log("🔄 Attempting proactive reconnection with fresh session...");
            // Small delay to ensure files are cleared
            setTimeout(() => {
              start().catch(err => {
                console.error("❌ Proactive reconnection failed:", err.message);
                shutdownAndExit(1);
              });
            }, 1000);
            return;
          }

          await shutdownAndExit(1);
          return;
        }

      await scheduleReconnect();
    }
  });

  client.ev.on("messages.upsert", async ({ messages }) => {
    for (const message of messages) {
      try {
        const botNumber = client?.user?.id ? extractPhoneFromJid(client.user.id) : null;
        const botJid = client?.user?.id || null;
        const remotePhone = message.key.remoteJid ? extractPhoneFromJid(message.key.remoteJid) : null;
        
        // Is this message sent by the bot (me)?
        const isFromMe = !!message.key.fromMe;
        // Is this a self-chat (typing to myself)?
        const isSelfChat = isFromMe && (remotePhone === botNumber);
        
        // Check if the sender (even in self-chat) is the admin
        const senderIsAdmin = Boolean(ADMIN_PHONE_NUMBER && remotePhone === ADMIN_PHONE_NUMBER);
        
        // IGNORE messages sent by the bot UNLESS it's a self-chat from the admin
        // When admin types to themselves, fromMe=true but we still want to process it
        // However, we need to distinguish between:
        // 1. Admin typing a NEW message (process it)
        // 2. Bot's reply appearing in the chat (ignore it)
        // 
        // The key is: if it's fromMe AND the message.key.participant exists,
        // it means the bot sent it (not the user typing in self-chat)
        const isBotReply = isFromMe && !isSelfChat;
        
        if (isBotReply && !ALLOW_FROM_ME) {
            continue;
        }
        
        // For self-chat admin: only process if it's actually from admin
        if (isSelfChat && !senderIsAdmin) {
            continue;
        }

        if (!message.message) continue;

        const text = extractIncomingText(message.message);
        const from = message.key.remoteJid;

        if (!from) {
          logIgnoredReasonOnce("missing remoteJid");
          continue;
        }

        // 🛡️ CRITICAL: Ignore bot's own responses to prevent loops
        // Bot responses always start with these patterns
        const botResponsePatterns = [
          '🔑 *ADMIN RESPONSE*',
          '🔑 *ADMIN MODE*',
          '🌟 *OUR CATALOG*',
          '📝 *ORDER DRAFT*',
          '✅ *Draft Confirmed*',
          '🗑️ *Draft cleared*',
          '✅ *Order Cancelled*',
          '⚠️ *Item match failed*',
          '⚠️ *Error processing',
        ];
        
        const isBotResponse = botResponsePatterns.some(pattern => text.startsWith(pattern));
        
        if (isBotResponse) {
          console.log(`🛡️ Ignoring bot's own response to prevent loop`);
          continue;
        }

        if (from.endsWith("@g.us")) {
          logIgnoredReasonOnce("group message", from);
          continue;
        }

        if (from === "status@broadcast") {
          logIgnoredReasonOnce("status broadcast");
          continue;
        }

        if (!isDirectChatJid(from)) {
          logIgnoredReasonOnce("unsupported direct jid", from);
          continue;
        }

        if (!ALLOWED_PHONE_NUMBER && !ALLOWED_CHAT_JID && !ADMIN_PHONE_NUMBER) {
          if (!loggedMissingAllowedNumber) {
            loggedMissingAllowedNumber = true;
            console.warn("⚠️ Ignoring all incoming messages until ALLOWED_PHONE_NUMBER, ADMIN_PHONE_NUMBER, or ALLOWED_CHAT_JID is configured.");
          }
          continue;
        }

        const senderPhone = extractPhoneFromJid(from);

        // Check if this message is from the admin
        const isAdmin = Boolean(ADMIN_PHONE_NUMBER && senderPhone === ADMIN_PHONE_NUMBER);

        // Whitelist: ALLOWED_PHONE_NUMBER, ADMIN_PHONE_NUMBER, or ALLOWED_CHAT_JID
        const isWhitelisted = Boolean(
          (ALLOWED_PHONE_NUMBER && senderPhone === ALLOWED_PHONE_NUMBER) ||
          (ADMIN_PHONE_NUMBER && senderPhone === ADMIN_PHONE_NUMBER) ||
          (ALLOWED_CHAT_JID && from === ALLOWED_CHAT_JID)
        );

        if (!isWhitelisted) {
          logIgnoredReasonOnce('unauthorized sender', from);
          continue;
        }

        console.log(`📡 Message from ${from}: ${text.substring(0, 50)}...`);

        if (!text) {
          logIgnoredReasonOnce("empty text payload", from);
          continue;
        }

        const state = getState(from);

        // 📋 PRIORITY: Handle "menu" keyword immediately to bypass AI and stages
        const cleanText = text.toLowerCase().trim();
        if (cleanText === 'menu' || cleanText.includes('show me the menu') || cleanText.includes('show menu') || cleanText.includes('catalog')) {
          console.log(`📋 "menu" keyword detected from ${from}, fetching fresh catalog...`);
          const menu = await getMenu();
          let msg = '🌟 *OUR CATALOG* 🌟\n';
          msg += '━━━━━━━━━━━━━━━━\n\n';
          
          const inStock = [];
          const outOfStock = [];

          Object.keys(menu).forEach((key) => {
            const item = menu[key];
            if (Number(item.stock || 0) > 0) {
              inStock.push(item);
            } else {
              outOfStock.push(item);
            }
          });

          if (inStock.length > 0) {
            msg += '🛒 *IN STOCK*\n';
            inStock.forEach((item) => {
              msg += `📦 *${item.description}*\n`;
              msg += `💰 Price: ₹${item.price}\n`;
              msg += `🔢 Quantity: ${item.stock} left\n\n`;
            });
          }

          if (outOfStock.length > 0) {
            msg += '━━━━━━━━━━━━━━━━\n';
            msg += '🚫 *OUT OF STOCK*\n';
            outOfStock.forEach((item) => {
              msg += `📦 ~${item.description}~\n`;
              msg += `💰 Price: ₹${item.price}\n\n`;
            });
          }
          
          msg += '━━━━━━━━━━━━━━━━\n';
          msg += 'Type the *item name* to start your order! 🚀';
          
          // Clear any pending state if they ask for menu, so they aren't stuck in an order flow
          state.stage = 1;
          state.pendingItem = null;
          state.pendingQuantity = null;
          setState(from, state);

          await client.sendMessage(from, { text: msg });
          continue;
        }

        // 🤖 Try Natural Language processing first (AI-powered ordering or Admin Query)
        const nlResult = await processNaturalLanguage({
          from,
          message: text,
          client,
          state,
          isAdmin: isAdmin,
        });

        if (nlResult?.handled) {
          // NL processor handled the message
          if (typeof nlResult.response === "string" && nlResult.response.trim()) {
            await client.sendMessage(from, { text: nlResult.response });
          }
          continue;
        }

        // Fall back to traditional stage-based routing
        const messageResponse = await (stages[state.stage].stage.exec.constructor.name === 'AsyncFunction' 
          ? stages[state.stage].stage.exec({ from, message: text, client, state })
          : Promise.resolve(stages[state.stage].stage.exec({ from, message: text, client, state })));

        if (typeof messageResponse === "string" && messageResponse.trim()) {
          await client.sendMessage(from, { text: messageResponse });
        }
      } catch (error) {
        console.error("Error processing message:", error);
      }
    }
  });

  process.removeAllListeners("SIGINT");
  process.on("SIGINT", function () {
    console.log("👋 Closing bot gracefully...");
    void shutdownAndExit(0);
  });

  process.removeAllListeners("SIGTERM");
  process.on("SIGTERM", function () {
    console.log("👋 Received SIGTERM. Closing bot gracefully...");
    void shutdownAndExit(0);
  });
}

process.setMaxListeners(15);

async function bootstrap() {
  startHealthServer();
  const lockReady = await acquireProcessLock();
  if (!lockReady) {
    process.exit(1);
    return;
  }

  try {
    await start();
  } catch (err) {
    console.error("❌ Error starting bot:", err);
    await shutdownAndExit(1);
  }
}

void bootstrap();
