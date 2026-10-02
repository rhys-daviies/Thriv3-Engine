/**
 * PLAYER-HISTORY LINK BUILDER — Phase 8B.1A.
 *
 * Replaces the name-only national linker that projectRosterMinutes.js used to run
 * ("the only programme with this letters-only name last season" -> prior_programme). Every
 * candidate is now a PAIRWISE claim with its signals and a decision from shared/players/identity.js,
 * and only VERIFIED_SAME_PERSON reaches `roster_players.prior_programme`.
 *
 *   SAME_PROGRAMME_CONTINUATION  same programme, adjacent season, same name — the read projected
 *                                minutes, retention and arrivals already rely on. Factual unless a
 *                                conflict (true-freshman reset, backwards class, other state) says
 *                                it is a second person with the same name.
 *   CROSS_PROGRAMME_PRIOR        another programme's prior roster. Factual only with a structured
 *                                previous school naming it, or hometown + class progression + an
 *                                uncommon name and nothing against.
 *   EXPLICIT_PRIOR_INSTITUTION   the destination roster names a previous college with no prior
 *                                observation on file. Factual only when that college has no
 *                                prior-season roster on file (outside coverage); otherwise the stated
 *                                school is an earlier stop or a stale bio, and it is PROBABLE.
 *
 * Reads only the DB (rosters + stored page evidence). No network, no page cache.
 */
import crypto from 'node:crypto';
import { extractRosterSchoolFields, buildInstitutionIndex, resolvePriorSchools, pageIsCollegeAware, RESOLUTION, FIELD_TYPE } from './priorSchoolEvidence.js';
import { linkNameKey, compareHometown, classStep, positionCompat, decideLink, RELATION, EXPLICIT, LINK_DECISION, EVIDENCE_CLASS, isFactual } from '../../../shared/players/identity.js';

export const LINK_METHOD = 'p8b1a-identity-1';
export const EVIDENCE_PARSER = 'prior-school-1';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
export const linkId = (relation, toId, fromProgramme) => `PL-${sha(`${relation}|${toId}|${fromProgramme}`)}`;
export const evidenceId = (obsId, url, fieldType) => `PE-${sha(`${obsId}|${url}|${fieldType}`)}`;

// ------------------------------------------------------------------ evidence collection (from official pages)
const STRENGTH = (parts) => {
  if (parts.some((x) => x.kind === RESOLUTION.COLLEGE)) return 'STRUCTURED_COLLEGE';
  if (parts.some((x) => x.kind === RESOLUTION.AMBIGUOUS)) return 'STRUCTURED_AMBIGUOUS';
  if (parts.length && parts.every((x) => x.kind === RESOLUTION.HIGH_SCHOOL)) return 'STRUCTURED_HIGH_SCHOOL';
  return 'STRUCTURED_UNRESOLVED';
};
/**
 * Evidence rows for the destination observations an official roster page carries.
 * A high-school value is stored only on a COLLEGE-AWARE page (one whose previous-school field names a
 * college for somebody): elsewhere it says nothing about a prior college and is not evidence.
 */
export function collectPageEvidence({ html, url, observedAt, rows, index }) {
  const parsed = extractRosterSchoolFields(html);
  if (parsed.structure.code !== 'OK') return { evidence: [], structure: parsed.structure.code };
  const byKey = new Map();
  for (const r of parsed.records) { const k = linkNameKey(r.player_name); if (k) byKey.set(k, byKey.has(k) ? null : r); }
  const aware = pageIsCollegeAware(parsed.records, index);
  const out = [];
  for (const row of rows) {
    const rec = byKey.get(linkNameKey(row.player_name));
    if (!rec?.raw_value || !rec.field_type || rec.field_type === FIELD_TYPE.HIGH_SCHOOL) continue;
    const parts = resolvePriorSchools(rec.raw_value, index);
    const strength = STRENGTH(parts);
    if (strength === 'STRUCTURED_HIGH_SCHOOL' && (!aware || rec.field_type !== FIELD_TYPE.PREVIOUS_SCHOOL)) continue;
    const progs = [...new Set(parts.filter((x) => x.kind === RESOLUTION.COLLEGE).flatMap((x) => x.programmes))].sort();
    out.push({ evidence_id: evidenceId(row.id, url, rec.field_type), observation_id: row.id, source_url: url, observed_at: observedAt || null,
      field_type: rec.field_type, raw_value: rec.raw_value, resolution: parts.map((x) => x.kind).join('+'), resolved_programmes: JSON.stringify(progs),
      resolved_entity: null, evidence_strength: strength, parser_version: EVIDENCE_PARSER, _parts: parts });
  }
  return { evidence: out, structure: 'OK' };
}

