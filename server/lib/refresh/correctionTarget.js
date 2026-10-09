/**
 * CORRECTION TARGET — WHICH DATABASE IS THIS, AND WHICH ACTIVATION HOLDS PROTECT IT? Phase DI-03F.
 *
 * DI-03E MAJOR-1: the DI-03D rule ("a database under <checkout>/server/data is runtime, anything else
 * is a disposable copy") classified Render's production database, /data/recruitmatch.sqlite, as
 * DISPOSABLE — and a disposable target accepts an operator-named holds file, the rehearsal reviewer and
 * test-only evidence. Classification is now POSITIVE: a database is disposable only when it proves it,
 * and anything unidentified is refused.
 *
 *   PRODUCTION  any file database when this process is a production process (NODE_ENV=production or
 *               RENDER set); a real path that is, or lies under, a production path / mount in
 *               shared/databaseEnvironments.json (Render: /data); a file that is the same inode as a
 *               production path. Corrected only from inside the production service itself — the
 *               process whose RECRUITMATCH_DB is this database — because only that process's code is
 *               the code that sends; its holds are that code's HOLDS_PATH. Anything else refuses.
 *   SHARED_DEV  a real path directly inside a checkout's server/data directory; the database this
 *               process is configured to serve (RECRUITMATCH_DB); a path listed in the registry. Holds:
 *               the file the application serving it enforces — <checkout>/server/data/seeds/... for a
 *               checkout database, the registry's holds file for a listed one, this code's HOLDS_PATH for
 *               RECRUITMATCH_DB. Naming any other holds file refuses.
 *   DISPOSABLE  ':memory:' / anonymous; or a file carrying a disposable marker (table
 *               correction_disposable_marker, one row) that is bound to THIS file's device + inode, with
 *               exactly one hard link, and no runtime signal at all. The marker is written only by
 *               createDisposableCopy (a fresh copy, never in place) or markNewDisposable (a brand-new,
 *               EMPTY database). `cp` of a marked copy changes the inode and is no longer identified.
 *               Holds: an explicitly named file. The application never SERVES a marked database
 *               (db/client.js refuses it before reading or migrating — DI-03H), so a disposable
 *               copy is never a database something is running against.
 *   UNKNOWN     everything else — refused. A runtime signal together with a disposable marker refuses.
 *
 * Every signal is read from the filesystem (real path, native case — symlinks, `..`, `/proc/self/root`
 * and case variants all resolve) and from this process's own environment. No caller-supplied flag
 * participates, and the composite writer, the revert and the domain writer all classify the handle
 * they are given themselves.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { activationHolds, HOLDS_PATH } from '../canonicalCoachEligibility.js';
import { ENV } from './approvalValidator.js';
import { DISPOSABLE_MARKER_TABLE } from '../../db/disposableMarker.js';

export { ENV };
export const UNKNOWN = 'UNKNOWN';
export const MARKER_TABLE = DISPOSABLE_MARKER_TABLE;
export const ENVIRONMENTS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../shared/databaseEnvironments.json');
export const HOLDS_FILE_NAME = path.join('seeds', 'coach_activation_holds.json');

const real = (p) => fs.realpathSync.native(p);
const realOrSelf = (p) => { try { return real(p); } catch { return path.resolve(p); } };
const fail = (m) => Object.assign(new Error(m), { refused: true });

/** The committed environment registry. Unreadable -> the built-in Render production paths only. */
export function loadEnvironments() {
  const base = { production: { paths: ['/data/recruitmatch.sqlite'], roots: ['/data'] }, shared_development: [] };
  try {
    const j = JSON.parse(fs.readFileSync(ENVIRONMENTS_PATH, 'utf8'));
    if (j?.kind !== 'DATABASE_ENVIRONMENTS') return base;
    return {
      production: { paths: [...new Set([...base.production.paths, ...(j.production?.paths || [])])], roots: [...new Set([...base.production.roots, ...(j.production?.roots || [])])] },
      shared_development: (j.shared_development || []).filter((d) => d?.path && d?.activation_holds),
    };
  } catch { return base; }
}

