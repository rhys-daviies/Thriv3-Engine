/**
 * CORRECTION LEDGER — Phase DI-03F. The database's own record of every composite correction and revert
 * that COMMITTED to it, written by the engine inside the same transaction as the rows it changed. Only
 * a committed transaction leaves a row, so a ledger row is the proof DI-03E found missing:
 *   - a revert may only revert a manifest this database's ledger recorded as COMMITTED (and not
 *     already reverted) — a fabricated, stale or foreign manifest has no ledger row (MAJOR-5);
 *   - a code-level hold release takes effect in a database only when that database's ledger holds the
 *     authenticated correction that moved the domain (holdRelease.js, MAJOR-3).
 * Each row keeps the verified signed approval envelope, the target environment and the canonical
 * manifest, so the proof can be re-verified later against the reviewer registry.
 *
 * The table is created by the engine on its first committed correction (inside that transaction); the
 * application's schema does not need it to run.
 *
 * DATABASE IDENTITY (DI-03H, DI-03G MAJOR-D). A ledger row says WHICH database it was committed to, twice over:
 *   - target_identity: the engine's classification of the database at commit (correctionTarget: class +
 *     real path / production identity / disposable marker), which a reader re-derives from its own handle;
 *   - database_id: a random id minted into this database (table correction_database_identity, one row) the
 *     first time a correction commits to it, together with the classification it was minted under.
 * A release proof (holdRelease.js) requires the reading database to classify to the row's target_identity
 * AND to carry the row's database_id minted under that same identity. A row copied into another database,
 * a pre-commit or rehearsal copy, or a database that never minted an id cannot satisfy both.
 */
import crypto from 'node:crypto';
import { bodyHash, canonicalJson, grantProblems } from './approvalValidator.js';

export const LEDGER_TABLE = 'correction_ledger';
export const LEDGER_KINDS = Object.freeze({ CORRECTION: 'COMPOSITE_CORRECTION', REVERT: 'COMPOSITE_REVERT' });
export const IDENTITY_TABLE = 'correction_database_identity';
const IDENTITY_DDL = `CREATE TABLE IF NOT EXISTS ${IDENTITY_TABLE} (
  database_id TEXT PRIMARY KEY,
  minted_at TEXT NOT NULL,
  minted_class TEXT NOT NULL,
  minted_identity TEXT NOT NULL
)`;
const DDL = `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
  ledger_id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('COMPOSITE_CORRECTION', 'COMPOSITE_REVERT')),
  approval_id TEXT NOT NULL,
  approval_body_hash TEXT NOT NULL,
  approval_json TEXT NOT NULL,
  target_class TEXT NOT NULL,
  target_identity TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('COMMITTED', 'REVERTED')),
  reverts TEXT,
  reverted_by TEXT
)`;

export const ledgerId = (prefix, approvalBodyHash) => `${prefix}-${approvalBodyHash.slice(0, 16)}`;
/** sha256 of a manifest's canonical JSON — the same object written to a file or parsed back from one. */
export const manifestSha = (manifest) => bodyHash(manifest);

const hasTable = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

/** This database's minted identity row, or null (none / more than one row = no identity). */
export function databaseIdentity(db) {
  if (!hasTable(db, IDENTITY_TABLE)) return null;
  const rows = db.prepare(`SELECT * FROM ${IDENTITY_TABLE}`).all();
  return rows.length === 1 ? rows[0] : null;
}

/**
 * The database id for a commit to `target`, minting it (inside the caller's transaction) on first use.
 * A database whose existing identity was minted under a different classification (a copy of another
 * database, moved or restored elsewhere) is refused: its ledger history belongs to that other database.
 */
export function ensureDatabaseIdentity(db, target, now) {
  if (!db.inTransaction) throw new Error('the database identity is minted only inside the correction transaction');
  const cur = databaseIdentity(db);
  if (cur) {
    if (cur.minted_identity !== target.identity) throw new Error(`this database carries correction identity ${cur.database_id} minted for ${cur.minted_identity}, not ${target.identity} — it is a copy of another database; refusing to mix their ledgers`);
    return cur.database_id;
  }
  if (hasTable(db, IDENTITY_TABLE)) throw new Error(`${IDENTITY_TABLE} is present but does not hold exactly one row — refusing`);
  db.exec(IDENTITY_DDL);
  const id = `DB-${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO ${IDENTITY_TABLE} (database_id, minted_at, minted_class, minted_identity) VALUES (?,?,?,?)`).run(id, now, target.class, target.identity);
  return id;
}

export const hasLedger = (db) => hasTable(db, LEDGER_TABLE);
export function ledgerEntry(db, id) {
  if (!hasLedger(db)) return null;
  return db.prepare(`SELECT * FROM ${LEDGER_TABLE} WHERE ledger_id = ?`).get(id) ?? null;
}

/** Record a committed correction / revert. Must run inside the caller's write transaction. */
export function recordLedger(db, { ledger_id, database_id, kind, envelope, grant, target, manifest, committed_at, reverts = null }) {
  if (!db.inTransaction) throw new Error('the ledger is written only inside the correction transaction');
  const gp = grantProblems(grant, target); // DI-07: a ledger row is written only under a usable grant for this target
  if (gp.length) throw new Error(`ledger write refused: ${gp.join('; ')}`);
  if (!database_id || databaseIdentity(db)?.database_id !== database_id || manifest.database_id !== database_id) throw new Error('ledger row, manifest and this database must carry the same database_id');
  db.exec(DDL);
  db.prepare(`INSERT INTO ${LEDGER_TABLE} (ledger_id, database_id, kind, approval_id, approval_body_hash, approval_json, target_class, target_identity, manifest_sha256, manifest_json, committed_at, status, reverts, reverted_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'COMMITTED',?,NULL)`)
    .run(ledger_id, database_id, kind, grant.approval_id, grant.body_hash, canonicalJson(envelope), target.class, target.identity, manifestSha(manifest), canonicalJson(manifest), committed_at, reverts);
}

/** Ledger rows that revert `id` (COMPOSITE_REVERT rows naming it). */
export function revertsOf(db, id) {
  if (!hasLedger(db)) return [];
  return db.prepare(`SELECT ledger_id, status FROM ${LEDGER_TABLE} WHERE kind = 'COMPOSITE_REVERT' AND reverts = ?`).all(id);
}

export function markReverted(db, id, by) {
  const r = db.prepare(`UPDATE ${LEDGER_TABLE} SET status = 'REVERTED', reverted_by = ? WHERE ledger_id = ? AND status = 'COMMITTED'`).run(by, id);
  if (r.changes !== 1) throw new Error(`ledger ${id} is not a committed correction`);
}
