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
 */
import { bodyHash, canonicalJson } from './approvalValidator.js';

export const LEDGER_TABLE = 'correction_ledger';
export const LEDGER_KINDS = Object.freeze({ CORRECTION: 'COMPOSITE_CORRECTION', REVERT: 'COMPOSITE_REVERT' });
const DDL = `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
  ledger_id TEXT PRIMARY KEY,
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

export const hasLedger = (db) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='${LEDGER_TABLE}'`).get();
export function ledgerEntry(db, id) {
  if (!hasLedger(db)) return null;
  return db.prepare(`SELECT * FROM ${LEDGER_TABLE} WHERE ledger_id = ?`).get(id) ?? null;
}

/** Record a committed correction / revert. Must run inside the caller's write transaction. */
export function recordLedger(db, { ledger_id, kind, envelope, grant, target, manifest, committed_at, reverts = null }) {
  if (!db.inTransaction) throw new Error('the ledger is written only inside the correction transaction');
  db.exec(DDL);
  db.prepare(`INSERT INTO ${LEDGER_TABLE} (ledger_id, kind, approval_id, approval_body_hash, approval_json, target_class, target_identity, manifest_sha256, manifest_json, committed_at, status, reverts, reverted_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,'COMMITTED',?,NULL)`)
    .run(ledger_id, kind, grant.approval_id, grant.body_hash, canonicalJson(envelope), target.class, target.identity, manifestSha(manifest), canonicalJson(manifest), committed_at, reverts);
}

export function markReverted(db, id, by) {
  const r = db.prepare(`UPDATE ${LEDGER_TABLE} SET status = 'REVERTED', reverted_by = ? WHERE ledger_id = ? AND status = 'COMMITTED'`).run(by, id);
  if (r.changes !== 1) throw new Error(`ledger ${id} is not a committed correction`);
}
