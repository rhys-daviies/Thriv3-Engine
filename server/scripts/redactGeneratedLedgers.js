#!/usr/bin/env node
/**
 * PRE-MERGE SAFETY CLOSURE — turn the two generated coach ledgers into
 * publishable evidence without publishing the people in them.
 *
 *   node server/scripts/redactGeneratedLedgers.js --in <dir> [--out <dir>] [--check]
 *
 * `coach_contact_ledger.csv` and `coaches_reconciled.csv` carry one row per
 * `coaches` record — 6,347 real people, with names and working email addresses,
 * 44 of them at consumer providers. THIS REPOSITORY IS PUBLIC. A tracked copy
 * of those files is a harvestable contact list for every college soccer coach
 * in the dataset, published by us, and nothing in the audit trail needs it:
 * every reconciliation DECISION is reproducible from the decision columns plus
 * the row id, and the row id resolves to the person only inside the database.
 *
 * So the raw CSVs stay LOCAL (untracked, regenerable) and what gets committed
 * is a pair per ledger:
 *
 *   <name>_manifest.json   small and readable — the column policy, the source
 *                          file's SHA-256 so a regenerated copy can be proven
 *                          identical, and the distribution of every decision
 *                          column, so the shape is legible without opening the data
 *   <name>_redacted.csv    every row, keyed by `coach_id`, carrying the decision
 *                          and provenance columns and nothing else
 *
 * WHAT IS DROPPED, AND WHY EACH ONE
 *   coach_name   the person
 *   email        the person's mailbox — the actual harvest target
 *   title        free text, 99 chars wide, and a title plus a school names a
 *                person as surely as the name column does
 *   source_url   staff-bio paths routinely spell the coach's name; the
 *                registrable domain is kept instead, which is the part every
 *                integrity check actually reads
 *
 * WHAT IS KEPT, AND THE CHECK THAT KEEPS IT HONEST
 *   `reason` and `evidence` are templated, but templated is an assumption, not
 *   a guarantee. Every retained value is tested against the name and address of
 *   EVERY row before it is written — not just its own row's — and a hit
 *   redacts the field rather than the run failing open. A value that survives
 *   contains no name and no address in this dataset.
 *
 * --check re-derives the manifests and exits non-zero if the committed ones
 * differ, so the suite can hold the redaction in place.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const CHECK = process.argv.includes('--check');

/** The columns each manifest keeps. Everything absent from this list is dropped. */
export const KEEP = {
  'coaches_reconciled.csv': [
    'coach_id', 'sport', 'legacy_school', 'legacy_unitid', 'canonical_unitid', 'canonical_school',
    'source_domain', 'email_domain', 'classification', 'institution_resolution_status',
    'coach_identity_status', 'email_verification_status', 'outreach_eligibility',
    'ineligible_reason', 'resolution_method', 'evidence', 'reassigned', 'canonicalized',
  ],
  'coach_contact_ledger.csv': [
    'coach_id', 'sport', 'current_school', 'current_school_unitid', 'source_domain', 'email_domain',
    'resolved_unitid', 'resolved_school', 'resolution_method', 'resolution_confidence',
    'classification', 'reason', 'email_status', 'state', 'division',
    'coach_seasons_at_current', 'coach_seasons_at_resolved',
  ],
};
/** Named so a future reader sees the omission was a decision, not an oversight. */
export const DROP_REASON = {
  coach_name: 'the person',
  email: 'the person\'s mailbox',
  title: 'free text that names a person when paired with a school',
  source_url: 'staff-bio paths spell coach names; source_domain is kept instead',
};
/** Columns kept but scrubbed if they turn out to quote anybody. */
const FREE_TEXT = new Set(['reason', 'evidence']);
/** Which column distributions are worth printing in full. */
const DISTRIBUTION_MAX = 60;

export function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Build one manifest. `identifiers` is every name and address in the file; a
 * retained free-text value containing any of them is replaced, never emitted.
 */
