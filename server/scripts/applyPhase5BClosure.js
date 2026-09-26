#!/usr/bin/env node
/**
 * PHASE 5B — apply the proven person-integrity repairs, safe personal email
 * corrections, and email-source evidence promotions to a NON-PRODUCTION DB, in
 * ONE all-or-nothing transaction.
 *
 *   node server/scripts/applyPhase5BClosure.js --db <path> \
 *     --person      docs/validation/integrity-audit/phase5b_person_repair_fixture.json \
 *     --corrections docs/validation/integrity-audit/phase5b_safe_correction_fixture.json \
 *     --promotions  docs/validation/integrity-audit/phase5b_evidence_promotion_fixture.json   # dry-run
 *   ... --apply                                                                                  # write
 *
 * Order and guarantees:
 *   F  person repairs (PROVEN_STALE / MOVED / WRONG_SPORT) -> currentness
 *      PROVEN_STALE, evidence stamped, history retained, eligibility fails closed.
 *      MOVED keeps the destination in the reason; no new coach record is invented.
 *   G  safe personal->personal email corrections. Expected-old-value guard: the
 *      update only fires WHERE the stored address equals the recorded old address.
 *      email_seen_on_source_* is set to the source proving the NEW exact address.
 *      NEVER touches email_confirmed_at. Generic replacements are NOT here.
 *   H  email-source promotions: email_seen_on_source_* for exact stored addresses
 *      proven on a current authoritative page (no address change).
 *
 * A coach repaired in F is excluded from G/H automatically (never promote a
 * now-stale address). SAFETY: refuses /data. Every change precondition-checked
 * before the transaction; any drift aborts with nothing written. Idempotent.
 * Mutates only the `coaches` table; never email_confirmed_at.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db');
if (!dbArg) { console.error('Give --db <target>.'); process.exit(2); }
if (/^\/data\//.test(path.resolve(dbArg))) { console.error('Refusing to target the production /data volume.'); process.exit(2); }
const readJson = (p) => (p && fs.existsSync(path.resolve(p)) ? JSON.parse(fs.readFileSync(path.resolve(p), 'utf8')) : null);
const norm = (s) => String(s || '').trim().toLowerCase();

const personFx = readJson(arg('person')) || { entries: [] };
const corrFx = readJson(arg('corrections')) || { entries: [] };
const promoFx = readJson(arg('promotions')) || { entries: [] };
const personEntries = personFx.entries || personFx;
const corrEntries = corrFx.entries || corrFx;
const promoEntries = promoFx.entries || promoFx;

const db = new Database(dbArg, { fileMustExist: true });
const cols = new Set(db.prepare('PRAGMA table_info(coaches)').all().map((c) => c.name));
for (const c of ['currentness_status', 'email_seen_on_source_at', 'email_seen_on_source_url']) {
  if (!cols.has(c)) { console.error(`Column coaches.${c} missing — run the migration first.`); db.close(); process.exit(2); }
}
const get = db.prepare('SELECT id, full_name, email, currentness_status, currentness_source_url, email_seen_on_source_url FROM coaches WHERE id=?');
const problems = [];
const staleIds = new Set(personEntries.map((e) => e.coach_id));

// ---- F: person repairs -> PROVEN_STALE ----
const stalePlan = []; let staleAlready = 0;
for (const e of personEntries) {
  const row = get.get(e.coach_id);
  if (!row) { problems.push(`person ${e.coach_id}: ABSENT`); continue; }
  const cat = e.category || 'PROVEN_STALE';
  if (!['PROVEN_STALE', 'MOVED', 'WRONG_SPORT'].includes(cat)) { problems.push(`person ${e.coach_id}: bad category ${cat}`); continue; }
  const src = e.source_url || e.evidence_url || row.currentness_source_url || null;
  const reason = e.reason || (cat === 'MOVED' ? `MOVED${e.destination_institution ? ' to ' + e.destination_institution : ''} — old association no longer current`
    : cat === 'WRONG_SPORT' ? 'WRONG_SPORT — not on this sport current staff' : 'PROVEN_STALE');
  if (row.currentness_status === 'PROVEN_STALE' && row.currentness_source_url === src) { staleAlready++; continue; }
  stalePlan.push({ coach_id: e.coach_id, checked_at: e.checked_at || '2026-09-27', source_url: src, reason: String(reason).slice(0, 240) });
}

// ---- G: safe personal email corrections ----
const corrPlan = []; let corrAlready = 0;
for (const e of corrEntries) {
  if (staleIds.has(e.coach_id)) continue; // never correct a now-stale coach
  const row = get.get(e.coach_id);
  if (!row) { problems.push(`correction ${e.coach_id}: ABSENT`); continue; }
  if (!e.new_email || !e.new_email.includes('@') || !e.old_email) { problems.push(`correction ${e.coach_id}: bad fixture`); continue; }
  if (norm(row.email) === norm(e.new_email)) { corrAlready++; continue; } // idempotent
  if (norm(row.email) !== norm(e.old_email)) { problems.push(`correction ${e.coach_id}: stored "${row.email}" != expected old "${e.old_email}"`); continue; }
  corrPlan.push({ coach_id: e.coach_id, old_email: row.email, new_email: e.new_email, seen_at: e.seen_at || e.checked_at || '2026-09-27', seen_url: e.seen_url || e.evidence_url });
}

// ---- H: email-source promotions (exact match) ----
const corrNewById = new Map(corrPlan.map((e) => [e.coach_id, e.new_email]));
const promoPlan = []; let promoAlready = 0, promoSkipMismatch = 0;
for (const e of promoEntries) {
  if (staleIds.has(e.coach_id)) continue;
  const row = get.get(e.coach_id);
  if (!row) { problems.push(`promotion ${e.coach_id}: ABSENT`); continue; }
  const effective = corrNewById.get(e.coach_id) || row.email;
  if (norm(effective) !== norm(e.email)) { promoSkipMismatch++; continue; } // exact-match only
  if (row.email_seen_on_source_url === (e.seen_url || e.email_seen_on_source_url)) { promoAlready++; continue; }
  promoPlan.push({ coach_id: e.coach_id, seen_at: e.seen_at || e.email_seen_on_source_at || e.checked_at || '2026-09-27', seen_url: e.seen_url || e.email_seen_on_source_url });
}

console.log('PHASE 5B closure plan');
console.log(`  F person->PROVEN_STALE : ${stalePlan.length} to set | ${staleAlready} already  (fixture ${personEntries.length})`);
console.log(`  G safe email corrections: ${corrPlan.length} to update | ${corrAlready} already  (fixture ${corrEntries.length})`);
console.log(`  H email_seen promotions : ${promoPlan.length} to set | ${promoAlready} already | ${promoSkipMismatch} skipped(not exact)  (fixture ${promoEntries.length})`);
problems.forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { console.error(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`); db.close(); process.exit(1); }
if (!apply) { console.log('\nDRY RUN — re-run with --apply to write.'); db.close(); process.exit(0); }

const setStale = db.prepare("UPDATE coaches SET currentness_status='PROVEN_STALE', currentness_checked_at=@checked_at, currentness_source_url=@source_url, currentness_reason=@reason WHERE id=@coach_id");
const setEmail = db.prepare('UPDATE coaches SET email=@new_email WHERE id=@coach_id AND email=@old_email');
const setSeen = db.prepare('UPDATE coaches SET email_seen_on_source_at=@seen_at, email_seen_on_source_url=@seen_url WHERE id=@coach_id');

let f = 0, g = 0, h = 0;
try {
  db.exec('BEGIN');
  for (const p of stalePlan) { if (setStale.run(p).changes !== 1) throw new Error(`stale ${p.coach_id}`); f++; }
  for (const p of corrPlan) { if (setEmail.run({ coach_id: p.coach_id, new_email: p.new_email, old_email: p.old_email }).changes !== 1) throw new Error(`correction ${p.coach_id}`); if (setSeen.run({ coach_id: p.coach_id, seen_at: p.seen_at, seen_url: p.seen_url }).changes !== 1) throw new Error(`correction-seen ${p.coach_id}`); g++; }
  for (const p of promoPlan) { if (setSeen.run(p).changes !== 1) throw new Error(`promotion ${p.coach_id}`); h++; }
  db.exec('COMMIT');
  console.log(`\nAPPLIED in one transaction — person_stale ${f}, corrections ${g}, promotions ${h}.`);
} catch (err) {
  try { db.exec('ROLLBACK'); } catch { /* */ }
  console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1);
}
db.close();
