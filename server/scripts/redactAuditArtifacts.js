#!/usr/bin/env node
/**
 * Remove real coach identities from the committed audit artifacts.
 *
 *   node server/scripts/redactAuditArtifacts.js --db <db> --targets <list> [--check]
 *
 * The PR #49 closure found the two generated ledgers publishing 6,347 names and
 * addresses. A sweep of every blob in every commit of the PR found the same data
 * in FIFTY-ONE more artifacts — the Phase 4/5/6/7 evidence ledgers, currency
 * waves and applier fixtures. They were never the headline; they are the same
 * disclosure, spread thinner. This repository is public.
 *
 * WHAT REPLACES WHAT, AND WHY IT IS NOT A HASH
 *
 * An address is replaced by the id of the coach row it belongs to —
 * `coach-<uuid>@redacted.invalid` — and a name by `[name withheld — coach <uuid>]`.
 * The row id is already throughout these files, resolves to the person only inside
 * the database, and keeps the audit trail LINKABLE: the same coach reads as the
 * same token in every artifact, so "this is the row Phase 4B repaired and Phase
 * 6C.2 later recovered" survives redaction.
 *
 * A salted digest was the obvious alternative and is worse. To stay linkable
 * across files the salt must be committed, and a committed salt over a known,
 * small address space (firstname.lastname at ~1,200 known athletics domains) is
 * enumerable in minutes. The digest would look like protection while being
 * reversible. Where a value resolves to no coach row there is no id to use, so
 * it falls back to `[withheld]` with no token at all — unlinkable, but never
 * false comfort.
 *
 * WHAT IS NOT REDACTED
 *
 * Institution names, UNITIDs, domains, source URLs at the DIRECTORY level,
 * classifications, verdicts, counts and rationales: every field an integrity
 * decision was actually made on. A `source_url` that spells a person's name in
 * its path is rewritten to its directory; the domain is what the checks read.
 *
 * `--check` re-runs the scan and exits non-zero if any target still contains a
 * real name or address, so the suite can hold this in place.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const CHECK = process.argv.includes('--check');

const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Keys whose value is a person, whatever it happens to contain. */
const NAME_KEYS = new Set(['coach_name', 'full_name', 'name', 'person', 'coach']);
const EMAIL_KEYS = new Set(['email', 'proposed_email', 'expected_old_email', 'old_email', 'new_email',
  'current_email', 'replacement_email', 'coach_email']);
const URL_KEYS = new Set(['source_url', 'email_source_url', 'currentness_source_url', 'current_source_url', 'evidence_url']);

export function buildIdentity(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const rows = db.prepare("SELECT id, full_name, email FROM coaches").all();
  db.close();
  const byEmail = new Map(); const byName = new Map(); const ambiguousName = new Set();
  for (const r of rows) {
    const e = (r.email || '').trim().toLowerCase();
    if (e.includes('@')) { if (byEmail.has(e) && byEmail.get(e) !== r.id) byEmail.set(e, null); else if (!byEmail.has(e)) byEmail.set(e, r.id); }
    const n = (r.full_name || '').trim().toLowerCase();
    // Two tokens minimum: a bare first name is a common word and redacting it
    // would gut the prose without protecting anybody.
    if (n.length >= 6 && n.split(/\s+/).length >= 2) {
      if (byName.has(n) && byName.get(n) !== r.id) ambiguousName.add(n);
      else byName.set(n, r.id);
    }
  }
  for (const n of ambiguousName) byName.set(n, null);
  const names = [...byName.keys()].sort((a, b) => b.length - a.length); // longest first
  const nameRx = names.length
    ? new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi')
    : null;
  return { byEmail, byName, nameRx };
}

const emailToken = (id) => (id ? `coach-${id}@redacted.invalid` : '[withheld]@redacted.invalid');
const nameToken = (id) => (id ? `[name withheld — coach ${id}]` : '[name withheld]');

