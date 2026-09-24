/**
 * Canonical product reconciliation — the artefact, and what may be done with it.
 *
 * ===========================================================================
 * WHY THIS EXISTS.
 *
 * Production's database was populated once, by hand, before most of these
 * tables existed. `schema.sql` then created them empty on the next boot, so
 * the deployed application has been reading a `programme_status` with no rows
 * and treating six deliberately-excluded programmes as eligible destinations.
 *
 * Copying the whole database up would fix that and destroy the operator
 * account, every player created through the UI, every report, campaign,
 * message, mailbox connection and send record — none of which exist locally.
 * The local corpus has ZERO `operator_users`. Replacing the file logs the
 * operator out of their own application permanently.
 *
 * So this moves the smallest thing that is genuinely canonical, and nothing
 * else.
 *
 * ===========================================================================
 * THE OWNERSHIP BOUNDARY, WHICH IS THE WHOLE DESIGN.
 *
 * CANONICAL_PRODUCT  decided here, by scripts, and true everywhere. The
 *                    artefact carries these.
 * PRODUCTION_OWNED   created by people using the deployed application. The
 *                    artefact must never contain or overwrite them.
 * DERIVED            rebuildable from the two above. NEVER shipped — shipping
 *                    a derived table means shipping a digest computed over
 *                    somebody else's source rows, which is the exact lie the
 *                    materialisation stamp exists to prevent. Production
 *                    rebuilds from its own reconciled source instead.
 * AUTH               never a target, under any flag.
 *
 * `roster_season_trust` straddles the first two, and that is the hard part.
 * One row holds a MACHINE measurement and a HUMAN decision about it. The
 * machine half is canonical; the human half belongs to whoever made it, on
 * whichever database they made it. So the importer writes the machine columns
 * and is structurally incapable of writing the others — see MACHINE_COLUMNS.
 */
import crypto from 'node:crypto';
import db from '../db/client.js';
import { canonical, digest, datasetManifest, MANIFEST_VERSION } from './evidenceBaseline.js';
import { DIAGNOSIS_KEYS } from '../../shared/roster/seasonTrust.js';

export const ARTEFACT_FORMAT = 'thriv3.canonical-product';
export const ARTEFACT_VERSION = 1;

/**
 * The machine-owned columns of `roster_season_trust`.
 *
 * NOT a judgement call: this is exactly the column list in
 * `recordSeasonTrust.js`'s INSERT, which is the only writer of the machine
 * half and which says of itself that "a future edit to this file cannot set a
 * disposition by accident — it would have to add the column". A test asserts
 * these two lists stay equal, so the definition cannot drift from the writer.
 */
export const MACHINE_COLUMNS = Object.freeze([
  'season', 'college_name', 'sport', 'diagnosis', 'diagnosis_evidence', 'diagnosed_at',
]);

/**
 * The human-owned columns, named so the refusal can be explicit rather than
 * implied by absence. `next_action` is here because `recordDisposition` writes
 * it and the machine insert does not: it is the reviewer's instruction to the
 * next person, not a measurement.
 */
export const HUMAN_COLUMNS = Object.freeze([
  'disposition', 'disposition_evidence', 'reviewed_at', 'reviewed_by_operator_id',
  'next_action', 'previous_disposition', 'previous_reviewed_at',
]);

export const PROGRAMME_STATUS_COLUMNS = Object.freeze([
  'school', 'sport', 'status', 'reason', 'active_from_season', 'active_to_season',
  'evidence', 'source_url', 'recorded_at', 'recorded_by_operator_id',
]);

const SPORTS = Object.freeze(['mens-soccer', 'womens-soccer']);

/**
 * The datasets this version may carry, and how each one reconciles.
 *
 * REPLACE  the canonical dataset is authoritative in full: production ends up
 *          matching it exactly, including removals. Only legitimate where no
 *          production code path writes the table — `programme_status` has no
 *          write route at all, which is why it qualifies and why nothing else
 *          here does.
 *
 * MERGE_MACHINE  upsert by identity, writing ONLY the machine columns, and
 *          never removing a row. A production row a person has decided on is
 *          updated in its machine half and left alone in its human half.
 */
