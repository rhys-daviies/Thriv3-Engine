/**
 * DATABASE CONTENT FINGERPRINTS — deployment readiness §2d and §3d.
 *
 * Read-only. Opens a COPY of a database (never the working or production file,
 * see `assertNotLiveDatabase`) with `readonly` and `query_only`, and reduces
 * every table to a row count and a SHA-256 of its CONTENT.
 *
 * CONTENT, NOT PAGES. Two backups of an unchanged database can differ byte for
 * byte (page layout, free lists, a VACUUM) and still hold the same rows. The
 * digest is over the rows themselves:
 *   - every column value, type-tagged, so 1, 1.0, '1' and NULL all differ;
 *   - integers read as BigInt, so large values are exact;
 *   - each row hashed on its own, the row hashes sorted, then hashed together.
 *     Row order and rowids do not move it, and duplicate rows still count.
 * The column names are part of a table's digest, so a schema change shows.
 *
 * EXCLUDING SYNTHETIC RECORDS (§3d). With `exclude`, rows marked as synthetic
 * are left out of the digest, and so is everything that hangs off them:
 *   1. a row is MARKED if any of its text values matches the marker;
 *   2. a row is a DEPENDANT if it references an excluded row, through a
 *      declared foreign key or one of the known undeclared references
 *      (`UNDECLARED_REFERENCES`). This is followed transitively, so a child
 *      with no marker field of its own (an `outreach_send_event` of a
 *      synthetic athlete's send) is excluded with its parent.
 * Every excluded row is counted per table, so an exclusion is visible rather
 * than silent.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

export const FINGERPRINT_VERSION = 1;

/**
 * The §3d marker: synthetic ids (`RB-SYN-…`), names (`Rehearsal Synthetic …`),
 * the reserved address domain, and profile slugs (`rbsyn…`). Slugs are letters
 * and digits only (`/p/:slug`), so a synthetic slug cannot carry the hyphenated id prefix.
 */
export const DEFAULT_MARKER = /^RB-SYN-|^rbsyn[A-Za-z0-9]*$|rehearsal\.example\.test|Rehearsal Synthetic/i;

/**
 * References the schema does not declare as foreign keys, measured on main's
 * schema. Followed exactly like declared ones.
 */
export const UNDECLARED_REFERENCES = Object.freeze([
  ['athlete_programmes', ['college_id'], 'colleges', ['id']],
  ['generated_reports', ['athlete_id'], 'players', ['id']],
  ['generated_reports', ['college_id'], 'colleges', ['id']],
  ['legacy_contact_reconciliation', ['coach_id'], 'coaches', ['id']],
  ['matchmaking_programme_results', ['college_id'], 'colleges', ['id']],
  ['matchmaking_selections', ['college_id'], 'colleges', ['id']],
  ['players', ['representative_id'], 'representatives', ['id']],
  ['programme_campaigns', ['college_id'], 'colleges', ['id']],
  ['programme_conference_seasons', ['college_id'], 'colleges', ['id']],
  ['programme_membership_periods', ['college_id'], 'colleges', ['id']],
  ['programme_row_links', ['college_id'], 'colleges', ['id']],
  ['programme_seasons', ['college_id'], 'colleges', ['id']],
  ['recruiting_observations', ['college_id'], 'colleges', ['id']],
].map(([table, columns, parent, parentColumns]) => Object.freeze({ table, columns, parent, parentColumns })));

const realpathOrSelf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const sameFile = (a, b) => {
  if (realpathOrSelf(a) === realpathOrSelf(b)) return true;
  try { const x = fs.statSync(a); const y = fs.statSync(b); return x.dev === y.dev && x.ino === y.ino; } catch { return false; }
};

/**
 * Refuses a live database: production's (`/data/recruitmatch.sqlite`), whatever
 * the running app is configured to use (`RECRUITMATCH_DB`), and the local
 * working database. These tools read copies only.
 */
