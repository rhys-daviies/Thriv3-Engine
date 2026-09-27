#!/usr/bin/env node
/**
 * Remove head-coach contact PII from the committed university CSVs.
 *
 *   node server/scripts/redactUniversityCoachPii.js [--check]
 *
 * `data/university-individualisation/{mens,womens}_soccer_universities.csv` are
 * GENERATED artifacts — `tools/soccer/build.py` writes them to a directory
 * outside this repository and they were copied in by hand. No code under
 * `server/`, `src/`, `shared/` or `worker/` reads them; the two tools that do
 * (`repair_athletics_domain.py`, `discover_roster_urls.py`) read
 * `athletics_domain` and the roster URL, never a coach field. Coach contact
 * data reaches the product through the database, not through git.
 *
 * Between them they carried 2,033 head-coach names and 1,947 addresses, and the
 * files' own `head_coach_email_type` column classifies 802 of the men's as
 * "personal" — by the data's own account these are individuals' mailboxes, not
 * programme role addresses. This repository is public.
 *
 * WHAT IS REMOVED — the person, and nothing else
 *   head_coach         the name
 *   head_coach_email   the mailbox
 *   coach_source_url   only where the path spells the coach's name; the rest of
 *                      the URL is kept, because the page is the evidence
 *
 * WHAT IS KEPT, DELIBERATELY
 *   All 45 other columns: school identity, division, conference, colours,
 *   nickname, scores, four seasons of results, postseason, academic rating,
 *   roster URL, graduating seniors, provenance. None of it is about a person.
 *   `head_coach_title` is kept — 48 distinct job titles ("Head Coach", "Head
 *   Men's Soccer Coach"), none embedding a name, verified rather than assumed.
 *   `head_coach_email_type` is kept: "a personal address was published here" is
 *   provenance worth having once the address is gone.
 *
 * Free-text columns are scrubbed against every name in the file — a note that
 * quotes a coach is redacted rather than trusted to be institutional.
 *
 * --check exits non-zero if either file still carries coach PII.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CHECK = process.argv.includes('--check');

export const TARGETS = [
  'data/university-individualisation/mens_soccer_universities.csv',
  'data/university-individualisation/womens_soccer_universities.csv',
];
/** Columns emptied outright. The value IS the person. */
export const BLANK_COLUMNS = ['head_coach', 'head_coach_email'];
/** Columns kept but scrubbed if they quote somebody. */
const FREE_TEXT = ['identity_notes', 'data_sources', 'conference_champion_notes', 'conference_champion_source', 'identity_source'];
const URL_COLUMN = 'coach_source_url';
const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

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
const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Redact one file's text. Returns the new text and what it removed. */
export function redact(text) {
  const rows = parseCsv(text);
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const missing = [...BLANK_COLUMNS, URL_COLUMN].filter((c) => !(c in idx));
  if (missing.length) throw new Error(`expected columns absent: ${missing.join(', ')}`);
  const trailingBlank = rows.length > 1 && rows[rows.length - 1].every((c) => c === '');
  const body = rows.slice(1, trailingBlank ? -1 : undefined).filter((r) => r.length === header.length);

  const names = new Set();
  for (const r of body) {
    const n = (r[idx.head_coach] || '').trim().toLowerCase();
    if (n.length >= 5 && /\s/.test(n)) names.add(n);
  }

  const removed = { names: 0, emails: 0, urls: 0, freeText: 0 };
  for (const r of body) {
    for (const c of BLANK_COLUMNS) {
      if ((r[idx[c]] || '').trim()) { removed[c === 'head_coach' ? 'names' : 'emails'] += 1; r[idx[c]] = ''; }
    }
    const u = (r[idx[URL_COLUMN]] || '').trim();
    if (u) {
      const low = u.toLowerCase();
      // Only where the path actually spells the person. The page itself is evidence.
      let named = false;
      for (const n of names) {
        const parts = n.split(/\s+/).filter((p) => p.length > 2);
        if (parts.length && parts.every((p) => low.includes(p))) { named = true; break; }
      }
      if (named) {
        removed.urls += 1;
        try { const url = new URL(u); r[idx[URL_COLUMN]] = `${url.origin}${url.pathname.replace(/[^/]*$/, '')}`; }
        catch { r[idx[URL_COLUMN]] = ''; }
      }
    }
    for (const c of FREE_TEXT) {
      if (!(c in idx)) continue;
      const v = r[idx[c]] || '';
      if (!v) continue;
      let out = v;
      const low = v.toLowerCase();
      for (const n of names) if (low.includes(n)) { out = '[redacted — quoted a person]'; break; }
      out = out.replace(EMAIL_RX, (m) => `[withheld]@${m.split('@').pop()}`);
      if (out !== v) { removed.freeText += 1; r[idx[c]] = out; }
    }
  }
  const out = [header, ...body].map((r) => r.map(esc).join(',')).join('\n')
    + (trailingBlank || text.endsWith('\n') ? '\n' : '');
  return { text: out, removed, rows: body.length, columns: header.length };
}

/** What a redacted file must no longer contain. */
export function residualPii(text) {
  const rows = parseCsv(text);
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const body = rows.slice(1).filter((r) => r.length === header.length);
  let names = 0; let emails = 0;
  for (const r of body) {
    if ((r[idx.head_coach] || '').trim()) names += 1;
    for (const cell of r) {
      for (const m of cell.match(EMAIL_RX) || []) if (!m.startsWith('[withheld]@')) emails += 1;
    }
  }
  return { names, emails };
}

/** Importing this module must not write or exit — the tests import `redact`. */
function main() {
  let failed = 0;
  for (const rel of TARGETS) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { console.log(`GONE  ${rel}`); continue; }
    const before = fs.readFileSync(abs, 'utf8');
    if (CHECK) {
      const r = residualPii(before);
      if (r.names || r.emails) { console.error(`LEAKS ${rel} — ${r.names} names, ${r.emails} addresses`); failed += 1; }
      else console.log(`OK    ${rel}`);
      continue;
    }
    const { text, removed, rows, columns } = redact(before);
    fs.writeFileSync(abs, text);
    const after = residualPii(text);
    console.log(`${rel}\n  rows ${rows} · columns ${columns} (unchanged) · removed `
      + `${removed.names} names, ${removed.emails} addresses, ${removed.urls} name-bearing URLs, `
      + `${removed.freeText} free-text values\n  residual: ${after.names} names, ${after.emails} addresses`);
    if (after.names || after.emails) failed += 1;
  }
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
