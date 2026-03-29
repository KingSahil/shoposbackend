import Database from "better-sqlite3";
import { DB_PATH } from "./runtime_paths.js";

const db = new Database(DB_PATH, { verbose: console.log });
db.pragma("journal_mode = WAL");

const createTable = `
CREATE TABLE IF NOT EXISTS user_state (
    phone_number TEXT PRIMARY KEY,
    stage INTEGER NOT NULL DEFAULT 0,
    state_data TEXT,
    last_updated_at INTEGER
);
`;

db.exec(createTable);
console.log(`Database initialized at ${DB_PATH}.`);

export { db };
