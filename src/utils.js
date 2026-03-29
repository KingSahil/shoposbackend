import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_PATH = path.resolve(__dirname, '../tokens/session-name');

/**
 * Normalize phone number by removing non-numeric characters
 */
export function normalizePhoneNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

/**
 * Resolve an LID (Link ID) to a phone number using Baileys mapping files
 * @param {string} lid - The LID (e.g. 272542099107876)
 * @returns {string|null} The resolved phone number, or null if not found
 */
export function resolveLid(lid) {
  if (!lid) return null;
  
  const mappingFile = path.join(AUTH_PATH, `lid-mapping-${lid}_reverse.json`);
  
  try {
    if (fs.existsSync(mappingFile)) {
      const content = fs.readFileSync(mappingFile, 'utf8').trim();
      // Content is usually "phone_number" (with quotes)
      const phone = content.replace(/"/g, '');
      return normalizePhoneNumber(phone);
    }
  } catch (error) {
    console.error(`Error resolving LID ${lid}:`, error);
  }
  
  return null;
}

/**
 * Extract actual phone number from a JID
 * Handles @s.whatsapp.net and @lid
 * @param {string} jid - The WhatsApp JID
 * @returns {string} The phone number or the local part of JID
 */
export function extractPhoneFromJid(jid) {
  if (!jid) return "";
  
  const [localPart, domain] = jid.split('@');
  const cleanId = localPart.split(':')[0];
  
  if (domain === 'lid') {
    const resolved = resolveLid(cleanId);
    if (resolved) return resolved;
    // If LID cannot be resolved, return the original LID JID part
    // but don't normalize it as a phone number to avoid accidental matches
    return `lid:${cleanId}`;
  }
  
  return normalizePhoneNumber(cleanId);
}
