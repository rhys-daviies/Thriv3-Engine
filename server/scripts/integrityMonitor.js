#!/usr/bin/env node
/**
 * RECURRING INTEGRITY MONITOR — Phase 7E. Read-only. Run on a schedule, after every
 * promotion, and after any acknowledged legacy write.
 *
 *   npm run integrity:monitor -- --db <path> [--json] [--no-reconcile] [--now <iso>] [--season N]
 *
 * IDENTITY   programme without entity; entities unexpectedly sharing a host; suspicious UNITID
 *            reuse; row links; membership periods (all via the permanent validator)
 * COACH      source domain contradicts entity; eligible coach whose currentness check is STALE;
 *            inferred / stale / wrong-sport eligible; canonical round-trip   (reconciles a copy)
 * ROSTER     current programme without a current roster; latest roster too old; duplicate
 *            player-season; orphan roster rows; improbable movement (class going backwards)
 * DOMAIN     trusted host redirects to another entity's host; entity-owned host that no longer
 *            self-identifies as its entity (stored evidence text)
 * PROGRAMME  colleges.division disagrees with the open membership period; memberships due for
 *            re-verification; SEED-only memberships; frozen seasons changed
 * HARD findings exit 1. WARN/INFO are reported, never fatal.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { validateEntityIdentity } from './validateAthleticsEntityIdentity.js';
import { loadRefreshContext } from '../lib/refresh/context.js';
import { seasonFingerprint } from '../lib/refresh/temporal.js';
import { freshnessOf, cycleOf } from '../lib/refresh/freshness.js';
import { measureDatabase } from '../lib/refresh/integrityMeasure.js';
import { personKey, selfIdentifies } from '../lib/refresh/changeClassifier.js';
import { hostOf } from '../lib/athleticsEntity.js';
import { classRank } from '../../shared/lifecycle/lifecycle.js';
import { playerHistoryChecks } from '../lib/players/historyMonitor.js';

const NAIA_FREEZE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../shared/naiaIntegrityFreeze.json');
export function loadNaiaFreeze(p = NAIA_FREEZE) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
const DIVISION_BASELINE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../shared/njcaaUscaaBaseline.json');
export function loadDivisionBaseline(p = DIVISION_BASELINE) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

export function runMonitor(dbPath, { now = new Date(), season, reconcile = true } = {}) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const cur = season ?? cycleOf(now);
  const checks = [];
  const add = (category, id, severity, list, note) => checks.push({ category, id, severity: list.length ? severity : 'OK', count: list.length, sample: list.slice(0, 8), note });
  try {
    const v = validateEntityIdentity(db);
    add('IDENTITY', 'identity_invariant', 'HARD', v.hard, `validator ${v.status}; ${v.documented.length} documented exceptions`);
    add('IDENTITY', 'stale_exception_entries', 'WARN', v.warnings);
    const ctx = loadRefreshContext(db);
    const linked = new Set(ctx.rowLinks.map((l) => l.college_id));
    // hosts whose trusted rows name different entities without a parent link
    const hostEnt = new Map();
    for (const d of ctx.domains) { if (!['VERIFIED', 'VERIFIED_ALIAS'].includes(d.status)) continue; const e = d.athletics_entity_id || ctx.resolver.unitidEntity(d.unitid)?.entity; if (!e) continue; const h = String(d.domain); (hostEnt.get(h) || hostEnt.set(h, new Set()).get(h)).add(e); }
    add('IDENTITY', 'host_shared_by_entities', 'HARD', [...hostEnt].filter(([, s]) => s.size > 1).map(([h, s]) => `${h}: ${[...s].join(', ')}`));

    // PROGRAMME
    const reviewDue = ctx.periods.filter((p) => p.last_season == null && p.review_due_season != null && Number(p.review_due_season) <= cur).map((p) => `${p.athletics_entity_id}|${p.sport} ${p.division} ${p.membership_status} review due ${p.review_due_season}`);
    add('PROGRAMME', 'membership_review_due', 'WARN', reviewDue);
    add('PROGRAMME', 'membership_seed_only_unverified', 'INFO', ctx.periods.filter((p) => p.last_season == null && p.source_tier === 'SEED').map((p) => `${p.athletics_entity_id}|${p.sport}`), 'seeded from colleges at the Phase 7E cut-over; verified on first refresh');
    add('PROGRAMME', 'provisional_memberships', 'INFO', ctx.periods.filter((p) => p.last_season == null && p.membership_status === 'PROVISIONAL').map((p) => `${p.athletics_entity_id}|${p.sport} ${p.division} ${p.conference || ''} postseason ${p.postseason_eligible}`));
    const freezes = db.prepare("SELECT name FROM sqlite_master WHERE name='season_freezes'").get() ? db.prepare('SELECT * FROM season_freezes').all() : [];
    add('PROGRAMME', 'frozen_season_changed', 'HARD', freezes.filter((f) => JSON.stringify(seasonFingerprint(db, f.season)) !== f.fingerprint_json).map((f) => `${f.season}/${f.scope}`), `${freezes.length} frozen season(s)`);

    // DIVISIONS STILL BEING ESTABLISHED (Phase 8A) — NJCAA / USCAA. Reported, never enforced:
    // no coverage freeze yet. Drift is measured against the committed Phase 8A baseline.
    const base8a = loadDivisionBaseline();
    for (const div of ['NJCAA', 'USCAA']) {
      const act = ctx.colleges.filter((c) => c.division === div && c.active === 1 && !linked.has(c.id) && c.athletics_entity_id);
      const keys = new Set(act.map((c) => `${c.athletics_entity_id}|${c.sport}`));
      const bySport = { m: act.filter((c) => c.sport === 'mens-soccer').length, w: act.filter((c) => c.sport === 'womens-soccer').length };
      const b = base8a?.[div];
      const added = b ? [...keys].filter((k) => !b.keys.includes(k)) : []; const removed = b ? b.keys.filter((k) => !keys.has(k)) : [];
      checks.push({ category: div, id: 'programme_universe', severity: 'INFO', count: keys.size, sample: [], note: `logical ${keys.size} (men ${bySport.m}, women ${bySport.w})${b ? ` · drift vs Phase 8A baseline +${added.length}/-${removed.length}` : ''}` });
      add(div, 'universe_drift_vs_baseline', 'WARN', [...added.map((k) => `+${k}`), ...removed.map((k) => `-${k}`)], 'changes since the Phase 8A baseline must come from guarded promotions');
      const open = ctx.periods.filter((p) => p.last_season == null && act.some((c) => c.id === p.college_id));
      add(div, 'membership_unverified', 'INFO', open.filter((p) => p.source_tier === 'SEED').map((p) => `${p.athletics_entity_id}|${p.sport}`), `${open.filter((p) => ['A', 'B'].includes(p.source_tier)).length} verified by an authoritative listing`);
      add(div, 'membership_verification_stale', 'WARN', open.filter((p) => ['A', 'B'].includes(p.source_tier) && freshnessOf('membership', p, { now }).state === 'STALE').map((p) => `${p.athletics_entity_id}|${p.sport}`));
      const ents = new Map(ctx.entities.map((e) => [e.athletics_entity_id, e]));
      add(div, 'unresolved_entity', 'WARN', [...new Set(act.filter((c) => ents.get(c.athletics_entity_id)?.entity_kind === 'UNRESOLVED_FEDERAL').map((c) => `${c.name} (${c.athletics_entity_id})`))]);
      const byEnt = new Map(); for (const c of act) (byEnt.get(c.athletics_entity_id) || byEnt.set(c.athletics_entity_id, new Set()).get(c.athletics_entity_id)).add(c.sport);
      add(div, 'single_gender_entities', 'INFO', [...byEnt].filter(([, s]) => s.size === 1).map(([e, s]) => `${e} ${[...s][0]}`), 'an entity with one soccer programme — confirm the other is genuinely not sponsored');
      add(div, 'entities_without_trusted_host', 'INFO', [...byEnt.keys()].filter((e) => !ctx.resolver.entityHosts(e).size));
      // Phase 8B.1 triage (reported, never fatal)
      const locEnts = new Set((ctx.locations || []).filter((l) => l.status === 'VERIFIED').map((l) => l.athletics_entity_id));
      add(div, 'current_programme_without_source_location', 'INFO', act.filter((c) => !ctx.resolver.entityHosts(c.athletics_entity_id).size && !locEnts.has(c.athletics_entity_id)).map((c) => `${c.athletics_entity_id}|${c.sport}`), 'no trusted athletics host and no verified host + path-scope location');
      add(div, 'current_programme_without_verified_membership', 'INFO', act.filter((c) => { const p = open.find((x) => x.college_id === c.id); return !p || !['A', 'B'].includes(p.source_tier); }).map((c) => `${c.athletics_entity_id}|${c.sport}`));
      // CA/WA/OR community colleges are CCCAA / NWAC; an NJCAA row there is suspect UNLESS an NJCAA listing verified it
      // (e.g. Pacific Northwest Christian, NJCAA Region 18) — measured on shared dev, Phase 8B.1
      if (div === 'NJCAA') add(div, 'association_mismatch_state', 'WARN', act.filter((c) => ['CA', 'WA', 'OR'].includes(c.state) && !['A', 'B'].includes(open.find((x) => x.college_id === c.id)?.source_tier)).map((c) => `${c.name} [${c.sport}] ${c.state}`), 'an unverified NJCAA row in CA/WA/OR — those programmes are normally CCCAA / NWAC');
    }
    if ((ctx.locations || []).length) add('DOMAIN', 'source_location_stale', 'WARN', ctx.locations.filter((l) => l.status === 'VERIFIED' && freshnessOf('domain', { checked_at: l.last_verified_at || l.recorded_at }, { now }).state === 'STALE').map((l) => `${l.host}${l.path_prefix} (${l.athletics_entity_id})`), 'a verified path scope not re-checked within the freshness window');
    if (db.prepare("SELECT name FROM sqlite_master WHERE name='refresh_observations'").get()) {
      add('STAGING', 'unpromoted_contradictions', 'INFO', db.prepare("SELECT batch_id||' '||dataset||' '||coalesce(raw_name,'') k FROM refresh_observations WHERE classification='CONTRADICTION' AND promoted_at IS NULL").all().map((r) => r.k));
      // refusal / ambiguity spike on the latest staged roster batch (a parser or identity regression shows here first)
      const lastB = db.prepare("SELECT batch_id FROM refresh_observations WHERE dataset='ROSTER' GROUP BY batch_id ORDER BY MAX(fetched_at) DESC LIMIT 1").get();
      if (lastB) {
        const st = db.prepare("SELECT COUNT(*) n, SUM(classification='IDENTITY_AMBIGUOUS') amb, SUM(classification IN ('SOURCE_UNTRUSTED','CONTRADICTION')) bad, SUM(requires_review) rev FROM refresh_observations WHERE batch_id=? AND dataset='ROSTER' AND NOT (classification='DISAPPEARED_FROM_SOURCE')").get(lastB.batch_id);
        const rate = st.n ? (st.amb + st.bad) / st.n : 0;
        add('STAGING', 'roster_batch_refusal_spike', 'WARN', rate > 0.1 ? [`${lastB.batch_id}: ${st.amb} ambiguous + ${st.bad} untrusted/contradiction of ${st.n} (${(rate * 100).toFixed(1)}%)`] : [], `latest roster batch: ${st.n} observations, ${st.rev} review-required`);
      }
    }

    // ROSTER
    const roster = db.prepare('SELECT id, college_name, sport, season, player_name, class_year_label FROM roster_players').all();
    const rowByNS = new Map(ctx.colleges.map((c) => [`${c.name}|${c.sport}`, c]));
    add('ROSTER', 'orphan_roster_rows', 'WARN', [...new Set(roster.filter((r) => !rowByNS.has(`${r.college_name}|${r.sport}`)).map((r) => `${r.college_name} [${r.sport}]`))]);
    // roster count collapse vs the prior season (unexpected zero is current_programme_without_current_roster)
    { const cnt = new Map(); for (const r of roster) { const k = `${r.college_name}|${r.sport}|${r.season}`; cnt.set(k, (cnt.get(k) || 0) + 1); }
      const collapse = []; for (const [k, n] of cnt) { const [c, sp, se] = k.split('|'); if (Number(se) !== cur) continue; const prev = cnt.get(`${c}|${sp}|${cur - 1}`) || 0; if (prev >= 10 && n < prev * 0.5 && prev - n >= 5) collapse.push(`${c} [${sp}] ${prev} -> ${n}`); }
      add('ROSTER', 'roster_count_collapse', 'WARN', collapse, 'a current roster under half the prior season — an incomplete source or a parser regression until shown otherwise'); }
    const latest = new Map();
    for (const r of roster) { const c = rowByNS.get(`${r.college_name}|${r.sport}`); if (!c) continue; const canon = ctx.resolver.canonicalRow(c.id) || c; latest.set(canon.id, Math.max(latest.get(canon.id) ?? 0, Number(r.season))); }
    const carriers = ctx.colleges.filter((c) => c.active === 1 && !linked.has(c.id));
    add('ROSTER', 'current_programme_without_current_roster', 'INFO', carriers.filter((c) => (latest.get(c.id) ?? 0) < cur).map((c) => `${c.name} [${c.sport}] latest ${latest.get(c.id) ?? 'none'}`));
    add('ROSTER', 'roster_source_stale', 'WARN', carriers.filter((c) => latest.has(c.id) && freshnessOf('roster', { latest_season: latest.get(c.id) }, { now, season: cur }).state === 'STALE').map((c) => `${c.name} [${c.sport}] latest ${latest.get(c.id)}`));
    const ps = new Map();
    for (const r of roster) { const k = `${r.college_name}|${r.sport}|${r.season}|${personKey(r.player_name)}`; ps.set(k, (ps.get(k) || 0) + 1); }
    add('ROSTER', 'duplicate_player_season', 'WARN', [...ps].filter(([, n]) => n > 1).map(([k, n]) => `${k.split('|').slice(0, 3).join(' ')} x${n}`));
    const byProgPerson = new Map();
    for (const r of roster) { const k = `${r.college_name}|${r.sport}|${personKey(r.player_name)}`; (byProgPerson.get(k) || byProgPerson.set(k, []).get(k)).push(r); }
    const backwards = [];
    for (const [k, list] of byProgPerson) { const s = list.slice().sort((a, b) => a.season - b.season); for (let i = 1; i < s.length; i++) { const a = classRank(s[i - 1].class_year_label); const b = classRank(s[i].class_year_label); if (a != null && b != null && Number(s[i].season) === Number(s[i - 1].season) + 1 && b < a) { backwards.push(`${k.split('|').slice(0, 2).join(' ')} ${s[i - 1].season}->${s[i].season}`); break; } } }
    add('ROSTER', 'improbable_class_movement', 'INFO', backwards, 'same name, same programme, class going backwards year on year (same-name collision or data error)');

    // PLAYER HISTORY (Phase 8B.1A) — a name match is a candidate, not a person
    for (const c of playerHistoryChecks(db)) add('PLAYER', c.id, c.severity, c.list, c.note);

    // DOMAIN
    const redirects = ctx.domains.filter((d) => ['VERIFIED', 'VERIFIED_ALIAS'].includes(d.status) && d.final_url).filter((d) => { const fh = hostOf(d.final_url); if (!fh || fh === d.domain || fh.endsWith(`.${d.domain}`) || d.domain.endsWith(`.${fh}`)) return false; const own = ctx.resolver.index.entityForHost(fh); const mine = d.athletics_entity_id || ctx.resolver.unitidEntity(d.unitid)?.entity; return own && mine && own !== mine; }).map((d) => `${d.domain} -> ${hostOf(d.final_url)}`);
    add('DOMAIN', 'trusted_host_redirects_to_other_entity', 'HARD', redirects);
    const selfBad = ctx.domains.filter((d) => d.athletics_entity_id && ['VERIFIED', 'VERIFIED_ALIAS'].includes(d.status) && d.evidence_text).filter((d) => !selfIdentifies(ctx, d.athletics_entity_id, d.evidence_text).ok).map((d) => `${d.domain} (${d.athletics_entity_id})`);
    add('DOMAIN', 'entity_host_no_longer_self_identifies', 'WARN', selfBad);
    add('DOMAIN', 'domain_verification_stale', 'WARN', ctx.domains.filter((d) => ['VERIFIED', 'VERIFIED_ALIAS'].includes(d.status) && freshnessOf('domain', d, { now }).state === 'STALE').map((d) => d.domain));

    // COACH (reconciles a temp copy)
    if (reconcile) {
      const m = measureDatabase(dbPath);
      add('COACH', 'source_domain_contradicts_entity', 'HARD', m.integrity.source_domain_conflicts ? [`${m.integrity.source_domain_conflicts} eligible`] : []);
      add('COACH', 'inferred_email_eligible', 'HARD', m.integrity.inferred_eligible ? [`${m.integrity.inferred_eligible}`] : []);
      add('COACH', 'stale_coach_eligible', 'HARD', m.integrity.stale_eligible ? [`${m.integrity.stale_eligible}`] : []);
      add('COACH', 'wrong_sport_eligible', 'HARD', m.integrity.wrong_sport_eligible ? [`${m.integrity.wrong_sport_eligible}`] : []);
      add('COACH', 'wrong_institution_eligible', 'HARD', m.integrity.wrong_institution_eligible ? [`${m.integrity.wrong_institution_eligible}`] : []);
      add('COACH', 'canonical_round_trip', 'HARD', m.integrity.canonical_round_trip ? [`${m.integrity.canonical_round_trip}`] : []);
      const coaches = new Map(db.prepare('SELECT id, currentness_status, currentness_checked_at, currentness_source_url, email_seen_on_source_at FROM coaches').all().map((c) => [c.id, c]));
      const aging = m.eligible_ids.filter((id) => freshnessOf('coach', coaches.get(id) || {}, { now }).state === 'STALE').map((id) => String(id).slice(0, 8));
      add('COACH', 'eligible_currentness_check_stale', 'WARN', aging, 'currentness check older than the previous competitive cycle — re-verify (never auto-demoted)');
      // NAIA freeze drift (Phase 7E): the frozen NAIA universe/coverage/membership may change only
      // through guarded promotions recorded after the freeze
      const fz = loadNaiaFreeze();
      if (fz) {
        const covered = crypto.createHash('sha256').update(m.naia.covered_keys.join(',')).digest('hex');
        const drift = [['universe', m.universe.NAIA.hash, fz.universe_hash], ['covered', covered, fz.covered_hash], ['membership', m.membership.NAIA.hash, fz.membership_hash]].filter(([, a2, b2]) => a2 !== b2).map(([k]) => k);
        const promos = db.prepare("SELECT name FROM sqlite_master WHERE name='refresh_promotions'").get() ? db.prepare("SELECT promotion_id FROM refresh_promotions WHERE status='PROMOTED' AND promoted_at > ?").all(fz.frozen_at).map((r) => r.promotion_id) : [];
        add('PROGRAMME', 'naia_freeze_drift_unexplained', 'HARD', drift.length && !promos.length ? drift : [], `NAIA frozen ${fz.frozen_at}: ${fz.logical_programmes} logical / ${fz.covered_authoritative} covered`);
        add('PROGRAMME', 'naia_freeze_changed_by_promotion', 'INFO', drift.length && promos.length ? promos : []);
      }
      checks.push({ category: 'COACH', id: 'measure', severity: 'INFO', count: 0, sample: [], note: JSON.stringify({ eligible: m.eligible, naia: { logical: m.naia.logical, covered: m.naia.covered, strict_path: m.naia.strict_path, strict_complete: m.naia.strict_evidence_complete }, integrity: m.integrity }) });
    }
    add('DB', 'integrity_check', 'HARD', db.pragma('integrity_check', { simple: true }) === 'ok' ? [] : ['integrity_check failed']);
  } finally { db.close(); }
  const hard = checks.filter((c) => c.severity === 'HARD');
  return { status: hard.length ? 'FAIL' : 'PASS', season: cur, checked_at: now.toISOString(), checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const a = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
  const dbPath = a('db'); if (!dbPath) { console.error('Give --db.'); process.exit(2); }
  const r = runMonitor(dbPath, { now: a('now') ? new Date(a('now')) : new Date(), season: a('season') ? Number(a('season')) : undefined, reconcile: !process.argv.includes('--no-reconcile') });
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`integrity monitor: ${r.status} (season ${r.season})`);
    for (const c of r.checks) console.log(`  ${c.severity.padEnd(4)} ${c.category.padEnd(9)} ${c.id.padEnd(44)} ${String(c.count).padStart(5)}${c.note ? `  ${c.note.slice(0, 160)}` : ''}${c.severity !== 'OK' && c.sample.length ? `\n         e.g. ${c.sample.slice(0, 3).join(' · ')}` : ''}`);
  }
  process.exit(r.status === 'FAIL' ? 1 : 0);
}