/** Rewrite one string. `keyHint` lets a field that IS a person be redacted whole. */
export function scrubString(value, ident, keyHint = null) {
  if (typeof value !== 'string' || value === '') return value;
  let out = value;

  if (keyHint && URL_KEYS.has(keyHint) && /^https?:\/\//i.test(out)) {
    // A staff-bio path spells the person; the directory is what the checks read.
    const lower = out.toLowerCase();
    const namey = ident.nameRx && ident.nameRx.test(lower);
    if (ident.nameRx) ident.nameRx.lastIndex = 0;
    const slugged = /\/[a-z]+[-_][a-z]+(\/|$|\.)/i.test(out);
    if (namey || slugged) { try { const u = new URL(out); out = `${u.origin}${u.pathname.replace(/[^/]*$/, '')}`; } catch { /* leave */ } }
  }

  /**
   * EVERY mailbox goes, not only the ones the coaches table happens to hold.
   *
   * The first pass keyed redaction on membership in `coaches`, and 117 real
   * addresses survived it — research addresses that were never imported, and
   * at least one personal Gmail. "Is it in our table?" is a fact about our
   * import coverage, not about whether a mailbox belongs to a person.
   *
   * An address we can resolve becomes its coach id, which stays linkable. One
   * we cannot keeps its DOMAIN and loses its local part: `[withheld]@csulb.edu`
   * still answers every question the integrity checks ask of an address, since
   * all of them read the domain.
   */
  out = out.replace(EMAIL_RX, (m) => {
    const id = ident.byEmail.get(m.toLowerCase());
    if (id) return emailToken(id);
    const domain = m.split('@').pop();
    return `[withheld]@${domain}`;
  });

  if (ident.nameRx) {
    ident.nameRx.lastIndex = 0;
    out = out.replace(ident.nameRx, (m) => nameToken(ident.byName.get(m.toLowerCase())));
  }

  if (keyHint && EMAIL_KEYS.has(keyHint) && out === value && value.includes('@')) return emailToken(null);
  if (keyHint && NAME_KEYS.has(keyHint) && out === value && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(value)) {
    return nameToken(null); // a person we hold no row for is still a person
  }
  return out;
}

function scrub(node, ident, keyHint = null) {
  if (typeof node === 'string') return scrubString(node, ident, keyHint);
  if (Array.isArray(node)) return node.map((v) => scrub(v, ident, keyHint));
  if (node && typeof node === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(node)) o[k] = scrub(v, ident, k);
    return o;
  }
  return node;
}

/** Everything a target still leaks, for --check and for the report. */
export function residual(text, ident) {
  let emails = 0; let names = 0;
  for (const m of text.match(EMAIL_RX) || []) {
    if (m.endsWith('@redacted.invalid') || m.startsWith('[withheld]@')) continue;
    emails += 1; // any surviving mailbox counts, resolvable or not
  }
  if (ident.nameRx) { ident.nameRx.lastIndex = 0; names = (text.match(ident.nameRx) || []).length; }
  return { emails, names };
}

function redactFile(rel, ident) {
  const abs = path.join(ROOT, rel);
  const before = fs.readFileSync(abs, 'utf8');
  let after;
  if (rel.endsWith('.json')) {
    let parsed;
    try { parsed = JSON.parse(before); } catch { return { rel, skipped: 'unparseable JSON' }; }
    after = `${JSON.stringify(scrub(parsed, ident), null, 2)}\n`;
  } else {
    after = before.split('\n').map((l) => scrubString(l, ident)).join('\n');
  }
  return { rel, before, after, was: residual(before, ident), now: residual(after, ident) };
}

const dbPath = arg('db') || path.join(ROOT, 'server/data/recruitmatch.sqlite');
const targets = fs.readFileSync(path.resolve(arg('targets')), 'utf8').trim().split('\n').filter(Boolean);
const ident = buildIdentity(dbPath);
console.log(`reference: ${ident.byEmail.size} addresses, ${ident.byName.size} names\n`);

let leaked = 0; let changed = 0;
for (const rel of targets) {
  if (!fs.existsSync(path.join(ROOT, rel))) { console.log(`GONE   ${rel}`); continue; }
  const r = redactFile(rel, ident);
  if (r.skipped) { console.log(`SKIP   ${rel} — ${r.skipped}`); continue; }
  if (CHECK) {
    const cur = residual(r.before, ident);
    if (cur.emails || cur.names) { console.error(`LEAKS  ${rel} — ${cur.emails} addresses, ${cur.names} names`); leaked += 1; }
    continue;
  }
  if (r.after !== r.before) {
    fs.writeFileSync(path.join(ROOT, rel), r.after);
    changed += 1;
    console.log(`${String(r.was.emails).padStart(5)}e ${String(r.was.names).padStart(4)}n -> `
      + `${String(r.now.emails).padStart(4)}e ${String(r.now.names).padStart(4)}n   ${rel}`);
    if (r.now.emails || r.now.names) leaked += 1;
  }
}
console.log(CHECK ? `\n${leaked} target(s) still leak.` : `\n${changed} file(s) rewritten; ${leaked} still leak.`);
process.exit(leaked ? 1 : 0);
