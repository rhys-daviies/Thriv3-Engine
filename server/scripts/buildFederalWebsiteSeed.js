#!/usr/bin/env node
/**
 * FEDERAL INSTITUTION WEBSITE SEED — Phase 1G-B (B4). Builds server/data/seeds/federal_institution_websites.json.
 *
 * Source: the U.S. Department of Education College Scorecard bulk release
 * `Most-Recent-Cohorts-Institution.csv` (federal IPEDS institutional data), UNMODIFIED. Each row
 * gives an institution's federal id (UNITID), its legal name (INSTNM), aliases (ALIAS), state,
 * whether it is a main campus (MAIN), whether it operates (CURROPER) and its website (INSTURL).
 * The seed records the source file's sha256 and retrieval date so it can be reproduced and
 * reviewed; it is the only evidence the programme-contact federal mail-domain rule reads.
 *
 *   node server/scripts/buildFederalWebsiteSeed.js --csv <Most-Recent-Cohorts-Institution.csv> \
 *     --retrieved-at <YYYY-MM-DD> [--expect-sha256 <hex>] [--out server/data/seeds/federal_institution_websites.json]
 *
 * Deterministic: rows sorted by UNITID; no timestamps other than the recorded retrieval date.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SEED_KIND = 'FEDERAL_INSTITUTION_WEBSITES';
export const SEED_SOURCE = 'U.S. Department of Education, College Scorecard bulk release Most-Recent-Cohorts-Institution.csv (federal IPEDS institutional characteristics), downloaded from ed-public-download.scorecard.network; unmodified';

/** RFC 4180 rows from CSV text (quoted fields, doubled quotes, newlines inside quotes). */
export function* csvRows(text) {
  let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); yield row; row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); yield row; }
}

const clean = (v) => { const s = String(v ?? '').trim(); return s === '' || s === 'NULL' || s === 'NA' || s === 'PrivacySuppressed' ? null : s; };

export function buildSeed(text, { retrievedAt, sourceSha256 }) {
  const it = csvRows(text);
  const header = it.next().value.map((h) => h.replace(/^﻿/, ''));
  const at = (name) => { const i = header.indexOf(name); if (i < 0) throw new Error(`column ${name} missing from the source`); return i; };
  const I = { unitid: at('UNITID'), name: at('INSTNM'), alias: at('ALIAS'), state: at('STABBR'), website: at('INSTURL'), main: at('MAIN'), operating: at('CURROPER') };
  const rows = []; const rejected = [];
  for (const r of it) {
    if (r.length < header.length / 2) continue;
    const unitid = Number(clean(r[I.unitid]));
    if (!Number.isInteger(unitid)) continue;
    // a "website" that is an email address is not a website: it proves nothing and is a third
    // party's contact address, which never enters the repository (fail closed: no website)
    let website = clean(r[I.website]);
    if (website && /@/.test(website)) { rejected.push(unitid); website = null; }
    rows.push({ unitid, name: clean(r[I.name]), alias: clean(r[I.alias]), state: clean(r[I.state]), website, main: clean(r[I.main]) === '1', operating: clean(r[I.operating]) === '1' });
  }
  rows.sort((a, b) => a.unitid - b.unitid);
  const dup = rows.filter((r, i) => i && rows[i - 1].unitid === r.unitid);
  if (dup.length) throw new Error(`duplicate UNITIDs in the source: ${dup.slice(0, 5).map((r) => r.unitid).join(', ')}`);
  const body = { kind: SEED_KIND, source: SEED_SOURCE, source_sha256: sourceSha256, retrieved_at: retrievedAt, columns: ['unitid', 'name', 'alias', 'state', 'website', 'main', 'operating'], row_count: rows.length, websites_rejected_as_addresses: rejected.sort((a, b) => a - b), rows };
  return { ...body, seed_sha256: crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };
  if (!arg('csv') || !/^\d{4}-\d{2}-\d{2}$/.test(arg('retrieved-at') || '')) { console.error('usage: buildFederalWebsiteSeed --csv <file> --retrieved-at YYYY-MM-DD [--expect-sha256 <hex>] [--out <seed.json>]'); process.exit(2); }
  const buf = fs.readFileSync(path.resolve(arg('csv')));
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (arg('expect-sha256') && arg('expect-sha256') !== sha) { console.error(`source sha256 ${sha} != expected ${arg('expect-sha256')}`); process.exit(1); }
  const seed = buildSeed(buf.toString('utf8'), { retrievedAt: arg('retrieved-at'), sourceSha256: sha });
  const out = path.resolve(arg('out') || 'server/data/seeds/federal_institution_websites.json');
  fs.writeFileSync(out, `${JSON.stringify(seed, null, 0).replace(/\},\{/g, '},\n{')}\n`);
  console.log(`SEED ${seed.row_count} institutions, ${seed.rows.filter((r) => r.website).length} with a website · source ${sha.slice(0, 16)} · seed ${seed.seed_sha256.slice(0, 16)} -> ${out}`);
}
