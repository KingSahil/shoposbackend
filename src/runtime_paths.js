import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = resolve(__dirname, "..");

export const DATA_DIR = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : DEFAULT_DATA_DIR;

mkdirSync(DATA_DIR, { recursive: true });

export const AUTH_PATH = resolve(DATA_DIR, "tokens", "session-name");
export const DB_PATH = resolve(DATA_DIR, "botwhatsapp.db");