export const DATASETS = Object.freeze({
  programme_status: Object.freeze({
    table: 'programme_status',
    key: Object.freeze(['school', 'sport']),
    columns: PROGRAMME_STATUS_COLUMNS,
    mode: 'REPLACE',
  }),
  roster_season_trust_machine: Object.freeze({
    table: 'roster_season_trust',
    key: Object.freeze(['season', 'college_name', 'sport']),
    columns: MACHINE_COLUMNS,
    mode: 'MERGE_MACHINE',
  }),
});

const STATUS_KEYS = Object.freeze(['NOT_ACTIVE', 'FUTURE', 'ACTIVE']);

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

const rowsFor = (spec, source = db) => source.prepare(
  `SELECT ${spec.columns.map((c) => `"${c}"`).join(', ')} FROM "${spec.table}" `
  + `ORDER BY ${spec.key.map((c) => `"${c}"`).join(', ')}`,
).all();

/** One dataset's identity: its rows, order-independently. */
export function datasetDigest(name, rows) {
  const spec = DATASETS[name];
  const lines = rows.map((r) => canonical(spec.columns.map((c) => r[c] ?? null))).sort();
  return digest(canonical([name, spec.mode, spec.columns, lines]));
}

/**
 * Build the artefact from this checkout's corpus.
 *
 * DETERMINISTIC APART FROM `created_at`, which is why the digest is taken over
 * the datasets and the source identity and NOT over the envelope: two exports
 * of an unchanged corpus produce the same digest, so "has the canonical data
 * moved" is answerable without reading either file.
 */
export function buildArtefact({ now = new Date(), source = db } = {}) {
  const datasets = {};
  for (const [name, spec] of Object.entries(DATASETS)) {
    const rows = rowsFor(spec, source);
    datasets[name] = {
      table: spec.table,
      mode: spec.mode,
      key: [...spec.key],
      columns: [...spec.columns],
      rows: rows.length,
      digest: datasetDigest(name, rows),
      data: rows,
    };
  }
  /*
   * WHICH CORPUS THIS CAME FROM, in the identity the product already uses.
   * Not a second hashing system: `datasetManifest` is Manifest V7, and an
   * artefact that could not name its source corpus would be a set of rows with
   * no provenance — the exact defect L8B-4 retired four hashes for.
   */
  const manifest = datasetManifest();
  const sourceIdentity = { manifestVersion: MANIFEST_VERSION, corpusDigest: manifest.digest };
  return {
    format: ARTEFACT_FORMAT,
    version: ARTEFACT_VERSION,
    createdAt: now.toISOString(),
    source: sourceIdentity,
    datasets,
    digest: artefactDigest({ source: sourceIdentity, datasets }),
  };
}

