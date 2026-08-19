import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

// RECRUITMATCH_DB lets tests point at ':memory:' or a throwaway file rather
// than the working database.
const dbPath = process.env.RECRUITMATCH_DB || path.join(dataDir, 'recruitmatch.sqlite');
const db = new Database(dbPath);
if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);
migrate(db);

export default db;