export function assertNotLiveDatabase(file, { env = process.env, working = null } = {}) {
  if (!file || typeof file !== 'string') throw new Error('A database copy path is required.');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${file} is not a file.`);
  const live = ['/data/recruitmatch.sqlite', env.RECRUITMATCH_DB, working].filter((p) => p && p !== ':memory:');
  for (const p of live) {
    if (sameFile(file, p)) throw new Error(`Refusing ${file}: it is a live database (${p}). Run this on a copy.`);
  }
  return file;
}

export function openCopyReadOnly(file, opts) {
  assertNotLiveDatabase(file, opts);
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  db.defaultSafeIntegers(true);
  return db;
}

const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

function tableInfo(db) {
  const rows = db.prepare(`SELECT name, sql FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
  return rows
    .filter((t) => !/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(t.sql || ''))
    .map((t) => {
      const cols = db.prepare(`PRAGMA table_info(${q(t.name)})`).all();
      const withoutRowid = /\)\s*WITHOUT\s+ROWID\s*;?\s*$/i.test(t.sql || '');
      const pk = cols.filter((c) => Number(c.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map((c) => c.name);
      return { name: t.name, columns: cols.map((c) => c.name), withoutRowid, pk };
    });
}

/** The key a row is identified by while excluding: rowid, or the primary key of a WITHOUT ROWID table. */
const keyExpr = (t) => (t.withoutRowid ? t.pk.map(q).join(', ') : 'rowid');
const keyOf = (t, row) => (t.withoutRowid ? JSON.stringify(t.pk.map((c) => encode(row[c]))) : String(row.__k));

function encode(v) {
  if (v === null || v === undefined) return 'n';
  if (typeof v === 'bigint') return `i${v.toString()}`;
  if (typeof v === 'number') return `r${Object.is(v, -0) ? '-0' : v.toString()}`;
  if (typeof v === 'string') return `t${v}`;
  if (Buffer.isBuffer(v)) return `b${v.toString('hex')}`;
  return `?${String(v)}`;
}

function* rowsOf(db, t) {
  const sel = t.withoutRowid
    ? `SELECT * FROM ${q(t.name)}`
    : `SELECT rowid AS __k, * FROM ${q(t.name)}`;
  yield* db.prepare(sel).iterate();
}

/** Every reference to follow: declared foreign keys plus the undeclared ones that apply to this database. */
function referencesOf(db, tables, extra) {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const refs = [];
  for (const t of tables) {
    const groups = new Map();
    for (const f of db.prepare(`PRAGMA foreign_key_list(${q(t.name)})`).all()) {
      if (!groups.has(f.id)) groups.set(f.id, { table: t.name, parent: f.table, columns: [], parentColumns: [] });
      const g = groups.get(f.id);
      g.columns.push(f.from);
      g.parentColumns.push(f.to);
    }
    for (const g of groups.values()) {
      const parent = byName.get(g.parent);
      if (!parent) continue;
      if (g.parentColumns.some((c) => c == null)) g.parentColumns = parent.pk.length ? parent.pk : ['rowid'];
      refs.push(g);
    }
  }
  for (const r of extra) {
    const child = byName.get(r.table); const parent = byName.get(r.parent);
    if (!child || !parent) continue;
    if (!r.columns.every((c) => child.columns.includes(c))) continue;
    if (!r.parentColumns.every((c) => parent.columns.includes(c))) continue;
    refs.push({ ...r });
  }
  return refs;
}

/** Marked rows, then everything that references them, to a fixed point. */
function excludedRows(db, tables, marker, extra) {
  const excluded = new Map(tables.map((t) => [t.name, new Set()]));
  const byName = new Map(tables.map((t) => [t.name, t]));
  for (const t of tables) {
    const set = excluded.get(t.name);
    for (const row of rowsOf(db, t)) {
      for (const c of t.columns) {
        const v = row[c];
        if (typeof v === 'string' && marker.test(v)) { set.add(keyOf(t, row)); break; }
      }
    }
  }
  const refs = referencesOf(db, tables, extra);
  let changed = true;
  while (changed) {
    changed = false;
    for (const ref of refs) {
      const parent = byName.get(ref.parent); const child = byName.get(ref.table);
      const parentKeys = excluded.get(parent.name);
      if (!parentKeys.size) continue;
      // The referenced values of the excluded parent rows.
      const wanted = new Set();
      for (const row of rowsOf(db, parent)) {
        if (!parentKeys.has(keyOf(parent, row))) continue;
        const vals = ref.parentColumns.map((c) => (c === 'rowid' ? row.__k : row[c]));
        if (vals.some((v) => v === null || v === undefined)) continue;
        wanted.add(JSON.stringify(vals.map(encode)));
      }
      if (!wanted.size) continue;
      const childKeys = excluded.get(child.name);
      for (const row of rowsOf(db, child)) {
        const k = keyOf(child, row);
        if (childKeys.has(k)) continue;
        const vals = ref.columns.map((c) => row[c]);
        if (vals.some((v) => v === null || v === undefined)) continue;
        if (wanted.has(JSON.stringify(vals.map(encode)))) { childKeys.add(k); changed = true; }
      }
    }
  }
  return excluded;
}

/**
 * The fingerprint of a database copy.
 *
 * @param {string} file           a COPY of a database
 * @param {object} [opts]
 * @param {RegExp|null} [opts.exclude]  marker for synthetic rows (§3d); null includes everything
 * @param {Array} [opts.extraReferences] references followed in addition to declared foreign keys
 * @param {string[]} [opts.ignoreTables] tables left out entirely (e.g. a documented artefact)
 */
export function fingerprint(file, {
  exclude = null, extraReferences = UNDECLARED_REFERENCES, ignoreTables = [], env, working,
} = {}) {
  const db = openCopyReadOnly(file, { env, working });
  try {
    const tables = tableInfo(db).filter((t) => !ignoreTables.includes(t.name));
    const excluded = exclude ? excludedRows(db, tables, exclude, extraReferences) : null;
    const out = {};
    for (const t of tables) {
      const skip = excluded?.get(t.name) ?? new Set();
      const hashes = [];
      for (const row of rowsOf(db, t)) {
        if (skip.size && skip.has(keyOf(t, row))) continue;
        hashes.push(crypto.createHash('sha256').update(JSON.stringify(t.columns.map((c) => encode(row[c])))).digest('hex'));
      }
      hashes.sort();
      const h = crypto.createHash('sha256').update(JSON.stringify(t.columns)).update('\n');
      for (const x of hashes) h.update(x).update('\n');
      out[t.name] = { rows: hashes.length, excluded: skip.size, sha256: h.digest('hex') };
    }
    return {
      version: FINGERPRINT_VERSION,
      exclude: exclude ? String(exclude) : null,
      ignoredTables: [...ignoreTables].sort(),
      tables: out,
    };
  } finally {
    db.close();
  }
}

/**
 * Two fingerprints, table by table. `same` is true only when every table is
 * present in both with equal content. A difference names the table and what
 * moved, never the rows.
 */
export function compareFingerprints(a, b) {
  const diffs = [];
  if (a.version !== b.version) diffs.push({ table: null, kind: 'VERSION', a: a.version, b: b.version });
  if (a.exclude !== b.exclude) diffs.push({ table: null, kind: 'EXCLUSION_DIFFERS', a: a.exclude, b: b.exclude });
  const names = [...new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])].sort();
  for (const n of names) {
    const x = a.tables[n]; const y = b.tables[n];
    if (!x) diffs.push({ table: n, kind: 'ADDED' });
    else if (!y) diffs.push({ table: n, kind: 'REMOVED' });
    else if (x.sha256 !== y.sha256 || x.rows !== y.rows) {
      diffs.push({ table: n, kind: 'CHANGED', rows: { a: x.rows, b: y.rows }, excluded: { a: x.excluded, b: y.excluded } });
    }
  }
  return { same: diffs.length === 0, diffs };
}