/** Is this process a production process? (Render sets RENDER; the blueprint sets NODE_ENV=production.) */
export const isProductionProcess = (env = process.env) => env.NODE_ENV === 'production' || !!env.RENDER;

const under = (p, root) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
const inCheckoutData = (p) => { const parts = p.split(path.sep); return parts.length >= 3 && parts[parts.length - 3] === 'server' && parts[parts.length - 2] === 'data'; };
const configuredDb = (env = process.env) => { const v = String(env.RECRUITMATCH_DB ?? '').trim(); return v && v !== ':memory:' ? realOrSelf(v) : null; };
const statKey = (p) => { try { const s = fs.statSync(p, { bigint: true }); return `${s.dev}:${s.ino}`; } catch { return null; } };

/**
 * The runtime signals a real path carries, from the path and this process alone.
 * Pure apart from stat/realpath of the registry's own paths. Exported for tests; the engine never
 * accepts a classification from a caller.
 */
export function runtimeSignals(realPath, { env = process.env } = {}) {
  const reg = loadEnvironments(); const s = [];
  if (isProductionProcess(env)) s.push({ class: ENV.PRODUCTION, why: `this process is a production process (NODE_ENV=${env.NODE_ENV ?? ''}${env.RENDER ? ', RENDER' : ''})` });
  for (const p of reg.production.paths) if (realPath === p || realPath === realOrSelf(p)) s.push({ class: ENV.PRODUCTION, why: `${p} is the production database` });
  for (const r of reg.production.roots) if (under(realPath, r) || under(realPath, realOrSelf(r))) s.push({ class: ENV.PRODUCTION, why: `${realPath} is on the production volume ${r}` });
  const k = statKey(realPath);
  if (k) for (const p of reg.production.paths) if (statKey(p) === k) s.push({ class: ENV.PRODUCTION, why: `${realPath} is the same file as ${p}` });
  if (inCheckoutData(realPath)) s.push({ class: ENV.SHARED_DEV, why: `${realPath} is a checkout's server/data database` });
  if (configuredDb(env) && configuredDb(env) === realPath) s.push({ class: ENV.SHARED_DEV, why: `${realPath} is this process's RECRUITMATCH_DB` });
  for (const d of reg.shared_development) if (realOrSelf(d.path) === realPath) s.push({ class: ENV.SHARED_DEV, why: `${realPath} is registered as a shared development database` });
  return s;
}