/** The explicit reading of stored evidence against one claimed prior programme. */
export function explicitFromEvidence(ev, { priorProgramme, destinationProgramme, index }) {
  if (!ev) return EXPLICIT.NONE;
  const parts = resolvePriorSchools(ev.raw_value, index).filter((x) => !(x.kind === RESOLUTION.COLLEGE && x.families.includes(index.familyOf(destinationProgramme))));
  const fam = priorProgramme ? index.familyOf(priorProgramme) : null;
  if (fam && parts.some((x) => (x.kind === RESOLUTION.COLLEGE || x.kind === RESOLUTION.AMBIGUOUS) && x.families.length === 1 && x.families[0] === fam)) return EXPLICIT.AGREES;
  const colleges = parts.filter((x) => x.kind === RESOLUTION.COLLEGE);
  const schoolish = parts.filter((x) => x.kind !== RESOLUTION.HIGH_SCHOOL && x.kind !== RESOLUTION.BLANK);
  if (colleges.length && colleges.length === schoolish.length) return EXPLICIT.NAMES_OTHER_COLLEGE;
  if (ev.evidence_strength === 'STRUCTURED_HIGH_SCHOOL') return EXPLICIT.HIGH_SCHOOL_ON_COLLEGE_AWARE_PAGE;
  return EXPLICIT.UNINFORMATIVE;
}

// ------------------------------------------------------------------ link building
/**
 * Links for every `season` row against the `source` season. Pure over the arrays given.
 * @param {object} p
 *   rows      every roster row of the sport(s) concerned (all seasons: commonness + earlier stops)
 *   evidence  player_prior_school_evidence rows for the season's observations
 *   indexFor  (sport) -> institution index
 * @returns {{ links, prior: Map<id, string|null>, stats }}
 */
