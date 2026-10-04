#!/usr/bin/env node
/**
 * PHASE 8B.2 — deterministic promotion fixture builder.
 *
 *   node server/scripts/buildPhase8B2Fixture.js --db <DISPOSABLE copy> --batch <staged batch id> --input <gathered.json> --out-dir <dir>
 *
 * Reads the STAGED batch and the frozen Phase 8B.1A identity engine and writes fixture.json +
 * fixture_summary.json. Everything semantic is derived from the staged evidence; no timestamp, random id or
 * wall-clock value enters the hashed body, so two runs on unchanged inputs give the same hash.
 *
 * It must be pointed at a DISPOSABLE COPY: to learn what the engine would decide it applies the ops inside a
 * transaction and ROLLS BACK. It refuses to run against the shared corpus. Its output holds real player
 * names — keep it out of Git.
 *
 * A staged INSERT whose source page fails the page gate (ownership not trusted, tier not A, no/incomplete
 * parse) is moved to HELD, never inserted.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defaultDbPath } from '../db/corpusIdentity.js';

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };
const COPY = path.resolve(arg('db') || ''); const INPUT = path.resolve(arg('input') || ''); const OUTDIR = path.resolve(arg('out-dir') || '');
if (!arg('db') || !arg('input') || !arg('out-dir')) { console.error('usage: buildPhase8B2Fixture --db <disposable copy> --input <gathered.json> --out-dir <dir>'); process.exit(2); }
// The builder applies ops and ROLLS BACK on a read-write connection, so it may only ever open a disposable copy. The corpus guard is no
// protection here (in the owning checkout the live database is WORKTREE_LOCAL), so this is an explicit allow-list, whatever flags are given.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (!fs.existsSync(COPY)) { console.error(`no database at ${COPY}`); process.exit(2); }
const realCopy = fs.realpathSync(COPY);
const inScratch = [path.join(ROOT, 'server/data/generated'), fs.realpathSync(os.tmpdir())].some((d) => realCopy.startsWith(`${d}${path.sep}`));
if (!inScratch || realCopy === fs.realpathSync(defaultDbPath)) { console.error(`REFUSED: ${COPY} is not a DISPOSABLE copy. Point --db at a copy under server/data/generated/ (never the shared database).`); process.exit(2); }
process.env.RECRUITMATCH_DB = COPY;
const { default: db, dbPath } = await import('../db/client.js'); if (dbPath !== COPY) throw new Error(`client resolved ${dbPath}, expected ${COPY}`);
const { planPromotion, applyOp } = await import('../lib/refresh/promotion.js');
const { projectMinutes } = await import('./projectRosterMinutes.js');
const { playerHistoryChecks } = await import('../lib/players/historyMonitor.js');
const { loadRefreshContext, frozenSeasons } = await import('../lib/refresh/context.js');
const { stableJson } = await import('../lib/refresh/staging.js');
const { conformRosterRow } = await import('../lib/refresh/rosterRowConformance.js');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };

if (!arg('batch')) throw new Error('give --batch <exact staged batch id> (a database can hold several staged batches)');
const B = db.prepare('SELECT * FROM refresh_batches WHERE batch_id=?').get(arg('batch'));
if (!B) throw new Error(`batch ${arg('batch')} is not staged`);
const obs = db.prepare('SELECT * FROM refresh_observations WHERE batch_id=? ORDER BY observation_id').all(B.batch_id);
const input = JSON.parse(fs.readFileSync(INPUT, 'utf8')); const pageBy = new Map(input.pages.map((p) => [p.source_url, p]));
const ctx = loadRefreshContext(db); const domBy = new Map(ctx.domains.map((d) => [d.domain, d]));
const plan = planPromotion({ batch: B, observations: obs }, { frozen: frozenSeasons(ctx, B.scope) });
const obsBy = new Map(obs.map((o) => [o.observation_id, o]));

// ---- page gate (ownership, tier, parse) — an unresolved page can never reach the fixture
const gate = (o) => {
  const pg = pageBy.get(o.source_url); const host = hostOf(o.source_url); const ent = o.candidate_entity_id;
  const own = ent && ctx.resolver.hostOwnedBy(host, ent) ? 'TRUSTED_OWN_HOST' : ent && ctx.resolver.sourceOwnedBy(o.source_url, ent, { sport: pg?.sport }) ? 'TRUSTED_SCOPED_SHARED_HOST' : 'UNRESOLVED';
  const d = domBy.get(host) || domBy.get(host?.split('.').slice(-2).join('.'));
  const why = [];
  if (own === 'UNRESOLVED') why.push('source ownership unresolved');
  if (o.source_tier !== 'A') why.push(`source tier ${o.source_tier}`);
  if (!pg) why.push('source page missing from the gathered input');
  else { if (pg.source_complete !== true) why.push('page not complete'); if (!(pg.players?.length > 0)) why.push('no players parsed'); if (pg.adapter_evidence?.records != null && pg.adapter_evidence.records !== pg.players.length) why.push('record count != player count'); }
  return { own, domain_status: d?.status ?? null, why };
};
const ok = []; const gateHeld = [];
for (const op of plan.ops.filter((x) => x.dataset === 'ROSTER' && x.action === 'INSERT_ROSTER_ROW')) { const g = gate(obsBy.get(op.observation_id)); (g.why.length ? gateHeld : ok).push({ op, g }); }
const dev = { minutes_played_added_null: 0, position_null_to_UNKNOWN: 0, data_confidence_changed: 0, source_page_season_number_to_text: 0, nationality_country_name_to_International: 0, nationality_US_to_USA: 0, nationality_unmappable_set_NULL: 0, nationality_unmappable_observation_ids: [], explicit_null_keys_added: 0 };
const ops = ok.map(({ op, g }) => {
  const p = op.proposed; const c = conformRosterRow(p);
  if (p.minutes_played == null) dev.minutes_played_added_null++; if (p.position == null) dev.position_null_to_UNKNOWN++; if (p.data_confidence !== c.data_confidence) dev.data_confidence_changed++; if (typeof p.source_page_season === 'number') dev.source_page_season_number_to_text++;
  if (p.nationality && c.nationality === 'International' && c.country) dev.nationality_country_name_to_International++; else if (p.nationality && p.nationality !== 'USA' && c.nationality === 'USA') dev.nationality_US_to_USA++; else if (p.nationality && c.nationality === null) { dev.nationality_unmappable_set_NULL++; dev.nationality_unmappable_observation_ids.push(op.observation_id); }
  dev.explicit_null_keys_added += Object.keys(c).filter((k) => !(k in p) && c[k] === null).length;
  return { ...op, proposed: c, _g: g };
});
const LK = "SELECT * FROM player_observation_links WHERE to_season='2026'";
const strip = (l) => { const { recorded_at, ...r } = l; return r; };
const pre = { links: new Map(db.prepare(LK).all().map((l) => [l.link_id, l])), prior: new Map(db.prepare("SELECT id, prior_programme p FROM roster_players WHERE season='2026'").raw().all()) };
let built;
db.exec('BEGIN');
try {
  const ins = []; for (const op of ops) { db.exec('SAVEPOINT op'); const r = applyOp(db, op); db.exec('RELEASE op'); if (!r.noop) ins.push({ op, id: r.key.id }); }
  const log = console.log; console.log = () => {}; try { projectMinutes(db, { season: '2026', from: '2025' }); } finally { console.log = log; }
  built = { ins, postLinks: new Map(db.prepare(LK).all().map((l) => [l.link_id, l])), postPrior: new Map(db.prepare("SELECT id, prior_programme p FROM roster_players WHERE season='2026'").raw().all()),
    info: new Map(db.prepare("SELECT id, college_name, division, sport FROM roster_players WHERE season='2026'").all().map((r) => [r.id, r])), checks: playerHistoryChecks(db).map((c) => ({ id: c.id, severity: c.severity, count: c.list.length })) };
} finally { db.exec('ROLLBACK'); }
const newIds = new Set(built.ins.map((x) => x.id));
const linkInserts = [...built.postLinks.values()].filter((l) => !pre.links.has(l.link_id)).sort((a, b) => a.link_id.localeCompare(b.link_id));
const linkUpdates = [...pre.links.values()].filter((l) => { const n = built.postLinks.get(l.link_id); return n && stableJson(strip(n)) !== stableJson(strip(l)); }).sort((a, b) => a.link_id.localeCompare(b.link_id));
if ([...pre.links.keys()].some((k) => !built.postLinks.has(k))) throw new Error('the engine would remove links — not representable in this fixture');
if (linkInserts.some((l) => !newIds.has(l.to_observation_id))) throw new Error('a link insert targets an existing observation');
const priorChanges = [...built.postPrior].filter(([id, p]) => (pre.prior.get(id) ?? null) !== (p ?? null)).map(([id, p]) => ({ roster_id: id, expected_old: pre.prior.get(id) ?? null, proposed: p ?? null })).sort((a, b) => a.roster_id.localeCompare(b.roster_id));
const linksByTo = new Map(); for (const l of linkInserts) (linksByTo.get(l.to_observation_id) || linksByTo.set(l.to_observation_id, []).get(l.to_observation_id)).push(`${l.relation}|${l.decision}|${l.evidence_class}`);
const dupNote = (o) => { const n = (JSON.parse(o.evidence_json || '{}').notes || []).join(' '); return /SAME NAME ELSEWHERE|TRANSFER CANDIDATE/.test(n) ? 'IDENTITY_ONLY_MATCH' : 'NEW_OBSERVATION'; };
const rosterInsert = built.ins.map(({ op, id }) => { const o = obsBy.get(op.observation_id); const pg = pageBy.get(o.source_url); const row = op.proposed; const pr = built.postPrior.get(id) ?? null;
  return { observation_id: op.observation_id, roster_id: id, action: 'INSERT_ROSTER_ROW', classification: 'AUTO_SAFE', duplicate_class: dupNote(o), expected_old: op.expected, proposed: row,
    provenance: { source_url: o.source_url, source_host: o.source_host, source_kind: o.source_kind, source_tier: o.source_tier, platform: pg?.adapter_evidence?.platform, parser: o.parser_version, adapter_version: pg?.adapter_version, page_sha256: pg?.adapter_evidence?.sha256, fetched_at: o.fetched_at, page_season: pg?.page_season, ownership_decision: op._g.own, domain_status: op._g.domain_status, currentness_status: pg?.currentness_check?.status ?? null, currentness_checked_at: pg?.currentness_check?.checked_at ?? null, currentness_note: pg?.currentness_check?.note ?? null, programme_entity: o.candidate_entity_id, college_id: o.candidate_college_id, resolution: `${o.resolution_method}/${o.resolution_decision}`, staged_batch_id: B.batch_id, staged_batch_hash: B.batch_hash },
    association: built.info.get(id).division, sport: row.sport, season: row.season, identity_consequence: { links: (linksByTo.get(id) || []).sort(), prior_programme: pr, factual_cross_prior: !!pr && pr !== row.college_name },
    reason: 'new player-season on a Tier-A official roster owned by the resolved programme; a roster observation asserts nothing about identity', blast_radius: 'one roster_players row + its identity links; no other canonical table' }; }).sort((a, b) => a.observation_id.localeCompare(b.observation_id));
const mapStaged = (cls) => obs.filter((o) => o.classification === cls).map((o) => ({ observation_id: o.observation_id, source_url: o.source_url, why: (JSON.parse(o.evidence_json || '{}').why || [])[0] ?? null }));
const held = [...mapStaged('DISAPPEARED_FROM_SOURCE'), ...mapStaged('SOURCE_UNTRUSTED'), ...mapStaged('IDENTITY_AMBIGUOUS'), ...gateHeld.map(({ op, g }) => ({ observation_id: op.observation_id, source_url: obsBy.get(op.observation_id).source_url, why: `PAGE_GATE: ${g.why.join('; ')}` }))].map((x) => ({ ...x, classification: 'HELD' })).sort((a, b) => a.observation_id.localeCompare(b.observation_id));
const body = {
  phase: '8B.2', fixture_version: 2, scope: 'NJCAA/USCAA 2026 roster promotion',
  inputs: { staged_batch_id: B.batch_id, staged_batch_hash: B.batch_hash, staged_observations: obs.length, gathered_input_sha256: sha(fs.readFileSync(INPUT)), engine_method: 'p8b1a-identity-1' },
  deviations_from_staged_proposal: { ...dev, note: 'conformRosterRow (server/lib/refresh/rosterRowConformance.js): minutes_played DEFAULT 0 would manufacture zero minutes; absent position uses the table sentinel UNKNOWN; confidence is lowercased; source_page_season is TEXT; nationality follows the table convention (USA|International, name in country) and an unmappable country is left NULL, never guessed' },
  roster_insert: rosterInsert,
  link_insert: linkInserts.map((l) => ({ link_id: l.link_id, expected_old: 'ABSENT', proposed: strip(l), reason: 'decision recorded by the frozen 8B.1A identity engine for a new observation' })),
  link_update: linkUpdates.map((l) => ({ link_id: l.link_id, expected_old: strip(l), proposed: strip(built.postLinks.get(l.link_id)), reason: 'a promoted same-name observation changes the evidence for an existing claim (engine recompute)' })),
  prior_change: priorChanges.map((c) => ({ ...c, reason: newIds.has(c.roster_id) ? 'prior_programme projection of a VERIFIED_SAME_PERSON link on a new observation' : 'existing verified prior withdrawn: the frozen rule no longer holds it VERIFIED once the new observations exist' })),
  held, contradiction: mapStaged('CONTRADICTION').map((x) => ({ ...x })), noop_already_present: [], review: [],
  expected_consequences: { roster_rows_inserted: rosterInsert.length, links_inserted: linkInserts.length, links_updated: linkUpdates.length, priors_changed: priorChanges.length, engine_player_checks: built.checks },
};
// hash what a reader will actually parse: an `undefined` field vanishes from the file but not from the in-memory object, and the applier hashes the file
const fileBody = JSON.parse(JSON.stringify(body)); const hash = sha(stableJson(fileBody)); fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(path.join(OUTDIR, 'fixture.json'), JSON.stringify({ ...fileBody, fixture_hash: hash }));
const cnt = (xs, f) => xs.reduce((a, x) => { const k = f(x); a[k] = (a[k] || 0) + 1; return a; }, {});
const summary = { fixture_hash: hash, staged_batch_hash: B.batch_hash, staged_observations: obs.length, roster_insert: rosterInsert.length, link_insert: linkInserts.length, link_update: linkUpdates.length, prior_change: priorChanges.length, held: held.length, contradiction: body.contradiction.length, review: 0, noop: 0,
  programmes: new Set(rosterInsert.map((r) => `${r.association}|${r.sport}|${r.proposed.college_name}`)).size, by_association_sport: cnt(rosterInsert, (r) => `${r.association}|${r.sport}`), by_currentness: cnt(rosterInsert, (r) => r.provenance.currentness_status ?? 'NOT_CHECKED'), duplicate_class: cnt(rosterInsert, (r) => r.duplicate_class), deviations: dev, factual_cross_new: rosterInsert.filter((r) => r.identity_consequence.factual_cross_prior).length, engine_player_checks: built.checks };
fs.writeFileSync(path.join(OUTDIR, 'fixture_summary.json'), JSON.stringify(summary, null, 1)); console.log(JSON.stringify(summary, null, 1));