function readMarker(db) {
  try {
    if (!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='${MARKER_TABLE}'`).get()) return null;
    const rows = db.prepare(`SELECT * FROM ${MARKER_TABLE}`).all();
    return rows.length === 1 ? rows[0] : { invalid: `${rows.length} marker rows` };
  } catch { return { invalid: 'unreadable marker' }; }
}

/**
 * Classify a better-sqlite3 handle. -> { class, identity, dbPath, why[] }. Never throws for UNKNOWN;
 * correctionTarget() turns UNKNOWN into a refusal.
 */
export function classifyDatabase(db) {
  const name = db?.name;
  if (!name || name === ':memory:' || db.memory) return { class: ENV.DISPOSABLE, identity: 'disposable:memory', dbPath: null, why: ['in-memory database'] };
  let dbPath;
  try { dbPath = real(name); } catch { return { class: UNKNOWN, identity: null, dbPath: path.resolve(name), why: [`${name} cannot be resolved`] }; }
  const signals = runtimeSignals(dbPath);
  const marker = readMarker(db);
  const prod = signals.filter((x) => x.class === ENV.PRODUCTION); const dev = signals.filter((x) => x.class === ENV.SHARED_DEV);
  if (signals.length && marker) return { class: UNKNOWN, identity: null, dbPath, why: [...signals.map((x) => x.why), 'it also carries a disposable marker — a runtime database must never be marked disposable; refusing'] };
  if (prod.length) return { class: ENV.PRODUCTION, identity: `production:${loadEnvironments().production.paths[0]}`, dbPath, why: prod.map((x) => x.why) };
  if (dev.length) return { class: ENV.SHARED_DEV, identity: `shared-dev:${dbPath}`, dbPath, why: dev.map((x) => x.why) };
  if (!marker) return { class: UNKNOWN, identity: null, dbPath, why: [`${dbPath} is not an identified database (no runtime registration, no disposable marker) — make a disposable copy with createDisposableCopy`] };
  if (marker.invalid) return { class: UNKNOWN, identity: null, dbPath, why: [`disposable marker: ${marker.invalid}`] };
  const st = fs.statSync(dbPath, { bigint: true });
  if (String(marker.file_dev) !== String(st.dev) || String(marker.file_ino) !== String(st.ino)) return { class: UNKNOWN, identity: null, dbPath, why: ['the disposable marker belongs to another file (copied with cp?) — make copies with createDisposableCopy'] };
  if (st.nlink !== 1n) return { class: UNKNOWN, identity: null, dbPath, why: [`${dbPath} has ${st.nlink} hard links — it cannot be shown to be a disposable copy`] };
  // A disposable copy is created in rollback-journal mode and only ever opened by the correction tools. WAL mode
  // (persistent in the file header) or WAL side files mean an application or another process has served it — it
  // is not a scratch copy any more (DI-03G MAJOR-A). db/client.js additionally refuses to serve a marked file.
  let mode = null; try { mode = String(db.pragma('journal_mode', { simple: true })).toLowerCase(); } catch { mode = 'unknown'; }
  const sidecars = ['-wal', '-shm'].filter((x) => fs.existsSync(`${dbPath}${x}`));
  if (mode === 'wal' || mode === 'unknown' || sidecars.length) return { class: UNKNOWN, identity: null, dbPath, why: [`${dbPath} shows signs of being served by another process (journal_mode ${mode}${sidecars.length ? `, ${sidecars.join(' ')} present` : ''}) — a disposable copy is never served; make a fresh one`] };
  return { class: ENV.DISPOSABLE, identity: `disposable:${marker.marker_id}`, dbPath, why: [`disposable marker ${marker.marker_id} (${marker.source ?? 'new'})`] };
}

/**
 * The correction target: { class, identity, dbPath, holdsFile, holdsSha256, holdsCount, holds, why } or throws.
 * `activationHoldsFile`: required for DISPOSABLE; for a runtime class it may only name the file the
 * application enforces (anything else refuses).
 */
export function correctionTarget(db, { activationHoldsFile = null } = {}) {
  const c = classifyDatabase(db);
  if (c.class === UNKNOWN) throw fail(`database not identified — ${c.why.join('; ')}`);
  let holdsFile;
  if (c.class === ENV.PRODUCTION) {
    if (!isProductionProcess() || configuredDb() !== c.dbPath) throw fail(`${c.dbPath} is PRODUCTION (${c.why.join('; ')}): it may be corrected only from inside the production service, whose RECRUITMATCH_DB it is — this process is not that service`);
    holdsFile = HOLDS_PATH;
  } else if (c.class === ENV.SHARED_DEV) {
    const listed = loadEnvironments().shared_development.find((d) => realOrSelf(d.path) === c.dbPath);
    if (inCheckoutData(c.dbPath)) holdsFile = path.join(path.dirname(c.dbPath), HOLDS_FILE_NAME);
    else if (listed) holdsFile = path.resolve(path.dirname(ENVIRONMENTS_PATH), '..', listed.activation_holds);
    else holdsFile = HOLDS_PATH; // this process's own RECRUITMATCH_DB: its code is the code that serves it
  } else {
    if (!activationHoldsFile) throw fail('a disposable correction must name its activation-holds file explicitly');
    holdsFile = path.resolve(activationHoldsFile);
  }
  if (c.class !== ENV.DISPOSABLE && activationHoldsFile && (!fs.existsSync(activationHoldsFile) || realOrSelf(activationHoldsFile) !== realOrSelf(holdsFile))) {
    throw fail(`${c.dbPath} is ${c.class}: its application enforces ${holdsFile} — no other holds file can stand in for it`);
  }
  if (!fs.existsSync(holdsFile)) throw fail(`activation holds file ${holdsFile} does not exist`);
  const index = activationHolds(holdsFile);
  if (index === null) throw fail(`activation holds file ${holdsFile} is unreadable or inconsistent (fail closed)`);
  const bytes = fs.readFileSync(holdsFile);
  return { ...c, target: c.class, holdsFile, holdsSha256: crypto.createHash('sha256').update(bytes).digest('hex'), holdsCount: index.size, holds: index };
}

/** Refuse a destination that is, or would be read as, a runtime database. */
function assertDisposableDestination(dest) {
  if (isProductionProcess()) throw fail('disposable copies are never made inside a production process');
  const parent = realOrSelf(path.dirname(path.resolve(dest)));
  const would = path.join(parent, path.basename(dest));
  const sig = runtimeSignals(would);
  if (sig.length) throw fail(`${would} would be a runtime location (${sig.map((x) => x.why).join('; ')}) — choose a scratch directory`);
  if (fs.existsSync(would)) throw fail(`${would} already exists`);
  return would;
}

function writeMarker(db, file, source) {
  const st = fs.statSync(file, { bigint: true });
  const marker_id = crypto.randomUUID();
  db.exec(`CREATE TABLE ${MARKER_TABLE} (marker_id TEXT PRIMARY KEY, file_dev TEXT NOT NULL, file_ino TEXT NOT NULL, source TEXT, created_at TEXT NOT NULL)`);
  db.prepare(`INSERT INTO ${MARKER_TABLE} VALUES (?,?,?,?,?)`).run(marker_id, String(st.dev), String(st.ino), source, new Date().toISOString());
  return marker_id;
}

/**
 * Make a disposable copy of `src` at `dest` (a new file in a scratch location) and mark it. The source
 * is opened read-only and never written. `Database` is the better-sqlite3 constructor.
 * -> { dest, marker_id }
 */
export function createDisposableCopy(Database, src, dest) {
  const out = assertDisposableDestination(dest);
  const s = new Database(src, { readonly: true, fileMustExist: true });
  try { s.prepare('VACUUM INTO ?').run(out); } finally { s.close(); }
  const d = new Database(out);
  try {
    d.pragma('journal_mode = DELETE'); // VACUUM INTO keeps the source's WAL flag; a disposable copy is never in WAL mode
    if (readMarker(d)) d.exec(`DROP TABLE ${MARKER_TABLE}`); // a copy of a copy gets its own marker
    // the copy is a different database: it never inherits the source's correction identity (DI-03H), so its copied
    // ledger rows can never prove anything here, and a correction on the copy mints its own identity
    d.exec('DROP TABLE IF EXISTS correction_database_identity');
    return { dest: out, marker_id: writeMarker(d, out, `copy of ${realOrSelf(src)}`) };
  } finally { d.close(); }
}

/** Mark a brand-new, EMPTY file database disposable (tests and rehearsal worlds). Anything else refuses. */
export function markNewDisposable(db) {
  if (!db?.name || db.memory || db.name === ':memory:') return null;
  const file = real(db.name);
  if (runtimeSignals(file).length) throw fail(`${file} is a runtime location — never marked disposable`);
  const n = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'").get().n;
  if (n) throw fail(`${file} already holds ${n} table(s) — only a brand-new empty database may be marked in place; copy anything else with createDisposableCopy`);
  return writeMarker(db, file, 'new');
}
