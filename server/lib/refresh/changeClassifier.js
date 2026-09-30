/**
 * CHANGE CLASSIFICATION — Phase 7E. Every refresh observation becomes exactly one of:
 *
 *   CONFIRMED_UNCHANGED      the source agrees with what we hold (evidence is refreshed)
 *   NEW_RECORD               not held yet, established by an authoritative source
 *   VERIFIED_UPDATE          held, differs, and the source is authoritative for the change
 *   POSSIBLE_CHANGE          differs, but the source cannot establish the change alone
 *   CONTRADICTION            the evidence disagrees with itself or with trusted state
 *   STALE_CANDIDATE          held as current, gone, AND corroborated (named replacement)
 *   IDENTITY_AMBIGUOUS       institution/programme/person identity not resolved
 *   SOURCE_UNTRUSTED         the source may not establish this (tier, host, frozen season)
 *   DISAPPEARED_FROM_SOURCE  held, absent from a complete source — an INVESTIGATION,
 *                            never a deletion
 *
 * Input is one gathered PAGE (a staff page, a roster page, a membership record, a host
 * observation); output is one staged observation per record on it plus one per held record
 * the page should have listed and did not. Pure: nothing here writes.
 */
import { classifySource, mayEstablish } from './sourceAuthority.js';
import { authorizeAction } from './destructivePolicy.js';
import { planTransition, openPeriod } from './temporal.js';
import { SHARED_PLATFORM_ROOT } from './identityResolver.js';
import { hostOf } from '../athleticsEntity.js';
import { normaliseInstitution } from '../../../shared/institutionIdentity.js';
import { classRank } from '../../../shared/lifecycle/lifecycle.js';

export const CLASSIFICATIONS = Object.freeze(['CONFIRMED_UNCHANGED', 'NEW_RECORD', 'VERIFIED_UPDATE', 'POSSIBLE_CHANGE',
  'CONTRADICTION', 'STALE_CANDIDATE', 'IDENTITY_AMBIGUOUS', 'SOURCE_UNTRUSTED', 'DISAPPEARED_FROM_SOURCE']);
/** Classifications whose proposed action may ever reach a canonical table. */
export const PROMOTABLE = new Set(['CONFIRMED_UNCHANGED', 'NEW_RECORD', 'VERIFIED_UPDATE', 'STALE_CANDIDATE']);

export const personKey = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
/**
 * A FORMAT-INSENSITIVE key (Phase 8B.1): the sorted letters of a name, so "Smith, John" /
 * "John Smith" and "O'Neil" / "ONeil" collide. Used ONLY to stop an insert (a possible false
 * duplicate of a held player-season) — never to link or merge two rows.
 */
export const nameFormatKey = (s) => personKey(s).replace(/[^a-z]/g, '').split('').sort().join('');
const lc = (s) => String(s || '').trim().toLowerCase();
export const isGenericEmail = (e) => /^(soccer|msoc|wsoc|athletics|info|sports?info|sid|coach|coaches|wsoccer|msoccer|office|admin|menssoccer|womenssoccer|recruit|recruiting)@/i.test(String(e || ''));
const NON_PLAYER = /\b(coach|coaches|manager|trainer|staff|director|coordinator|analyst|operations|student assistant|volunteer)\b/i;
const HEAD = /\bhead coach\b/i;

function srcCtx(ctx, entityId, season) {
  return { ownsHost: (h) => ctx.resolver.hostOwnedBy(h, entityId), conferenceHosts: ctx.conferenceHosts, currentSeason: season };
}
/** colleges rows (names) that carry or link to a programme row. */
function programmeNames(ctx, collegeId) {
  const ids = new Set([collegeId, ...ctx.rowLinks.filter((l) => l.canonical_college_id === collegeId).map((l) => l.college_id)]);
  return ctx.colleges.filter((c) => ids.has(c.id));
}

function base(page, dataset, res, src, extra = {}) {
  return {
    dataset, source_url: page.source_url ?? null, source_host: hostOf(page.source_url), source_kind: page.source_kind ?? null,
    source_tier: src?.tier ?? null, fetched_at: page.fetched_at ?? null, observed_season: page.observed_season ?? null,
    parser_version: page.parser_version ?? null, raw_name: page.institution_label ?? null,
    normalized_name: normaliseInstitution(page.institution_label) || null,
    candidate_entity_id: res?.entity_id ?? null, candidate_college_id: res?.college_id ?? null,
    resolution_method: res?.method ?? null, resolution_decision: res?.decision ?? null, confidence: res?.confidence ?? null,
    requires_review: 0, ...extra,
  };
}
const obs = (b, classification, action, fields) => ({ ...b, classification, proposed_action: action ?? null, ...fields });
/**
 * The name a NEW record is filed under. A programme can own two spellings (programme_row_links
 * SAME_PROGRAMME_ALT_NAME: coaches on one, rosters on the other); a new record joins the
 * spelling its own kind of record already uses, so a refresh never splits a programme
 * further. Falls back to the carrier row's name.
 */