/** The content digest: datasets and source identity, never `createdAt`. */
export function artefactDigest({ source, datasets }) {
  const parts = Object.keys(datasets).sort().map((n) => [
    n, datasets[n].table, datasets[n].mode, datasets[n].columns,
    datasets[n].rows, datasets[n].digest,
  ]);
  return digest(canonical([ARTEFACT_FORMAT, ARTEFACT_VERSION, source, parts]));
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

const isIdentity = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Every reason this artefact may not be applied, gathered rather than thrown
 * one at a time. An importer that reports the first problem and stops makes a
 * person run it five times to learn five things.
 */
export function validateArtefact(artefact, { target = db } = {}) {
  const errors = [];
  const fail = (m) => errors.push(m);

  if (!artefact || typeof artefact !== 'object') {
    return { ok: false, errors: ['artefact is not an object'] };
  }
  if (artefact.format !== ARTEFACT_FORMAT) fail(`format must be ${ARTEFACT_FORMAT}, got ${artefact.format}`);
  if (artefact.version !== ARTEFACT_VERSION) {
    fail(`version ${artefact.version} is not supported; this build reconciles version ${ARTEFACT_VERSION}`);
  }
  if (!artefact.source?.corpusDigest || !isIdentity(artefact.source.corpusDigest)) {
    fail('source corpus identity is missing: an artefact must say which corpus it was taken from');
  }
  const datasets = artefact.datasets ?? {};
  for (const name of Object.keys(DATASETS)) {
    if (!datasets[name]) fail(`required dataset missing: ${name}`);
  }
  for (const name of Object.keys(datasets)) {
    if (!DATASETS[name]) fail(`unknown dataset: ${name}`);
  }
  if (errors.length) return { ok: false, errors };

  for (const [name, spec] of Object.entries(DATASETS)) {
    const d = datasets[name];
    if (d.table !== spec.table) fail(`${name}: table must be ${spec.table}`);
    if (d.mode !== spec.mode) fail(`${name}: mode must be ${spec.mode}`);
    if (canonical(d.columns) !== canonical([...spec.columns])) {
      fail(`${name}: columns do not match this build's definition`);
    }
    if (!Array.isArray(d.data)) { fail(`${name}: rows are missing`); continue; }
    if (d.rows !== d.data.length) fail(`${name}: declares ${d.rows} rows and carries ${d.data.length}`);
    if (datasetDigest(name, d.data) !== d.digest) fail(`${name}: digest does not match its rows`);

    /* Nothing human may travel, even in a column the schema happens to have. */
    if (name === 'roster_season_trust_machine') {
      for (const r of d.data) {
        const smuggled = HUMAN_COLUMNS.filter((c) => c in r);
        if (smuggled.length) { fail(`${name}: human-owned field(s) present: ${smuggled.join(', ')}`); break; }
      }
    }

    /* Schema compatibility, against the TARGET rather than this checkout. */
    let have;
    try { have = target.prepare(`PRAGMA table_info("${spec.table}")`).all().map((c) => c.name); }
    catch { have = []; }
    if (!have.length) fail(`${name}: target has no ${spec.table} table`);
    else {
      const missing = spec.columns.filter((c) => !have.includes(c));
      if (missing.length) fail(`${name}: target ${spec.table} lacks column(s) ${missing.join(', ')}`);
    }

    /* Structural identity checks, so a malformed key cannot create a row. */
    for (const [i, r] of d.data.entries()) {
      for (const k of spec.key) {
        if (k === 'season') {
          if (!/^\d{4}$/.test(String(r[k] ?? ''))) { fail(`${name}[${i}]: season is not a four-digit year`); break; }
        } else if (!isIdentity(r[k])) { fail(`${name}[${i}]: ${k} is empty`); break; }
      }
      if (r.sport !== undefined && !SPORTS.includes(r.sport)) fail(`${name}[${i}]: unknown sport ${r.sport}`);
      if (name === 'roster_season_trust_machine' && !DIAGNOSIS_KEYS.includes(r.diagnosis)) {
        fail(`${name}[${i}]: unknown diagnosis ${r.diagnosis}`);
      }
      if (name === 'programme_status' && !STATUS_KEYS.includes(r.status)) {
        fail(`${name}[${i}]: unknown status ${r.status}`);
      }
    }
    const keys = new Set(d.data.map((r) => canonical(spec.key.map((k) => String(r[k])))));
    if (keys.size !== d.data.length) fail(`${name}: duplicate identities in the artefact`);
  }

  if (artefactDigest(artefact) !== artefact.digest) fail('artefact digest does not match its contents');

  return { ok: errors.length === 0, errors };
}

/* -------------------------------------------------------------------------- */
/* Plan and apply                                                              */
/* -------------------------------------------------------------------------- */

const keyOf = (spec, r) => canonical(spec.key.map((k) => String(r[k])));

/**
 * What applying this artefact WOULD do, computed without writing.
 *
 * The dry run and the apply share this function, so the report a person reads
 * before deciding is produced by the same code that then acts. Two
 * implementations of "what will change" is one implementation too many.
 */
export function planReconciliation(artefact, { target = db } = {}) {
  const plan = {};
  for (const [name, spec] of Object.entries(DATASETS)) {
    const incoming = artefact.datasets[name].data;
    const existing = target.prepare(`SELECT * FROM "${spec.table}"`).all();
    const byKey = new Map(existing.map((r) => [keyOf(spec, r), r]));
    const seen = new Set();

    let inserted = 0; let updated = 0; let unchanged = 0; let humanPreserved = 0;
    const humanPreservedRows = [];
    for (const r of incoming) {
      const k = keyOf(spec, r);
      seen.add(k);
      const cur = byKey.get(k);
      if (!cur) { inserted += 1; continue; }
      const writable = spec.mode === 'MERGE_MACHINE' ? spec.columns : spec.columns;
      const differs = writable.some((c) => (cur[c] ?? null) !== (r[c] ?? null));
      if (differs) updated += 1; else unchanged += 1;
      if (spec.mode === 'MERGE_MACHINE') {
        const held = HUMAN_COLUMNS.filter((c) => (cur[c] ?? null) !== null);
        if (held.length) {
          humanPreserved += 1;
          humanPreservedRows.push({ key: spec.key.map((x) => cur[x]), fields: held });
        }
      }
    }
    const removed = spec.mode === 'REPLACE'
      ? existing.filter((r) => !seen.has(keyOf(spec, r))).map((r) => spec.key.map((k) => r[k]))
      : [];

    plan[name] = {
      table: spec.table,
      mode: spec.mode,
      inserted,
      updated,
      unchanged,
      removed: removed.length,
      removedKeys: removed,
      humanPreserved,
      humanPreservedRows,
      /* What the table will hold afterwards, so the expectation is stated. */
      resultingRows: spec.mode === 'REPLACE' ? incoming.length : existing.length + inserted,
    };
  }
  return plan;
}

/**
 * Apply, in ONE transaction across every dataset.
 *
 * All or nothing, because a reconciliation that imported `programme_status`
 * and then failed on the trust machine state would leave production in a
 * combination neither the source nor the target ever was.
 */
export function applyReconciliation(artefact, { target = db, acknowledgement } = {}) {
  if (acknowledgement !== 'RECONCILE_CANONICAL_PRODUCT') {
    throw new Error('applyReconciliation requires an explicit acknowledgement');
  }
  const v = validateArtefact(artefact, { target });
  if (!v.ok) throw new Error(`artefact is not applicable:\n  ${v.errors.join('\n  ')}`);
  const plan = planReconciliation(artefact, { target });

  target.transaction(() => {
    for (const [name, spec] of Object.entries(DATASETS)) {
      const incoming = artefact.datasets[name].data;
      if (spec.mode === 'REPLACE') {
        const keys = new Set(incoming.map((r) => keyOf(spec, r)));
        for (const r of target.prepare(`SELECT * FROM "${spec.table}"`).all()) {
          if (!keys.has(keyOf(spec, r))) {
            target.prepare(
              `DELETE FROM "${spec.table}" WHERE ${spec.key.map((k) => `"${k}" = ?`).join(' AND ')}`,
            ).run(...spec.key.map((k) => r[k]));
          }
        }
      }
      const cols = spec.columns;
      const nonKey = cols.filter((c) => !spec.key.includes(c));
      const sql = `INSERT INTO "${spec.table}" (${cols.map((c) => `"${c}"`).join(', ')})
        VALUES (${cols.map((c) => `@${c}`).join(', ')})
        ON CONFLICT(${spec.key.map((c) => `"${c}"`).join(', ')}) DO UPDATE SET
          ${nonKey.map((c) => `"${c}" = excluded."${c}"`).join(', ')}`;
      const stmt = target.prepare(sql);
      for (const r of incoming) {
        stmt.run(Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
      }
    }
  })();

  return plan;
}

/** A stable identity for a produced artefact file, for the runbook to quote. */
export function fileDigest(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}