export function buildSeasonLinks({ rows, evidence = [], indexFor, season, source, recordedAt, reviewed = new Map() }) {
  const S = String(season); const P = String(source);
  const at = new Map(); const nameProg = new Map(); const seasonProg = new Map(); const progSeason = new Set();
  for (const r of rows) {
    const k = linkNameKey(r.player_name); r._k = k; if (!k) continue;
    const a = `${r.season}|${r.sport}|${r.college_name}|${k}`; (at.get(a) || at.set(a, []).get(a)).push(r);
    const n = `${r.sport}|${k}`; (nameProg.get(n) || nameProg.set(n, new Set()).get(n)).add(r.college_name);
    const sp = `${r.season}|${r.sport}|${k}`; (seasonProg.get(sp) || seasonProg.set(sp, new Set()).get(sp)).add(r.college_name);
    progSeason.add(`${r.season}|${r.sport}|${r.college_name}`);
  }
  const evBy = new Map(); for (const e of evidence) if (!evBy.has(e.observation_id)) evBy.set(e.observation_id, e);
  const links = []; const prior = new Map(); const stats = { targets: 0, continuation: 0, cross_candidates: 0, explicit_only: 0 };
  const push = (l) => { links.push(l); return l; };
  const mk = (relation, t, fromProgramme, fromRow, d, signals, ev) => push({
    link_id: linkId(relation, t.id, fromProgramme), relation, to_observation_id: t.id, from_observation_id: fromRow?.id ?? null, sport: t.sport,
    to_programme: t.college_name, to_season: S, from_programme: fromProgramme, from_season: fromRow ? P : null, decision: d.decision, evidence_class: d.evidence_class,
    evidence_json: JSON.stringify({ signals: { ...signals, reviewed: undefined }, reasons: d.reasons }), evidence_id: ev?.evidence_id ?? null, method: LINK_METHOD, reviewed_at: null, reviewed_by: null, review_note: null, recorded_at: recordedAt });
  for (const t of rows) {
    if (String(t.season) !== S || !t._k) continue;
    stats.targets += 1;
    let idx = null;
    const indexReal = () => (idx ||= indexFor(t.sport));
    const own = at.get(`${P}|${t.sport}|${t.college_name}|${t._k}`) || [];
    const sig = (pr) => ({ hometown: compareHometown(pr.hometown, t.hometown), classStep: classStep(pr.class_year_label, t.class_year_label), position: positionCompat(pr.position, t.position) });
    if (own.length) {
      stats.continuation += 1;
      const s = { relation: RELATION.SAME_PROGRAMME_CONTINUATION, ...sig(own[0]), prior_rows: own.length, reviewed: reviewed.get(linkId(RELATION.SAME_PROGRAMME_CONTINUATION, t.id, t.college_name)) };
      const d = own.length > 1 && !s.reviewed ? { decision: LINK_DECISION.AMBIGUOUS, evidence_class: EVIDENCE_CLASS.NAME_ONLY, reasons: [`${own.length} same-name rows on the prior roster`] } : decideLink(s);
      const l = mk(RELATION.SAME_PROGRAMME_CONTINUATION, t, t.college_name, own[0], d, s, null);
      prior.set(t.id, isFactual(l.decision) ? t.college_name : null);
      continue;
    }
    const ev = evBy.get(t.id) || null;
    const cands = [...(seasonProg.get(`${P}|${t.sport}|${t._k}`) || [])].filter((p) => p !== t.college_name).sort();
    const factual = [];
    for (const c of cands) {
      stats.cross_candidates += 1;
      const pr = at.get(`${P}|${t.sport}|${c}|${t._k}`) || [];
      let explicit = ev ? explicitFromEvidence(ev, { priorProgramme: c, destinationProgramme: t.college_name, index: indexReal() }) : EXPLICIT.NONE;
      if (explicit === EXPLICIT.NAMES_OTHER_COLLEGE) {
        const named = JSON.parse(ev.resolved_programmes || '[]');
        if (named.some((n) => [1, 2, 3].some((b) => (at.get(`${Number(P) - b}|${t.sport}|${n}|${t._k}`) || []).length))) explicit = EXPLICIT.EARLIER_SCHOOL_ON_FILE;
      }
      const cont = at.get(`${S}|${t.sport}|${c}|${t._k}`) || [];
      const s = { relation: RELATION.CROSS_PROGRAMME_PRIOR, explicit, ...sig(pr[0]), prior_rows: pr.length, priorCandidates: cands.length,
        priorContinues: cont.length > 0, continuationHometown: cont.length ? compareHometown(pr[0].hometown, cont[0].hometown) : null,
        commonName: (nameProg.get(`${t.sport}|${t._k}`)?.size || 0) >= 3, height: 'UNKNOWN', reviewed: reviewed.get(linkId(RELATION.CROSS_PROGRAMME_PRIOR, t.id, c)) };
      const d = pr.length > 1 && !s.reviewed ? { decision: LINK_DECISION.AMBIGUOUS, evidence_class: EVIDENCE_CLASS.NAME_ONLY, reasons: [`${pr.length} same-name rows on ${c}'s prior roster`] } : decideLink(s);
      const l = mk(RELATION.CROSS_PROGRAMME_PRIOR, t, c, pr[0], d, s, explicit !== EXPLICIT.NONE ? ev : null);
      if (isFactual(l.decision)) factual.push(c);
    }
    if (factual.length === 1) { prior.set(t.id, factual[0]); continue; }
    if (factual.length > 1) { prior.set(t.id, null); continue; }   // two verified origins cannot both be true: none is factual
    // a structured previous college with no matching prior observation
    if (ev && ev.evidence_strength === 'STRUCTURED_COLLEGE') {
      const named = JSON.parse(ev.resolved_programmes || '[]').filter((n) => n !== t.college_name);
      const fams = new Set(named.map((n) => indexReal().familyOf(n)));
      if (named.length && fams.size === 1 && !cands.some((c) => fams.has(indexReal().familyOf(c)))) {
        stats.explicit_only += 1;
        const target = named[0];
        const onFile = named.some((n) => progSeason.has(`${P}|${t.sport}|${n}`));
        const rv = reviewed.get(linkId(RELATION.EXPLICIT_PRIOR_INSTITUTION, t.id, target));
        const d = rv ? decideLink({ reviewed: rv }) : onFile
          ? { decision: LINK_DECISION.PROBABLE_SAME_PERSON, evidence_class: EVIDENCE_CLASS.EXPLICIT_PRIOR_SCHOOL, reasons: [`the destination roster names ${target}, whose ${P} roster is on file without this name — an earlier stop or a stale bio`] }
          : { decision: LINK_DECISION.VERIFIED_SAME_PERSON, evidence_class: EVIDENCE_CLASS.EXPLICIT_PRIOR_SCHOOL, reasons: [`the destination roster names ${target} as the previous school; no ${P} roster for it is on file to contradict`] };
        const l = mk(RELATION.EXPLICIT_PRIOR_INSTITUTION, t, target, null, d, { relation: RELATION.EXPLICIT_PRIOR_INSTITUTION, explicit: 'STATED', prior_roster_on_file: onFile, cross_candidates: cands.length }, ev);
        prior.set(t.id, isFactual(l.decision) ? target : null);
        continue;
      }
    }
    prior.set(t.id, null);
  }
  return { links, prior, stats };
}

/** Load everything buildSeasonLinks needs from a DB handle. */
export function loadLinkInputs(db, { season }) {
  const rows = db.prepare('SELECT id, college_name, sport, season, player_name, hometown, class_year_label, position FROM roster_players').all();
  const hasEv = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='player_prior_school_evidence'").get();
  const evidence = hasEv ? db.prepare('SELECT e.* FROM player_prior_school_evidence e JOIN roster_players r ON r.id = e.observation_id WHERE r.season = ?').all(String(season)) : [];
  const memo = new Map();
  const hasColleges = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='colleges'").get();
  const empty = { strict: new Map(), loose: new Map(), base: new Map(), family: new Map(), familyOf: (n) => String(n) };
  const indexFor = (sport) => (hasColleges ? memo.get(sport) || memo.set(sport, buildInstitutionIndex(db, sport)).get(sport) : empty);
  return { rows, evidence, indexFor };
}