function receiverName(heldNames, carrierName) {
  const n = new Map(); for (const x of heldNames) n.set(x, (n.get(x) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || carrierName;
}

/** Sport a Sidearm/Presto-style URL path names, or null. */
export function sportOfUrl(url) {
  const p = String(url || '').toLowerCase().replace(/^https?:\/\/[^/]+/, '');
  if (/(\/|^)(womens-soccer|wsoc|w-soccer|wsoccer|women-soccer)(\/|$|\?)/.test(p)) return 'womens-soccer';
  if (/(\/|^)(mens-soccer|msoc|m-soccer|msoccer|men-soccer)(\/|$|\?)/.test(p)) return 'mens-soccer';
  return null;
}

/** Page-level gate shared by COACH and ROSTER: identity, programme, ownership, tier, sport. */
function pageGate(page, ctx, season, field) {
  const res = ctx.resolver.resolve({ athletics_entity_id: page.athletics_entity_id, source_url: page.source_url, raw_name: page.institution_label, sport: page.sport, unitid: page.unitid });
  const urlSport = sportOfUrl(page.source_url);
  if (urlSport && page.sport && urlSport !== page.sport) return { res, src: { tier: 'D', reasons: [] }, stop: 'CONTRADICTION', why: [`wrong-sport source: the page is a ${urlSport} page, staged for ${page.sport}`] };
  const src = res.entity_id ? classifySource({ url: page.source_url, kind: page.source_kind, observedSeason: page.observed_season, pageSeason: page.page_season }, srcCtx(ctx, res.entity_id, season)) : classifySource({ url: page.source_url, kind: page.source_kind }, {});
  const why = [];
  if (res.decision !== 'RESOLVED') return { res, src, stop: res.method === 'CONTRADICTION' ? 'CONTRADICTION' : 'IDENTITY_AMBIGUOUS', why: [...(res.contradictions || []), ...(res.candidates || []).map((c) => `candidate ${c.name} (${Math.round(c.confidence * 100)}%)`)] };
  if (!res.college_id) return { res, src, stop: 'IDENTITY_AMBIGUOUS', why: [`entity ${res.entity_id} has no single active ${page.sport} programme (${res.programme_reason})`] };
  if (res.name_only) why.push('identity by programme name only — the source host did not establish it');
  const ok = mayEstablish(field, src);
  if (!ok.ok || res.name_only) return { res, src, stop: 'SOURCE_UNTRUSTED', why: [...why, ...(src.reasons || []), ok.reason].filter(Boolean) };
  return { res, src, stop: null, why: src.reasons || [] };
}

// ---------------------------------------------------------------------------- COACH
/**
 * page: { dataset:'COACH', source_url, source_kind, fetched_at, observed_season, institution_label,
 *         sport, athletics_entity_id?, unitid?, source_complete, emails_on_page?[],
 *         people:[{ full_name, role, email, email_origin: 'PUBLISHED_ON_SOURCE'|'INFERRED'|'NONE' }] }
 * ctx.coaches: coaches rows (all)
 */
export function classifyCoachPage(page, ctx, { season, now }) {
  const out = [];
  const g = pageGate(page, ctx, season, 'coach_current');
  const people = page.people || [];
  if (g.stop) {
    for (const p of people) out.push(obs(base(page, 'COACH', g.res, g.src, { evidence_json: { why: g.why, person: p.full_name } }), g.stop, null, { target_table: 'coaches', target_key: `${page.institution_label}|${page.sport}|${personKey(p.full_name)}` }));
    return out;
  }
  const programme = ctx.colleges.find((c) => c.id === g.res.college_id);
  const names = new Set(programmeNames(ctx, programme.id).map((c) => c.name));
  const held = ctx.coaches.filter((c) => names.has(c.school) && c.sport === page.sport);
  const heldBy = new Map();
  for (const c of held) { const k = personKey(c.full_name); if (!k) continue; (heldBy.get(k) || heldBy.set(k, []).get(k)).push(c); }
  const pageEmails = new Set([...(page.emails_on_page || []), ...people.map((p) => (p.email_origin === 'PUBLISHED_ON_SOURCE' ? p.email : null))].filter(Boolean).map(lc));
  const seen = new Set(); const nowIso = (now || new Date()).toISOString();
  const evidenceFields = { currentness_status: 'CURRENT', currentness_checked_at: page.fetched_at || nowIso, currentness_source_url: page.source_url };
  const newHeads = people.filter((p) => HEAD.test(p.role || '') && !heldBy.has(personKey(p.full_name)));
  const coachSchool = receiverName(held.map((c) => c.school), programme.name);

  for (const p of people) {
    const k = personKey(p.full_name);
    const b = base(page, 'COACH', g.res, g.src, { target_table: 'coaches' });
    const published = p.email_origin === 'PUBLISHED_ON_SOURCE' && p.email && !isGenericEmail(p.email) ? lc(p.email) : null;
    const notes = [];
    if (p.email && p.email_origin !== 'PUBLISHED_ON_SOURCE') notes.push(`email discarded: origin ${p.email_origin || 'unstated'} — only an address published on the page is ever staged`);
    if (p.email && isGenericEmail(p.email)) notes.push('generic inbox is not a personal address');
    if (!k) { out.push(obs({ ...b, target_key: `${programme.id}|?` }, 'IDENTITY_AMBIGUOUS', null, { evidence_json: { why: ['no person name'] } })); continue; }
    const matches = heldBy.get(k) || [];
    const carrier = matches.filter((m) => m.school === programme.name);
    const cur = carrier.length === 1 ? carrier[0] : (matches.length === 1 ? matches[0] : null);
    if (matches.length > 1 && !cur) { out.push(obs({ ...b, target_key: `${programme.id}|${k}` }, 'IDENTITY_AMBIGUOUS', null, { evidence_json: { why: [`${matches.length} held rows for this name at this programme`], notes } })); continue; }
    if (published) {
      const entityOfSchool = (school, sport) => ctx.colleges.find((c) => c.name === school && c.sport === sport)?.athletics_entity_id || null;
      const others = ctx.coaches.filter((c) => lc(c.email) === published && !(names.has(c.school) && c.sport === page.sport));
      const foreign = others.find((c) => entityOfSchool(c.school, c.sport) !== programme.athletics_entity_id);
      if (foreign) { out.push(obs({ ...b, target_key: `${programme.id}|${k}` }, 'CONTRADICTION', null, { evidence_json: { why: [`address is already held at another institution: ${foreign.school} [${foreign.sport}]`], notes } })); continue; }
      if (others.length) notes.push(`same address held for this institution's ${[...new Set(others.map((c) => c.sport))].join(', ')} programme (one person coaching both)`);
    }
    if (!cur) {
      const elsewhere = ctx.coaches.filter((c) => personKey(c.full_name) === k && c.sport === page.sport && !names.has(c.school)).map((c) => c.school);
      if (elsewhere.length) notes.push(`same name held at ${[...new Set(elsewhere)].join(', ')} — a move is a NEW row here; the old row changes only through its own programme's refresh`);
      const row = { full_name: p.full_name, school: coachSchool, division: programme.division, sport: page.sport, position_title: p.role || null, ...evidenceFields,
        email: published, email_status: published ? 'verified' : 'unknown', email_source_url: published ? page.source_url : null,
        email_seen_on_source_at: published ? (page.fetched_at || nowIso) : null, email_seen_on_source_url: published ? page.source_url : null, source: `refresh:${page.parser_version || 'unversioned'}` };
      out.push(obs({ ...b, target_key: `${programme.id}|${k}` }, 'NEW_RECORD', 'CREATE_COACH', { proposed_json: row, expected_old_json: { absent: true, school: coachSchool, school_names: [...names].sort(), sport: page.sport, name_key: k }, evidence_json: { notes } }));
      continue;
    }
    seen.add(cur.id);
    const upd = { ...evidenceFields }; const exp = { id: cur.id, school: cur.school, email: cur.email ?? null, email_status: cur.email_status ?? null, currentness_status: cur.currentness_status ?? null, position_title: cur.position_title ?? null };
    let cls = 'CONFIRMED_UNCHANGED'; let action = 'REFRESH_COACH_EVIDENCE'; let review = 0;
    if (cur.currentness_status === 'PROVEN_STALE') { cls = 'VERIFIED_UPDATE'; action = 'REINSTATE_COACH'; review = 1; notes.push('held as PROVEN_STALE, observed again on the current official page'); }
    if (p.role && lc(p.role) !== lc(cur.position_title)) { upd.position_title = p.role; if (cls === 'CONFIRMED_UNCHANGED') { cls = 'VERIFIED_UPDATE'; action = 'UPDATE_COACH_ROLE'; } }
    if (published && lc(cur.email) === published) {
      if (cur.email_status === 'verified') { upd.email_seen_on_source_at = page.fetched_at || nowIso; upd.email_seen_on_source_url = page.source_url; }
      else { upd.email_status = 'verified'; upd.email_source_url = page.source_url; upd.email_seen_on_source_at = page.fetched_at || nowIso; upd.email_seen_on_source_url = page.source_url; cls = 'VERIFIED_UPDATE'; action = 'CONFIRM_OBSERVED_EMAIL'; notes.push(`held address (${cur.email_status}) is now published on the official page`); }
    } else if (published && cur.email && lc(cur.email) !== published) {
      const auth = authorizeAction('REPLACE_VERIFIED_EMAIL', { source_tier_A: g.src.tier === 'A', source_owned_by_programme_entity: true, same_person_evidence: true, new_email_published: true, old_email_absent: !pageEmails.has(lc(cur.email)) });
      if (!auth.allowed) { out.push(obs({ ...b, target_key: cur.id }, 'POSSIBLE_CHANGE', 'REPLACE_VERIFIED_EMAIL', { requires_review: 1, proposed_json: { email: published }, expected_old_json: exp, evidence_json: { why: auth.missing, notes } })); continue; }
      Object.assign(upd, { email: published, email_status: 'verified', email_source_url: page.source_url, email_seen_on_source_at: page.fetched_at || nowIso, email_seen_on_source_url: page.source_url });
      cls = 'VERIFIED_UPDATE'; action = 'REPLACE_VERIFIED_EMAIL'; review = 1; notes.push('same name on the same programme page with a different published address; the old address is no longer on the page');
    } else if (published && !cur.email) {
      Object.assign(upd, { email: published, email_status: 'verified', email_source_url: page.source_url, email_seen_on_source_at: page.fetched_at || nowIso, email_seen_on_source_url: page.source_url });
      cls = 'VERIFIED_UPDATE'; action = 'ADD_PUBLISHED_EMAIL';
    } else if (cur.email && cur.email_status === 'verified') notes.push('person present; stored address not published on this page — email_seen not refreshed');
    out.push(obs({ ...b, target_key: cur.id }, cls, action, { requires_review: review, proposed_json: upd, expected_old_json: exp, evidence_json: { notes } }));
  }
  if (page.source_complete) {
    for (const c of held) {
      if (seen.has(c.id) || c.currentness_status === 'PROVEN_STALE') continue;
      const b = base(page, 'COACH', g.res, g.src, { target_table: 'coaches', target_key: c.id });
      const replaced = HEAD.test(c.position_title || '') && newHeads.length > 0;
      if (replaced) {
        const auth = authorizeAction('MARK_PROVEN_STALE', { source_tier_A: g.src.tier === 'A', second_source_or_named_replacement: true });
        out.push(obs(b, 'STALE_CANDIDATE', 'MARK_PROVEN_STALE', { requires_review: 1, proposed_json: { currentness_status: 'PROVEN_STALE', currentness_checked_at: page.fetched_at || nowIso, currentness_source_url: page.source_url, currentness_reason: `[refresh] absent from the official staff page; named replacement in the role: ${newHeads.map((h) => h.full_name).join(', ')}` }, expected_old_json: { id: c.id, school: c.school, currentness_status: c.currentness_status ?? null }, evidence_json: { why: auth.missing } }));
      } else {
        out.push(obs(b, 'DISAPPEARED_FROM_SOURCE', 'INVESTIGATE_CURRENTNESS', { requires_review: 1, expected_old_json: { id: c.id, school: c.school }, evidence_json: { why: ['absent from a complete official staff page; single-source absence is not proof of departure — needs a second source or a named replacement'] } }));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------- ROSTER
/**
 * page: { dataset:'ROSTER', source_url, source_kind:'OFFICIAL_ROSTER', page_season, observed_season,
 *         institution_label, sport, source_complete, players:[{player_name, class_year_label, position, nationality, hometown}] }
 * ctx.roster: roster rows for the programme's names (any season)
 */
const ROSTER_FIELDS = ['class_year_label', 'position', 'nationality', 'hometown'];
export function classifyRosterPage(page, ctx, { season, frozen = new Set() }) {
  const out = []; const players = page.players || [];
  const tSeason = Number(page.observed_season);
  const field = tSeason >= Number(season) ? 'roster_current' : 'roster_history';
  const g = pageGate(page, ctx, season, field);
  const key = (p) => personKey(p.player_name);
  const stopAll = (cls, why) => players.map((p) => obs(base(page, 'ROSTER', g.res, g.src, { target_table: 'roster_players', target_key: `${g.res.college_id || page.institution_label}|${tSeason}|${key(p)}`, evidence_json: { why } }), cls, null, {}));
  if (page.page_season != null && Number(page.page_season) !== tSeason) return stopAll('CONTRADICTION', [`page is the ${page.page_season} roster, claimed as ${tSeason} — an old roster is never the current one`]);
  if (g.stop && !(g.stop === 'SOURCE_UNTRUSTED' && field === 'roster_history' && g.src.tier === 'C' && !g.res.name_only)) return stopAll(g.stop, g.why);
  if (frozen.has(tSeason)) return stopAll('SOURCE_UNTRUSTED', [`season ${tSeason} is frozen: history is read-only to a refresh`]);
  const programme = ctx.colleges.find((c) => c.id === g.res.college_id);
  const names = programmeNames(ctx, programme.id).map((c) => c.name);
  const rows = (ctx.roster || []).filter((r) => names.includes(r.college_name) && r.sport === page.sport);
  const heldThis = rows.filter((r) => Number(r.season) === tSeason);
  const heldPrev = rows.filter((r) => Number(r.season) === tSeason - 1);
  const byKey = (list) => { const m = new Map(); for (const r of list) { const k = personKey(r.player_name); (m.get(k) || m.set(k, []).get(k)).push(r); } return m; };
  const thisBy = byKey(heldThis); const prevBy = byKey(heldPrev);
  const otherCur = byKey((ctx.roster || []).filter((r) => !names.includes(r.college_name) && r.sport === page.sport && Number(r.season) === tSeason));
  const otherPrev = byKey((ctx.roster || []).filter((r) => !names.includes(r.college_name) && r.sport === page.sport && Number(r.season) === tSeason - 1));
  const rosterName = receiverName([...heldThis, ...heldPrev].map((r) => r.college_name), programme.name);
  const pageCount = new Map(); for (const p of players) pageCount.set(key(p), (pageCount.get(key(p)) || 0) + 1);
  const seen = new Set();
  for (const p of players) {
    const k = key(p);
    const b = base(page, 'ROSTER', g.res, g.src, { target_table: 'roster_players', target_key: `${programme.id}|${tSeason}|${k}` });
    if (!k || NON_PLAYER.test(p.position || '') || NON_PLAYER.test(p.player_name || '')) { out.push(obs(b, 'SOURCE_UNTRUSTED', null, { evidence_json: { why: ['not a player (staff/manager row or no name)'] } })); continue; }
    if (pageCount.get(k) > 1) { out.push(obs(b, 'IDENTITY_AMBIGUOUS', null, { evidence_json: { why: ['name appears more than once on this roster'] } })); continue; }
    const held = thisBy.get(k) || [];
    if (held.length > 1) { out.push(obs(b, 'IDENTITY_AMBIGUOUS', null, { evidence_json: { why: [`${held.length} held rows for this player-season (duplicate)`] } })); continue; }
    if (!held.length) {
      // same player-season under another name format (reversed / punctuation): never insert a second row
      const fk = nameFormatKey(p.player_name); const alt = heldThis.filter((r) => nameFormatKey(r.player_name) === fk && personKey(r.player_name) !== k);
      if (alt.length) { out.push(obs(b, 'IDENTITY_AMBIGUOUS', null, { requires_review: 1, expected_old_json: { ids: alt.map((r) => r.id) }, evidence_json: { why: [`a held ${tSeason} row carries the same letters under another name format — possible duplicate of a held player-season; not inserted, not merged`] } })); for (const r of alt) seen.add(r.id); continue; }
    }
    const notes = [];
    if (held.length === 1) {
      const h = held[0]; seen.add(h.id);
      const fill = {}; const differs = [];
      for (const f of ROSTER_FIELDS) {
        const nv = p[f] ?? null; const ov = h[f] ?? null;
        if (nv == null || nv === '') continue;
        if (ov == null || ov === '') fill[f] = nv; else if (String(ov).trim() !== String(nv).trim()) differs.push(`${f}: held "${ov}", source "${nv}"`);
      }
      const exp = { id: h.id, ...Object.fromEntries(ROSTER_FIELDS.map((f) => [f, h[f] ?? null])) };
      if (differs.length) out.push(obs(b, 'POSSIBLE_CHANGE', 'REVIEW_ROSTER_FIELDS', { requires_review: 1, proposed_json: Object.fromEntries(ROSTER_FIELDS.filter((f) => p[f] != null).map((f) => [f, p[f]])), expected_old_json: exp, evidence_json: { why: ['a held value is never overwritten by a refresh', ...differs] } }));
      else if (Object.keys(fill).length) out.push(obs(b, 'VERIFIED_UPDATE', 'FILL_ROSTER_FIELDS', { proposed_json: fill, expected_old_json: exp, evidence_json: { notes: ['fills empty fields only'] } }));
      else out.push(obs(b, 'CONFIRMED_UNCHANGED', null, { expected_old_json: exp }));
      continue;
    }
    // new player-season
    const prev = prevBy.get(k) || [];
    let cls = 'NEW_RECORD'; let review = 0;
    if (prev.length === 1) {
      const a = classRank(prev[0].class_year_label); const z = classRank(p.class_year_label);
      if (a != null && z != null && z < a) { cls = 'IDENTITY_AMBIGUOUS'; notes.push(`same name on the ${tSeason - 1} roster as ${prev[0].class_year_label}, now ${p.class_year_label} — a class cannot go backwards; same-name collision or data error`); }
      else {
        notes.push('continuation of the prior-season roster (same programme, same name)');
        if (p.position && prev[0].position && String(p.position).trim() !== String(prev[0].position).trim()) notes.push(`CHANGED_POSITION ${prev[0].position} -> ${p.position} (a new season row; the ${tSeason - 1} row is untouched)`);
        if (a != null && z != null && z === a && !/r|red/i.test(String(p.class_year_label))) notes.push(`CHANGED_CLASS none: still ${p.class_year_label} (redshirt or data lag?)`);
      }
    }
    if ((otherPrev.get(k) || []).length && !prev.length) notes.push(`TRANSFER CANDIDATE: same name on ${[...new Set(otherPrev.get(k).map((r) => r.college_name))].join(', ')} ${tSeason - 1} — not linked automatically`);
    if ((otherCur.get(k) || []).length) { review = 1; notes.push(`same name on another ${tSeason} roster: ${[...new Set(otherCur.get(k).map((r) => r.college_name))].join(', ')}`); }
    const row = { college_name: rosterName, sport: page.sport, division: programme.division, season: String(tSeason), conference: programme.conference ?? null, player_name: p.player_name,
      class_year_label: p.class_year_label ?? null, position: p.position ?? null, nationality: p.nationality ?? null, hometown: p.hometown ?? null,
      source_roster_url: page.source_url, source_page_season: page.page_season ?? tSeason, source_fetched_at: page.fetched_at ?? null, source_parser: page.parser_version ?? null, data_confidence: 'High' };
    out.push(obs(b, cls, cls === 'NEW_RECORD' ? 'INSERT_ROSTER_ROW' : null, { requires_review: review, proposed_json: row, expected_old_json: { absent: true, college_names: names, sport: page.sport, season: String(tSeason), name_key: k }, evidence_json: { notes } }));
  }
  if (page.source_complete) {
    for (const h of heldThis) if (!seen.has(h.id)) out.push(obs(base(page, 'ROSTER', g.res, g.src, { target_table: 'roster_players', target_key: h.id }), 'DISAPPEARED_FROM_SOURCE', null, { evidence_json: { why: ['held for this season, absent from the complete official roster — kept; roster membership is never deleted by a refresh'] } }));
    // prior-season players not on the complete current page: NOT_OBSERVED_CURRENT_SEASON (informational).
    // The prior observation is history and stays; absence alone is not departure (graduation, transfer,
    // redshirt off the page, or a name-format change are all possible). No action, no review.
    const onPage = new Set(players.map((p) => key(p))); const onPageFmt = new Set(players.map((p) => nameFormatKey(p.player_name)));
    for (const h of heldPrev) {
      const hk = personKey(h.player_name); if (!hk || onPage.has(hk)) continue;
      const formatOnly = onPageFmt.has(nameFormatKey(h.player_name));
      out.push(obs(base(page, 'ROSTER', g.res, g.src, { target_table: 'roster_players', target_key: h.id }), 'DISAPPEARED_FROM_SOURCE', null, { evidence_json: { status: 'NOT_OBSERVED_CURRENT_SEASON', why: [`on the ${tSeason - 1} roster, not on the complete ${tSeason} roster${formatOnly ? ' under the same name format (a differently formatted name with the same letters IS on the page)' : ''} — the ${tSeason - 1} observation is kept; absence is not departure evidence by itself`] } }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------- PROGRAMME
/**
 * page: { dataset:'PROGRAMME', institution_label, sport, athletics_entity_id?, unitid?, season,
 *         division, conference, membership_status, postseason_eligible, programme_status:'ACTIVE'|'DISCONTINUED',
 *         review_due_season?, sources:[{url, kind}] }
 */
export function classifyProgrammeObservation(page, ctx, { season }) {
  const res = ctx.resolver.resolve({ athletics_entity_id: page.athletics_entity_id, source_url: null, raw_name: page.institution_label, sport: page.sport, unitid: page.unitid });
  const eff = Number(page.season ?? season);
  const srcs = (page.sources || []).map((s) => classifySource({ url: s.url, kind: s.kind }, srcCtx(ctx, res.entity_id, null)));
  const b = base({ ...page, source_url: page.sources?.[0]?.url, source_kind: page.sources?.[0]?.kind, observed_season: eff }, 'PROGRAMME', res, srcs[0], { target_table: 'programme_membership_periods', target_key: `${res.entity_id || page.institution_label}|${page.sport}` });
  b.source_tier = srcs.map((s) => s.tier).sort()[0] || null;
  const evidence = { sources: srcs.map((s) => ({ host: s.host, kind: s.kind, tier: s.tier, reasons: s.reasons })) };
  if (res.decision !== 'RESOLVED') return [obs(b, res.method === 'CONTRADICTION' ? 'CONTRADICTION' : 'IDENTITY_AMBIGUOUS', null, { evidence_json: { ...evidence, why: res.contradictions } })];
  const carrier = res.college_id ? ctx.colleges.find((c) => c.id === res.college_id) : null;
  const open = openPeriod(ctx.periods, res.entity_id, page.sport);
  const current = open ? { division: open.division, conference: open.conference, membership_status: open.membership_status, postseason_eligible: open.postseason_eligible }
    : carrier ? { division: carrier.division, conference: carrier.conference, membership_status: 'ACTIVE', postseason_eligible: null } : null;
  const reviewName = res.name_only ? ['identity by programme name only'] : [];
  if (page.programme_status === 'DISCONTINUED') {
    if (!carrier) return [obs(b, 'CONFIRMED_UNCHANGED', null, { evidence_json: { ...evidence, notes: ['no active programme held'] } })];
    const auth = authorizeAction('DEACTIVATE_PROGRAMME', { programme_status_authority: mayEstablish('programme_status', srcs).ok });
    const plan = planTransition(ctx.periods, { athletics_entity_id: res.entity_id, sport: page.sport, season: eff, division: current.division, conference: current.conference, membership_status: 'DISCONTINUED', postseason_eligible: 0, college_id: carrier.id, source_url: page.sources?.[0]?.url, source_tier: b.source_tier, provenance: 'refresh: programme discontinued' });
    const cls = auth.allowed && !plan.problems.length ? 'VERIFIED_UPDATE' : 'POSSIBLE_CHANGE';
    return [obs({ ...b, target_key: carrier.id }, cls, 'DEACTIVATE_PROGRAMME', { requires_review: 1, proposed_json: { period_ops: plan.ops, college: { id: carrier.id, active: 0 } }, expected_old_json: { id: carrier.id, active: 1, division: carrier.division }, evidence_json: { ...evidence, why: [...auth.missing, ...plan.problems, ...reviewName] } })];
  }
  if (!carrier) {
    const auth = authorizeAction('CREATE_PROGRAMME', { programme_status_authority: mayEstablish('programme_status', srcs).ok, entity_resolved: true });
    return [obs(b, auth.allowed ? 'NEW_RECORD' : 'POSSIBLE_CHANGE', 'CREATE_PROGRAMME', { requires_review: 1, proposed_json: { entity: res.entity_id, sport: page.sport, name: page.institution_label, division: page.division, conference: page.conference, first_season: eff, membership_status: page.membership_status || 'ACTIVE', postseason_eligible: page.postseason_eligible ?? null }, expected_old_json: { absent: true, entity: res.entity_id, sport: page.sport }, evidence_json: { ...evidence, why: auth.missing } })];
  }
  const change = { athletics_entity_id: res.entity_id, sport: page.sport, season: eff, division: page.division ?? current.division, conference: page.conference ?? current.conference, membership_status: page.membership_status || 'ACTIVE', postseason_eligible: page.postseason_eligible ?? current.postseason_eligible ?? null, college_id: carrier.id, source_url: page.sources?.[0]?.url, source_tier: b.source_tier, provenance: 'refresh: membership observation', review_due_season: page.review_due_season ?? null };
  const divChanged = change.division !== current.division;
  const confChanged = (change.conference || null) !== (current.conference || null);
  const statusChanged = change.membership_status !== current.membership_status || (page.postseason_eligible != null && page.postseason_eligible !== current.postseason_eligible);
  if (!divChanged && !confChanged && !statusChanged) return [obs({ ...b, target_key: carrier.id }, 'CONFIRMED_UNCHANGED', null, { evidence_json: evidence })];
  const plan = planTransition(open ? ctx.periods : [], change);
  const field = divChanged || statusChanged ? 'division' : 'conference';
  const est = mayEstablish(field, srcs);
  const action = divChanged ? 'CHANGE_DIVISION' : statusChanged ? 'CHANGE_MEMBERSHIP_STATUS' : 'CHANGE_CONFERENCE';
  const auth = divChanged || statusChanged ? authorizeAction('CHANGE_DIVISION', { division_authority: est.ok, effective_season: true, no_history_rewrite: !plan.problems.length }) : { allowed: est.ok, requires_review: false, missing: est.ok ? [] : [est.reason] };
  if (plan.problems.length) return [obs({ ...b, target_key: carrier.id }, 'CONTRADICTION', action, { requires_review: 1, evidence_json: { ...evidence, why: plan.problems } })];
  const cls = auth.allowed && !res.name_only ? 'VERIFIED_UPDATE' : 'POSSIBLE_CHANGE';
  return [obs({ ...b, target_key: carrier.id }, cls, action, { requires_review: auth.requires_review || res.name_only ? 1 : 0, proposed_json: { period_ops: plan.ops, college: { id: carrier.id, division: change.division, conference: change.conference } }, expected_old_json: { id: carrier.id, division: carrier.division, conference: carrier.conference ?? null, open_period: open ? { first_season: open.first_season, last_season: null } : null }, evidence_json: { ...evidence, current, observed: { division: change.division, conference: change.conference, membership_status: change.membership_status }, why: [...auth.missing, ...reviewName] } })];
}

/** A complete official membership listing: held programmes it omits are DISAPPEARED (investigate). */
export function classifyMembershipListing(listing, ctx) {
  const listed = new Set();
  for (const m of listing.members || []) { const r = ctx.resolver.resolve({ raw_name: m.institution_label, sport: listing.sport, athletics_entity_id: m.athletics_entity_id, unitid: m.unitid }); if (r.entity_id) listed.add(r.entity_id); }
  return ctx.colleges.filter((c) => c.active === 1 && c.division === listing.division && c.sport === listing.sport && c.athletics_entity_id && !listed.has(c.athletics_entity_id) && !ctx.rowLinks.some((l) => l.college_id === c.id))
    .map((c) => ({ dataset: 'PROGRAMME', source_url: listing.source_url, source_host: hostOf(listing.source_url), source_kind: 'OFFICIAL_MEMBERSHIP', source_tier: 'A', observed_season: listing.season, raw_name: c.name, normalized_name: normaliseInstitution(c.name), candidate_entity_id: c.athletics_entity_id, candidate_college_id: c.id, resolution_method: 'HELD_PROGRAMME', resolution_decision: 'RESOLVED', confidence: 1, target_table: 'programme_membership_periods', target_key: c.id, classification: 'DISAPPEARED_FROM_SOURCE', proposed_action: 'INVESTIGATE_MEMBERSHIP', requires_review: 1, evidence_json: { why: [`not on the ${listing.season} ${listing.division} ${listing.sport} membership listing — investigate (transition, discontinuation, or listing gap); nothing is deactivated automatically`] } }));
}

// ---------------------------------------------------------------------------- DOMAIN
/** Candidate names an entity is known by (programme names, aliases, display name), normalised. */
function entityNames(ctx, entityId) {
  const e = ctx.entities.find((x) => x.athletics_entity_id === entityId);
  const us = new Set([e?.federal_unitid].filter((u) => u != null).map(Number));
  const names = [e?.display_name, ...ctx.colleges.filter((c) => c.athletics_entity_id === entityId).map((c) => c.name),
    ...ctx.aliases.filter((a) => a.athletics_entity_id === entityId || (us.has(Number(a.unitid)) && !a.athletics_entity_id)).map((a) => a.alias_raw)];
  return [...new Set(names.filter(Boolean).map((n) => normaliseInstitution(n.replace(/\(.*?\)/g, ' ')).trim()).filter((n) => n.length >= 4))];
}
/** Does the page's self-identification name this entity — and no longer-named other entity? */
export function selfIdentifies(ctx, entityId, text) {
  const t = ` ${normaliseInstitution(text)} `;
  const best = (id) => Math.max(0, ...entityNames(ctx, id).filter((n) => t.includes(` ${n} `)).map((n) => n.split(' ').length));
  const mine = best(entityId);
  if (!mine) return { ok: false, why: 'page does not name this institution' };
  const rivals = [...new Set(ctx.colleges.map((c) => c.athletics_entity_id).filter((id) => id && id !== entityId))].filter((id) => best(id) >= mine && best(id) > 0);
  // a rival whose matched name is strictly longer, or equally long, means the page names someone else (or is ambiguous)
  return rivals.length ? { ok: false, why: `page also names ${rivals.slice(0, 3).join(', ')} at least as specifically`, collision: rivals } : { ok: true };
}

/**
 * page: { dataset:'DOMAIN', host, institution_label, athletics_entity_id?, unitid?, sport?,
 *         institution_link_url, self_identification, http_status, redirect_to? }
 */
export function classifyDomainObservation(page, ctx) {
  const host = String(page.host || '').toLowerCase().replace(/^www\./, '');
  const res = ctx.resolver.resolve({ athletics_entity_id: page.athletics_entity_id, raw_name: page.institution_label, sport: page.sport, unitid: page.unitid });
  const b = base({ ...page, source_url: `https://${host}/`, source_kind: 'OFFICIAL_ATHLETICS_PROGRAMME_PAGE' }, 'DOMAIN', res, null, { target_table: 'athletics_domains', target_key: host });
  const evidence = {};
  if (!host) return [obs(b, 'SOURCE_UNTRUSTED', null, { evidence_json: { why: ['no host'] } })];
  if (SHARED_PLATFORM_ROOT.test(host)) return [obs(b, 'SOURCE_UNTRUSTED', null, { proposed_json: { ownership_class: 'SHARED_PLATFORM' }, evidence_json: { why: [`${host} is a shared hosting platform root; it can never identify an institution`] } })];
  if (res.decision !== 'RESOLVED') return [obs(b, res.method === 'CONTRADICTION' ? 'CONTRADICTION' : 'IDENTITY_AMBIGUOUS', null, { evidence_json: { why: res.contradictions } })];
  const entity = res.entity_id;
  const ownerNow = ctx.resolver.index.entityForHost(host) || (() => { const d = ctx.domains.find((x) => x.domain === host); return d && ['VERIFIED', 'VERIFIED_ALIAS'].includes(d.status) ? (d.athletics_entity_id || ctx.resolver.unitidEntity(d.unitid)?.entity || null) : null; })();
  const heldRow = ctx.domains.find((x) => x.domain === host);
  if (page.http_status && Number(page.http_status) >= 400) return [obs(b, 'DISAPPEARED_FROM_SOURCE', 'INVESTIGATE_DOMAIN', { requires_review: 1, proposed_json: { ownership_class: 'HISTORICAL' }, evidence_json: { why: [`host returned HTTP ${page.http_status}; a trusted host that disappears becomes HISTORICAL only after review — nothing is rewritten automatically`] } })];
  if (page.redirect_to) {
    const rh = hostOf(page.redirect_to);
    if (rh && rh !== host && !ctx.resolver.hostOwnedBy(rh, entity) && (ctx.resolver.index.entityForHost(rh) || ctx.domains.some((x) => x.domain === rh && ['VERIFIED', 'VERIFIED_ALIAS'].includes(x.status)))) return [obs(b, 'CONTRADICTION', null, { evidence_json: { why: [`${host} now redirects to ${rh}, which another institution owns`] } })];
  }
  const link = hostOf(page.institution_link_url);
  const chainLink = !!(link && ctx.resolver.hostOwnedBy(link, entity) && link !== host);
  const sid = selfIdentifies(ctx, entity, page.self_identification || '');
  Object.assign(evidence, { institution_link_host: link, institution_link_owned: chainLink, self_identification: sid });
  const chain = chainLink && sid.ok;
  if (ownerNow && ownerNow !== entity) {
    const auth = authorizeAction('CHANGE_DOMAIN_OWNERSHIP', { ownership_chain: chain, no_collision: false, not_shared_platform: true });
    return [obs(b, 'CONTRADICTION', 'CHANGE_DOMAIN_OWNERSHIP', { requires_review: 1, proposed_json: { ownership_class: 'WRONG_OWNER' }, evidence_json: { ...evidence, why: [`${host} is held for ${ownerNow}; observed for ${entity}`, ...auth.missing] } })];
  }
  if (ownerNow === entity) return [obs(b, 'CONFIRMED_UNCHANGED', 'REFRESH_DOMAIN_CHECK', { proposed_json: { checked_at: page.fetched_at || null }, expected_old_json: { domain: host, status: heldRow?.status ?? null, athletics_entity_id: heldRow?.athletics_entity_id ?? null }, evidence_json: evidence })];
  if (!chain) return [obs(b, 'POSSIBLE_CHANGE', null, { requires_review: 1, proposed_json: { ownership_class: 'UNVERIFIED' }, evidence_json: { ...evidence, why: ['ownership chain incomplete: institution -> official athletics link -> host -> self-identification'] } })];
  const hasPrimary = ctx.domains.some((d) => d.athletics_entity_id === entity && d.status === 'VERIFIED');
  const e = ctx.entities.find((x) => x.athletics_entity_id === entity);
  return [obs(b, 'NEW_RECORD', 'ASSIGN_DOMAIN', { proposed_json: { domain: host, athletics_entity_id: entity, unitid: e?.federal_unitid ?? e?.parent_unitid ?? null, status: hasPrimary ? 'VERIFIED_ALIAS' : 'VERIFIED', role: 'ATHLETICS_SITE', ownership_class: hasPrimary ? 'CURRENT_ALIAS' : 'CURRENT_PRIMARY', evidence_text: page.self_identification, final_url: `https://${host}/` }, expected_old_json: { domain: host, held: heldRow ? { status: heldRow.status, unitid: heldRow.unitid, athletics_entity_id: heldRow.athletics_entity_id } : null }, evidence_json: evidence })];
}

export function classifyPage(page, ctx, opts) {
  switch (page.dataset) {
    case 'COACH': return classifyCoachPage(page, ctx, opts);
    case 'ROSTER': return classifyRosterPage(page, ctx, opts);
    case 'PROGRAMME': return classifyProgrammeObservation(page, ctx, opts);
    case 'DOMAIN': return classifyDomainObservation(page, ctx, opts);
    default: throw new Error(`classifyPage: unknown dataset ${page.dataset}`);
  }
}
