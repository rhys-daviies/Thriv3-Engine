/**
 * Write athletics hosts whose identity was established one at a time.
 *
 * The ledger arrived as a single crawl: 2,717 rows, one `checked_at`, and no
 * way to say "this row was verified on its own evidence, later". The column is
 * per-row and NOT NULL, so nothing about the schema prevented it — the table
 * simply had never been written to that way.
 *
 * This is that writer, and the shape it produces is not new either. Three rows
 * already carry `OFFICIAL_DIRECTORY_AND_PAGE_SELF_IDENTIFICATION`, and they set
 * the precedent this follows exactly, including for an abbreviated site name:
 * `bsubears.com` reads "Bridgewater St." and is still WHOLE_NAME, because
 * `identity_strength` records that the identity is whole rather than a
 * short-base-name coincidence — and the coincidence is what BASE_ONLY means.
 *
 * TWO ANCHORS OR NOTHING. Every row here required an official institution page
 * that links to the host AND the host's own self-identification, with city or
 * state from the registry as a third check where the name is shared (Wayne
 * State, Wesleyan). A name search may find a candidate; it may never be the
 * proof. The evidence for each row is in the seed file beside it, in prose, so
 * a reviewer can check the claim rather than the code.
 *
 *   node server/scripts/verifiedDomainBackfill.js            # report only
 *   node server/scripts/verifiedDomainBackfill.js --apply    # write
 */
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/client.js';
import { utcNow } from '../lib/time.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const SEED = argv[argv.indexOf('--seed') + 1] && argv.includes('--seed')
  ? argv[argv.indexOf('--seed') + 1]
  : path.resolve(process.cwd(), 'server/data/seeds/athletics_domains_verified.json');

/** The fields a verified row carries, and the values the ledger already uses. */
export function verifiedRow(entry, checkedAt) {
  return {
    domain: entry.domain,
    unitid: entry.unitid,
    status: 'VERIFIED',
    role: 'ATHLETICS_SITE',
    claimed_keys: JSON.stringify([entry.school]),
    claimed_unitids: JSON.stringify([entry.unitid]),
    wrong_mappings: null,
    evidence_kind: 'CURATED_CORRECTION',
    evidence_text: entry.evidence_text,
    identity_method: 'EXACT',
    identity_strength: 'WHOLE_NAME',
    platform: entry.platform ?? null,
    http_status: 200,
    final_url: entry.final_url ?? `https://${entry.domain}/`,
    verification_method: 'OFFICIAL_DIRECTORY_AND_PAGE_SELF_IDENTIFICATION',
    confidence: 'CORROBORATED',
    notes: entry.notes,
    checked_at: checkedAt,
  };
}

function main() {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  const checkedAt = utcNow();
  const existing = db.prepare('SELECT domain, unitid, status, role, confidence FROM athletics_domains WHERE domain = ?');

  const plan = [];
  for (const e of seed.rows ?? []) {
    const was = existing.get(e.domain);
    plan.push({ kind: was ? 'UPDATE' : 'INSERT', was, row: verifiedRow(e, checkedAt), school: e.school });
  }
  for (const e of seed.roleCorrections ?? []) {
    const was = existing.get(e.domain);
    if (!was) throw new Error(`role correction for a row that does not exist: ${e.domain}`);
    if (was.unitid !== e.unitid) {
      throw new Error(`role correction would move ${e.domain} from ${was.unitid} to ${e.unitid} — that is not a role change`);
    }
    plan.push({ kind: 'ROLE', was, school: e.school, row: { domain: e.domain, role: 'ATHLETICS_SITE', notes: e.notes, checked_at: checkedAt } });
  }

  console.log(`\n  ${seed.stage ?? 'seed'} — ${plan.length} rows from ${path.basename(SEED)}\n`);
  for (const p of plan) {
    console.log(`  ${p.kind.padEnd(6)} ${p.row.domain.padEnd(28)} -> ${String(p.row.unitid ?? p.was.unitid).padEnd(7)} ${p.school}`);
    if (p.was) console.log(`         was: ${p.was.status}/${p.was.role ?? '-'}/${p.was.confidence}${p.was.unitid != null ? ` u=${p.was.unitid}` : ' (no unitid)'}`);
  }

  if (!APPLY) { console.log('\n  (report only — pass --apply to write)\n'); return; }

  const cols = Object.keys(verifiedRow(seed.rows[0], checkedAt));
  const upsert = db.prepare(`INSERT INTO athletics_domains (${cols.join(', ')})
    VALUES (${cols.map((c) => `@${c}`).join(', ')})
    ON CONFLICT(domain) DO UPDATE SET ${cols.filter((c) => c !== 'domain').map((c) => `${c} = excluded.${c}`).join(', ')}`);
  const role = db.prepare('UPDATE athletics_domains SET role = @role, notes = @notes, checked_at = @checked_at WHERE domain = @domain');

  const run = db.transaction(() => {
    for (const p of plan) (p.kind === 'ROLE' ? role : upsert).run(p.row);
  });
  run();
  console.log(`\n  wrote ${plan.length} rows at ${checkedAt}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