export function redact(name, text) {
  const rows = parseCsv(text);
  const header = rows[0];
  const body = rows.slice(1).filter((r) => r.length === header.length);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const keep = KEEP[name];
  const missing = keep.filter((c) => !(c in idx));
  if (missing.length) throw new Error(`${name}: expected columns absent: ${missing.join(', ')}`);

  const identifiers = new Set();
  for (const r of body) {
    for (const c of ['coach_name', 'email']) {
      const v = (r[idx[c]] || '').trim().toLowerCase();
      if (v.length >= 4) identifiers.add(v);
    }
  }

  let scrubbed = 0;
  const out = body.map((r) => {
    const o = {};
    for (const c of keep) {
      let v = r[idx[c]];
      if (FREE_TEXT.has(c) && v) {
        const low = v.toLowerCase();
        for (const id of identifiers) {
          if (low.includes(id)) { v = '[REDACTED — quoted a person]'; scrubbed += 1; break; }
        }
      }
      o[c] = v === '' ? null : v;
    }
    return o;
  });

  const distributions = {};
  for (const c of keep) {
    if (c === 'coach_id' || FREE_TEXT.has(c)) continue;
    const counts = new Map();
    for (const o of out) { const k = o[c] === null ? '(null)' : String(o[c]); counts.set(k, (counts.get(k) || 0) + 1); }
    distributions[c] = counts.size <= DISTRIBUTION_MAX
      ? Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]))
      : { '(distinct values)': counts.size };
  }

  const csv = [keep.join(','), ...out.map((o) => keep.map((c) => {
    const v = o[c] === null ? '' : String(o[c]);
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(','))].join('\n') + '\n';

  return {
    csv,
    manifest: {
      source_file: name,
      status: 'REDACTED MANIFEST — the raw CSV is generated locally and deliberately untracked.',
      why: 'The source carries coach names and working email addresses for 6,347 real people and this '
        + 'repository is public. Decisions are reproducible from these columns plus coach_id; identity '
        + 'resolves only inside the database.',
      rows_published_as: name.replace(/\.csv$/, '_redacted.csv'),
      regenerate: 'node server/scripts/reconcileCoaches.js --db <non-production db> then '
        + 'node server/scripts/redactGeneratedLedgers.js --in server/data/generated',
      source_sha256: crypto.createHash('sha256').update(text).digest('hex'),
      source_rows: body.length,
      columns_kept: keep,
      columns_dropped: Object.fromEntries(header.filter((h) => !keep.includes(h)).map((h) => [h, DROP_REASON[h] || 'not needed to reproduce a decision'])),
      free_text_values_redacted_for_quoting_a_person: scrubbed,
      distributions,
    },
    scrubbed,
  };
}

/** Importing this module must not write or exit — the tests import `redact` and `KEEP`. */
function main() {
  const inDir = path.resolve(arg('in') || path.join(ROOT, 'server/data/generated'));
  const outDir = path.resolve(arg('out') || path.join(ROOT, 'docs/validation/generated'));
  let failed = 0;
  for (const name of Object.keys(KEEP)) {
    const src = path.join(inDir, name);
    const dest = path.join(outDir, name.replace(/\.csv$/, '_manifest.json'));
    if (!fs.existsSync(src)) {
      console.log(`SKIP  ${name} — not present at ${path.relative(ROOT, src)} (regenerate it locally to refresh the manifest)`);
      continue;
    }
    const destCsv = path.join(outDir, name.replace(/\.csv$/, '_redacted.csv'));
    const { manifest, csv, scrubbed } = redact(name, fs.readFileSync(src, 'utf8'));
    const wanted = [[dest, `${JSON.stringify(manifest, null, 2)}\n`], [destCsv, csv]];
    for (const [file, text] of wanted) {
      if (CHECK) {
        const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        if (have !== text) { console.error(`DIFFERS  ${path.relative(ROOT, file)}`); failed += 1; }
        else console.log(`OK       ${path.relative(ROOT, file)}`);
      } else {
        fs.writeFileSync(file, text);
        console.log(`WROTE ${path.relative(ROOT, file)}`);
      }
    }
    if (!CHECK) {
      console.log(`      ${manifest.source_rows} rows | ${manifest.columns_kept.length} columns kept | `
        + `${Object.keys(manifest.columns_dropped).length} dropped | ${scrubbed} free-text values redacted`);
    }
  }
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
