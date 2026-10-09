/**
 * RECRUITMENT-YEAR ELIGIBILITY AT SEND TIME — DI-08 Phase 2.
 *
 * A coach (or a programme inbox) may be contacted for an athlete only when the programme has
 * VERIFIED eligibility for the athlete's intended recruitment cycle. Before this gate the send
 * floor (coachEligibility.js, canonicalCoachEligibility.js) asked who a coach is and whether their
 * address is real — never whether the programme they coach exists in the season the athlete would
 * join it. DI-07 P4 §d found two coaches sendable on programmes that are not fielded: Eastern New
 * Mexico men's (stopped after 2024; its "2025" roster is a season-less copy of 2024) and
 * Wisconsin-Oshkosh men's (launching in 2027, no 2026 team). This gate refuses both on the data,
 * without the activation holds PR 90 adds for them.
 *
 * ---------------------------------------------------------------------------------------------
 * THREE YEARS THAT MUST NOT BE CONFUSED
 *
 *   athlete recruitment class / intended college ENTRY YEAR   Y = classYearOf(athlete)
 *       `players.recruiting_class_year` (the product's "Class of 2027": the year the athlete
 *       turns up at college), falling back to `graduation_year` exactly as shared/athlete.js
 *       defines it for every other consumer. Nothing else is read and nothing is inferred.
 *   PROGRAMME SEASON the athlete would join                   S = programmeSeasonForEntry(Y) = Y
 *       A season is the year its autumn begins (shared/roster/programmeStatus.js): an athlete
 *       entering in 2027 joins the Fall 2027 team, season 2027 (2027-28).
 *   CURRENT programme season, the one whose evidence exists   C = CURRENT_PROGRAMME_SEASON
 *       The season the current-season rosters were acquired for (TARGET_SEASON, 2026).
 *
 * A roster's `eligibility_end_year` / `estimated_graduation_year` describe the PLAYERS on it and
 * are never read here.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT COUNTS AS "FIELDED IN SEASON S" (the evidence model)
 *
 *   NEGATIVE, decisive:  colleges.active = 0; a programme_status row under which S is not fielded
 *                        (NOT_ACTIVE after its last season, FUTURE before its first); an unexpired
 *                        programme_season_fielding row with fielded = 0 for S.
 *   POSITIVE for C:      a SEASON-VERIFIED roster for C — at least ROSTER_MIN_PLAYERS rows of
 *                        season C whose season identity is proven, either by the refresh engine's
 *                        page check (source_page_season = C) or by TURNOVER re-measured here from
 *                        the stored rows (under TURNOVER_MAX_OVERLAP of the C names were on the
 *                        C-1 roster: a stale copy of last season repeats it ~100%), or — for a
 *                        high-retention squad — by CLASS ADVANCEMENT (the returners are one class
 *                        older than on the C-1 roster; a copy carries the old labels) — and no
 *                        roster_season_trust diagnosis on season C (RETAIN does not assert the
 *                        season is right); OR an unexpired programme_season_fielding row with
 *                        fielded = 1 for C.
 *   POSITIVE for S:      an unexpired programme_season_fielding row with fielded = 1 for S, or —
 *                        under the CONTINUITY presumption — a positive for C when
 *                        C <= S <= C + CONTINUITY_SEASONS and nothing records an end.
 *   NOT evidence:        an open NCAA/NAIA membership period, colleges.active = 1, a coach_seasons
 *                        row (ENMU's 2026 "roster-live" coach season was read from a page serving
 *                        2024), a roster whose season identity is unproven, or the absence of a
 *                        programme_status row ("absence means active" is selection's default and
 *                        is deliberately NOT this gate's).
 *
 * ---------------------------------------------------------------------------------------------
 * THE RULE
 *
 *   active for S                                   ALLOW (the existing checks still all apply)
 *   FUTURE programme, not fielded in C, S >= its   CONDITIONAL_ALLOW only with a valid consultant
 *     first season                                 authorisation for this athlete, programme, entry
 *                                                  season and recipient, with fresh official
 *                                                  evidence and the recipient on the staff page;
 *                                                  otherwise BLOCK
 *   not fielded in S, no confirmed future          BLOCK
 *   unknown                                        BLOCK + review requested
 *   contradictory evidence                         BLOCK + review requested
 *
 * The gate is asked by every send boundary, at the last moment before anything is written for a
 * send: sendOutreach — manual sends, the manual composer, Specific Search, the drafting CLI, the
 * Top-100/bulk composers — and assertExecutionSafety: the claim of an approved campaign message —
 * automated campaigns, scheduled execution, the approval workflow's execution — and its retry.
 * The programme-inbox fallback is not a separate door: an inbox is asked the same question about
 * the same programme. server/routes/recruitmentYearGateBoundaries.test.js enumerates the send
 * primitives so that a new path without the gate fails.
 *
 * Read-only except `recordGateDecision` (the ledger) and `recordRecruitmentCycleAuthorisation` /
 * `recordProgrammeSeasonFielding` (validated writers with no route behind them).
 */
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { classYearOf } from '../../shared/athlete.js';
import { readClassYear } from '../../shared/classYear.js';
import { activeForSeason, PROGRAMME_STATUS, TARGET_SEASON } from '../../shared/roster/programmeStatus.js';

/* ------------------------------------------------------------------------------------------- */
/* POLICY — every number a person decided, in one place. See DI-08/P2/GATE.md "open decisions". */
/* ------------------------------------------------------------------------------------------- */

/** The season whose evidence exists now (the current-season rosters). Moves with TARGET_SEASON. */
export const CURRENT_PROGRAMME_SEASON = TARGET_SEASON;
/**
 * CONTINUITY PRESUMPTION — a POLICY CHOICE awaiting the user's decision. A programme verified as
 * fielded in the current season, with nothing on file recording an end, is presumed fielded for
 * the next CONTINUITY_SEASONS entry seasons (2026 evidence covers entry 2026, 2027 and 2028).
 * Recruitment runs one to two cycles ahead; 0 would refuse every athlete not entering this year.
 */
export const CONTINUITY_SEASONS = 2;
/** A current roster repeating at least this share of last season's names is not proven to be new. */
export const TURNOVER_MAX_OVERLAP = 0.85;
/** Fewer rows than this is not a squad, so it proves nothing about a team being fielded. */
export const ROSTER_MIN_PLAYERS = 11;
/**
 * A high-retention roster (overlap >= TURNOVER_MAX_OVERLAP) is still proven new when its returners
 * have AGED: at least this share of the returners whose class is readable in both seasons are
 * exactly one class further on (Fr -> So ...), over at least CLASS_ADVANCE_MIN_RETURNERS of them.
 * A copied page cannot do this — ENMU's "2025" rows carry 2024's labels unchanged. This is the
 * acquisition pipeline's own second test, re-measured here from the stored rows.
 */
export const CLASS_ADVANCE_MIN_SHARE = 0.9;
export const CLASS_ADVANCE_MIN_RETURNERS = 10;
/** An authorisation's official evidence older than this (at send time) is stale. */
export const AUTHORISATION_EVIDENCE_MAX_AGE_DAYS = 30;
/** The longest an authorisation may be granted for. */
export const AUTHORISATION_MAX_LIFETIME_DAYS = 180;
/** The longest a fielding attestation may be evidence for. */
export const FIELDING_ATTESTATION_MAX_LIFETIME_DAYS = 400;

export const RULE_VERSION = 'DI-08-P2-recruitment-year-gate-v1';

/** entry year Y -> programme season Y (the autumn the athlete arrives). Explicit, never inferred. */
export function programmeSeasonForEntry(entryYear) {
  const y = toSeason(entryYear);
  return y == null ? null : y;
}

export const GATE_OUTCOME = Object.freeze({ ALLOW: 'ALLOW', CONDITIONAL_ALLOW: 'CONDITIONAL_ALLOW', BLOCK: 'BLOCK' });

/** Machine-readable reasons. Every decision carries exactly one, plus a structured detail. */
export const GATE_CODE = Object.freeze({
  // allow
  FIELDED_VERIFIED: 'RYG_FIELDED_VERIFIED',
  FIELDED_BY_CONTINUITY: 'RYG_FIELDED_BY_CONTINUITY',
  FUTURE_PROGRAMME_AUTHORISED: 'RYG_FUTURE_PROGRAMME_AUTHORISED',
  // block: the athlete's side
  ENTRY_SEASON_UNKNOWN: 'RYG_ENTRY_SEASON_UNKNOWN',
  ENTRY_SEASON_PAST: 'RYG_ENTRY_SEASON_PAST',
  ENTRY_SEASON_BEYOND_HORIZON: 'RYG_ENTRY_SEASON_BEYOND_HORIZON',
  // block: the programme
  PROGRAMME_UNKNOWN: 'RYG_PROGRAMME_UNKNOWN',
  PROGRAMME_INACTIVE: 'RYG_PROGRAMME_INACTIVE',
  PROGRAMME_NOT_FIELDED: 'RYG_PROGRAMME_NOT_FIELDED',
  FIELDING_UNKNOWN: 'RYG_FIELDING_UNKNOWN',
  EVIDENCE_CONTRADICTORY: 'RYG_EVIDENCE_CONTRADICTORY',
  // block: a future programme
  FUTURE_PROGRAMME_NOT_AUTHORISED: 'RYG_FUTURE_PROGRAMME_NOT_AUTHORISED',
  AUTHORISATION_EXPIRED: 'RYG_AUTHORISATION_EXPIRED',
  AUTHORISATION_EVIDENCE_STALE: 'RYG_AUTHORISATION_EVIDENCE_STALE',
  AUTHORISATION_EVIDENCE_NOT_OFFICIAL: 'RYG_AUTHORISATION_EVIDENCE_NOT_OFFICIAL',
  // block: the recipient
  RECIPIENT_NOT_AFFILIATED: 'RYG_RECIPIENT_NOT_AFFILIATED',
  RECIPIENT_AFFILIATION_UNVERIFIED: 'RYG_RECIPIENT_AFFILIATION_UNVERIFIED',
});

/** Codes that put the programme in front of a consultant (the review queue). */
const REVIEW = new Set([GATE_CODE.FIELDING_UNKNOWN, GATE_CODE.EVIDENCE_CONTRADICTORY, GATE_CODE.ENTRY_SEASON_BEYOND_HORIZON]);

/** The evidence a positive decision rested on. */
export const EVIDENCE_BASIS = Object.freeze({
  ROSTER_PAGE_SEASON: 'ROSTER_PAGE_SEASON',
  ROSTER_TURNOVER: 'ROSTER_TURNOVER',
  ROSTER_CLASS_ADVANCEMENT: 'ROSTER_CLASS_ADVANCEMENT',
  FIELDING_ATTESTATION: 'FIELDING_ATTESTATION',
  AUTHORISATION: 'AUTHORISATION',
});

export const BOUNDARY = Object.freeze({ MANUAL_SEND: 'MANUAL_SEND', EXECUTION_CLAIM: 'EXECUTION_CLAIM', EXECUTION_RETRY: 'EXECUTION_RETRY' });
/** The two recipient kinds (recipient.js RECIPIENT_KIND). INBOX is an alias, so a caller need not spell the kind. */
export const RECIPIENT = Object.freeze({ COACH: 'COACH', PROGRAMME_INBOX: 'PROGRAMME_INBOX', INBOX: 'PROGRAMME_INBOX' });

/* ------------------------------------------------------------------------------------------- */

function toSeason(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
}
const DAY = 86_400_000;
function ms(t) {
  if (t instanceof Date) return t.getTime();
  if (t == null || t === '') return NaN;
  return Date.parse(String(t));
}
export function hostOf(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch { return null; }
}
const lc = (s) => String(s ?? '').trim().toLowerCase();
const normName = (s) => String(s ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const has = (handle, t) => !!handle.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

/**
 * The logical programme (name, sport) names: its colleges row, the canonical row it is linked to
 * (programme_row_links), and every row linked to that canonical row. Exact names only — a fuzzy
 * match here would manufacture evidence (feedback_mechanical-checks).
 */
export function programmeRows({ collegeName, sport }, { handle = db } = {}) {
  const named = handle.prepare('SELECT id, name, sport, active FROM colleges WHERE name = ? AND sport = ?').get(collegeName, sport);
  if (!named) return null;
  let canonId = named.id;
  const links = has(handle, 'programme_row_links');
  if (links) canonId = handle.prepare('SELECT canonical_college_id c FROM programme_row_links WHERE college_id = ?').get(named.id)?.c || named.id;
  const rows = links
    ? handle.prepare(`SELECT id, name, sport, active FROM colleges WHERE sport = @sport AND (id = @canon OR id = @named
        OR id IN (SELECT college_id FROM programme_row_links WHERE canonical_college_id = @canon))`).all({ sport, canon: canonId, named: named.id })
    : [named];
  const canonical = rows.find((r) => r.id === canonId) || named;
  return { named, canonical, rows, names: [...new Set(rows.map((r) => r.name))] };
}

/** programme_status rows filed under any of the programme's names. */
function statusesFor(names, sport, handle) {
  if (!has(handle, 'programme_status')) return [];
  return handle.prepare(`SELECT school, sport, status, reason, active_from_season AS activeFromSeason, active_to_season AS activeToSeason,
      evidence, source_url AS sourceUrl, recorded_at AS recordedAt FROM programme_status WHERE sport = ? AND school IN (${names.map(() => '?').join(',')})`)
    .all(sport, ...names);
}

/** Unexpired programme_season_fielding rows for the programme in `season`. */
function attestationsFor(names, sport, season, now, handle) {
  if (!has(handle, 'programme_season_fielding')) return [];
  const t = ms(now);
  return handle.prepare(`SELECT * FROM programme_season_fielding WHERE sport = ? AND season = ? AND college_name IN (${names.map(() => '?').join(',')})`)
    .all(sport, season, ...names)
    .filter((a) => ms(a.verified_at) <= t && ms(a.expires_at) > t);
}

/**
 * Is the programme's roster for `season` season-verified? Re-measured from the stored rows every
 * time — the pipeline's own notes are not trusted (stage-file-cache-outlives-code).
 * -> { verified, basis, players, overlap, priorPlayers, trust }
 */
export function rosterSeasonProof(names, sport, season, { handle = db } = {}) {
  const q = (s) => handle.prepare(`SELECT player_name, class_year_label, source_page_season FROM roster_players
    WHERE sport = ? AND season = ? AND college_name IN (${names.map(() => '?').join(',')})`).all(sport, String(s), ...names);
  const cur = q(season);
  const curNames = new Set(cur.map((r) => normName(r.player_name)).filter(Boolean));
  const out = { verified: false, basis: null, players: curNames.size, overlap: null, priorPlayers: 0, classAdvanced: null, trust: [] };
  if (has(handle, 'roster_season_trust')) {
    out.trust = handle.prepare(`SELECT college_name, diagnosis, disposition FROM roster_season_trust
      WHERE sport = ? AND season = ? AND college_name IN (${names.map(() => '?').join(',')})`).all(sport, String(season), ...names)
      .filter((t) => t.diagnosis || t.disposition);
  }
  if (curNames.size < ROSTER_MIN_PLAYERS || out.trust.length) return out;
  if (cur.some((r) => String(r.source_page_season ?? '') === String(season))) return { ...out, verified: true, basis: EVIDENCE_BASIS.ROSTER_PAGE_SEASON };
  const prior = q(season - 1);
  const priorNames = new Set(prior.map((r) => normName(r.player_name)).filter(Boolean));
  out.priorPlayers = priorNames.size;
  if (priorNames.size < ROSTER_MIN_PLAYERS) return out;
  const returners = [...curNames].filter((n) => priorNames.has(n));
  out.overlap = Math.round((returners.length / curNames.size) * 1000) / 1000;
  if (returners.length / curNames.size < TURNOVER_MAX_OVERLAP) return { ...out, verified: true, basis: EVIDENCE_BASIS.ROSTER_TURNOVER };
  // high retention: proven new only if the returners have aged by exactly one class
  const klass = (rows, s) => {
    const m = new Map();
    for (const r of rows) { const k = readClassYear(r.class_year_label, { season: s }).klass; const nm = normName(r.player_name); if (k && nm) m.set(nm, m.has(nm) && m.get(nm) !== k ? null : k); }
    return m;
  };
  const kc = klass(cur, season); const kp = klass(prior, season - 1);
  let comparable = 0; let advanced = 0;
  for (const nm of returners) {
    const a = kp.get(nm); const b = kc.get(nm);
    if (!a || !b || (a === 'GRADUATE' && b === 'GRADUATE')) continue;   // a graduate staying a graduate proves nothing
    comparable += 1;
    if (CLASS_ORDER.indexOf(b) === CLASS_ORDER.indexOf(a) + 1) advanced += 1;
  }
  out.classAdvanced = { comparable, advanced };
  if (comparable >= CLASS_ADVANCE_MIN_RETURNERS && advanced / comparable >= CLASS_ADVANCE_MIN_SHARE) return { ...out, verified: true, basis: EVIDENCE_BASIS.ROSTER_CLASS_ADVANCEMENT };
  return out;
}
const CLASS_ORDER = ['FRESHMAN', 'SOPHOMORE', 'JUNIOR', 'SENIOR', 'GRADUATE'];

/** The athlete's entry year, by the product's one definition (shared/athlete.js). */
export function entrySeasonOf(athlete) {
  return toSeason(classYearOf(athlete));
}

/* ------------------------------------------------------------------------------------------- */
/* THE DECISION                                                                                 */
/* ------------------------------------------------------------------------------------------- */

const decision = (outcome, code, detail, extra = {}) => ({
  outcome, code, allowed: outcome !== GATE_OUTCOME.BLOCK, reviewRequested: outcome === GATE_OUTCOME.BLOCK && REVIEW.has(code),
  evidenceBasis: null, authorisationId: null, ...extra, detail,
});
const block = (code, detail, extra) => decision(GATE_OUTCOME.BLOCK, code, detail, extra);

/**
 * Should `recipient` be contacted at (collegeName, sport) for this athlete's recruitment cycle?
 *
 *   athlete    a players row (or { id, recruiting_class_year, graduation_year })
 *   recipient  { kind: 'COACH', coachId } | { kind: 'COACH', email } | { kind: 'PROGRAMME_INBOX', programmeContactId }
 *
 * -> { outcome, allowed, code, reviewRequested, evidenceBasis, authorisationId, entrySeason,
 *      programmeSeason, detail }. Read-only. Fails closed: any missing or contradictory evidence
 * is a BLOCK, never an allow.
 */
export function recruitmentYearDecision({ athlete, collegeName, sport, recipient }, { handle = db, now = new Date() } = {}) {
  const entrySeason = entrySeasonOf(athlete);
  const S = programmeSeasonForEntry(entrySeason);
  const C = CURRENT_PROGRAMME_SEASON;
  const base = { entrySeason, programmeSeason: S, currentSeason: C };
  const d = (fn) => ({ ...fn, entrySeason, programmeSeason: S });

  if (!athlete?.id) return d(block(GATE_CODE.ENTRY_SEASON_UNKNOWN, { ...base, why: 'no athlete' }));
  if (S == null) return d(block(GATE_CODE.ENTRY_SEASON_UNKNOWN, { ...base, why: 'the athlete has no recruiting_class_year (or graduation_year)' }));

  const prog = programmeRows({ collegeName, sport }, { handle });
  if (!prog) return d(block(GATE_CODE.PROGRAMME_UNKNOWN, { ...base, collegeName, sport }));
  const det = { ...base, collegeName, sport, programmeNames: prog.names };
  if (prog.named.active === 0 || prog.canonical.active === 0) {
    return d(block(GATE_CODE.PROGRAMME_INACTIVE, det));
  }

  /* -- recipient affiliation with THIS programme (both kinds, every path) -------------------- */
  const rec = recipientRow(recipient, prog, sport, handle);
  if (!rec.ok) return d(block(GATE_CODE.RECIPIENT_NOT_AFFILIATED, { ...det, recipient: publicRecipient(recipient), why: rec.why }));
  if (recipient.kind === RECIPIENT.COACH) det.recipientCoachId = rec.row.id;
  if (recipient.kind === RECIPIENT.PROGRAMME_INBOX) {
    const ids = new Set(prog.rows.map((r) => r.id));
    const entities = new Set(prog.rows.map((r) => handle.prepare('SELECT athletics_entity_id e FROM colleges WHERE id = ?').get(r.id)?.e).filter(Boolean));
    if (rec.row.sport !== sport || !(ids.has(rec.row.college_id) || entities.has(rec.row.athletics_entity_id))) {
      return d(block(GATE_CODE.RECIPIENT_NOT_AFFILIATED, { ...det, recipient: publicRecipient(recipient), why: 'the inbox is not filed under this programme' }));
    }
  }

  /* -- the programme's status rows ------------------------------------------------------------ */
  const statuses = statusesFor(prog.names, sport, handle);
  const distinct = new Set(statuses.map((s) => JSON.stringify([s.status, s.activeFromSeason, s.activeToSeason])));
  if (distinct.size > 1) return d(block(GATE_CODE.EVIDENCE_CONTRADICTORY, { ...det, why: 'programme_status rows disagree across the programme\'s names', statuses }));
  const status = statuses[0] || null;

  if (S < C) return d(block(GATE_CODE.ENTRY_SEASON_PAST, det));

  /* -- the evidence --------------------------------------------------------------------------- */
  const roster = rosterSeasonProof(prog.names, sport, C, { handle });
  const attC = attestationsFor(prog.names, sport, C, now, handle);
  const attS = S === C ? attC : attestationsFor(prog.names, sport, S, now, handle);
  const ev = {
    roster: { verified: roster.verified, basis: roster.basis, players: roster.players, priorPlayers: roster.priorPlayers, overlap: roster.overlap, classAdvanced: roster.classAdvanced, trust: roster.trust },
    status: status && { status: status.status, reason: status.reason, activeFromSeason: status.activeFromSeason, activeToSeason: status.activeToSeason, sourceUrl: status.sourceUrl },
    attestations: [...attC, ...(S === C ? [] : attS)].map((a) => ({ id: a.attestation_id, season: a.season, fielded: a.fielded, sourceUrl: a.source_url, expiresAt: a.expires_at })),
  };
  const full = { ...det, evidence: ev };

  for (const [season, list] of [[C, attC], [S, attS]]) {
    if (new Set(list.map((a) => a.fielded)).size > 1) return d(block(GATE_CODE.EVIDENCE_CONTRADICTORY, { ...full, why: `fielding attestations disagree about season ${season}` }));
  }
  const attFielded = (list) => (list.length ? list[0].fielded === 1 : null);
  const statusSays = (season) => (status ? activeForSeason(status, season) : null);   // null: nobody decided
  const positiveC = roster.verified || attFielded(attC) === true;

  // contradictions: positive proof for a season some other record says is not played
  if (positiveC && statusSays(C) === false) return d(block(GATE_CODE.EVIDENCE_CONTRADICTORY, { ...full, why: `season ${C} has fielding evidence but programme_status says it is not fielded` }));
  if (roster.verified && attFielded(attC) === false) return d(block(GATE_CODE.EVIDENCE_CONTRADICTORY, { ...full, why: `a season-verified ${C} roster exists but an attestation says ${C} is not fielded` }));
  if (attFielded(attS) === true && statusSays(S) === false) return d(block(GATE_CODE.EVIDENCE_CONTRADICTORY, { ...full, why: `an attestation says ${S} is fielded but programme_status says it is not` }));

  // decisive negatives for S
  if (statusSays(S) === false) return d(block(GATE_CODE.PROGRAMME_NOT_FIELDED, { ...full, why: `programme_status ${status.status}/${status.reason}: season ${S} is not fielded` }));
  if (attFielded(attS) === false) return d(block(GATE_CODE.PROGRAMME_NOT_FIELDED, { ...full, why: `attested not fielded in ${S}` }));

  // a FUTURE programme that does not play the current season: conditional on an authorisation
  const future = status?.status === PROGRAMME_STATUS.FUTURE && toSeason(status.activeFromSeason) != null && toSeason(status.activeFromSeason) > C;
  if (future) {
    return d(futureProgrammeDecision({ athlete, prog, sport, S, status, recipient, rec, now, handle, full }));
  }

  // positives for S
  if (attFielded(attS) === true) return d(decision(GATE_OUTCOME.ALLOW, GATE_CODE.FIELDED_VERIFIED, full, { evidenceBasis: EVIDENCE_BASIS.FIELDING_ATTESTATION }));
  if (!positiveC) return d(block(GATE_CODE.FIELDING_UNKNOWN, { ...full, why: `no season-verified evidence that the programme is fielded in ${C}` }));
  const basisC = roster.verified ? roster.basis : EVIDENCE_BASIS.FIELDING_ATTESTATION;
  if (S === C) return d(decision(GATE_OUTCOME.ALLOW, GATE_CODE.FIELDED_VERIFIED, full, { evidenceBasis: basisC }));
  if (S <= C + CONTINUITY_SEASONS) {
    // a recorded end before S was refused above (statusSays(S) === false); nothing else ends a programme
    return d(decision(GATE_OUTCOME.ALLOW, GATE_CODE.FIELDED_BY_CONTINUITY, { ...full, continuitySeasons: CONTINUITY_SEASONS }, { evidenceBasis: basisC }));
  }
  return d(block(GATE_CODE.ENTRY_SEASON_BEYOND_HORIZON, { ...full, continuitySeasons: CONTINUITY_SEASONS }));
}

const publicRecipient = (r) => (r ? { kind: r.kind, coachId: r.coachId ?? null, programmeContactId: r.programmeContactId ?? null } : null);

/**
 * The recipient's row(s), filed AT THIS PROGRAMME. A coach is named by id (the claim) or by address
 * (sendOutreach, whose recipients may come from a client body): every coaches row with that address
 * under one of the programme's names and this sport, never one elsewhere. A PROVEN_STALE row has
 * left and does not count. -> { ok, row, rows } or { ok: false, why }.
 */
function recipientRow(recipient, prog, sport, handle) {
  if (!recipient || !RECIPIENT[recipient.kind]) return { ok: false, why: 'no typed recipient' };
  if (recipient.kind === RECIPIENT.COACH) {
    let rows;
    if (recipient.coachId) rows = handle.prepare('SELECT * FROM coaches WHERE id = ?').all(recipient.coachId);
    else if (String(recipient.email ?? '').trim()) rows = handle.prepare('SELECT * FROM coaches WHERE lower(trim(email)) = lower(trim(?)) AND sport = ? ORDER BY id').all(recipient.email, sport);
    else return { ok: false, why: 'no coach id or address' };
    if (!rows.length) return { ok: false, why: 'no such coach' };
    const here = rows.filter((r) => r.sport === sport && prog.names.includes(r.school));
    if (!here.length) return { ok: false, why: `filed at ${rows[0].school} / ${rows[0].sport}, not this programme` };
    const current = here.filter((r) => r.currentness_status !== 'PROVEN_STALE');
    if (!current.length) return { ok: false, why: 'PROVEN_STALE at this programme' };
    return { ok: true, row: current[0], rows: current };
  }
  const row = recipient.programmeContactId && has(handle, 'programme_contacts')
    ? handle.prepare('SELECT * FROM programme_contacts WHERE contact_id = ?').get(recipient.programmeContactId) : null;
  return row ? { ok: true, row, rows: [row] } : { ok: false, why: 'no such programme contact' };
}

/**
 * A FUTURE programme (not fielded in the current season, a recorded first season F, S >= F).
 * Recruitment intent is never inferred from the launch: only an explicit consultant authorisation
 * for THIS athlete, programme, entry season and recipient opens it, while it is unexpired and
 * unrevoked, with both of its official readings fresh, the programme evidence on the host that
 * recorded the launch, and the recipient confirmed on the official staff page.
 */
function futureProgrammeDecision({ athlete, prog, sport, S, status, recipient, rec, now, handle, full }) {
  const t = ms(now);
  const maxAge = AUTHORISATION_EVIDENCE_MAX_AGE_DAYS * DAY;
  const detail = { ...full, futureFrom: status.activeFromSeason };
  if (!has(handle, 'recruitment_cycle_authorisations')) return block(GATE_CODE.FUTURE_PROGRAMME_NOT_AUTHORISED, detail);
  const recipientCol = recipient.kind === RECIPIENT.COACH ? 'coach_id' : 'programme_contact_id';
  const recipientIds = rec.rows.map((r) => (recipient.kind === RECIPIENT.COACH ? r.id : r.contact_id));
  const candidates = handle.prepare(`SELECT * FROM recruitment_cycle_authorisations
      WHERE athlete_id = ? AND sport = ? AND entry_season = ? AND recipient_kind = ?
        AND ${recipientCol} IN (${recipientIds.map(() => '?').join(',')})
        AND college_name IN (${prog.names.map(() => '?').join(',')}) AND revoked_at IS NULL
      ORDER BY created_at DESC, authorisation_id`)
    .all(athlete.id, sport, S, recipient.kind, ...recipientIds, ...prog.names);
  if (!candidates.length) return block(GATE_CODE.FUTURE_PROGRAMME_NOT_AUTHORISED, { ...detail, why: 'no unrevoked authorisation for this athlete, programme, entry season and recipient' });

  const officialProgrammeHost = hostOf(status.sourceUrl);
  const staffHostsOf = (r) => (recipient.kind === RECIPIENT.COACH
    ? [r.currentness_source_url, r.email_seen_on_source_url, r.email_source_url].map(hostOf).filter(Boolean)
    : [hostOf(r.observed_on_url)].filter(Boolean));
  const refusals = [];
  for (const a of candidates) {
    const why = (code, w) => { refusals.push({ authorisationId: a.authorisation_id, code, why: w }); };
    if (!(ms(a.expires_at) > t)) { why(GATE_CODE.AUTHORISATION_EXPIRED, `expired ${a.expires_at}`); continue; }
    const pv = ms(a.programme_evidence_verified_at); const sv = ms(a.staff_evidence_verified_at);
    if (!(pv <= t && t - pv <= maxAge) || !(sv <= t && t - sv <= maxAge)) { why(GATE_CODE.AUTHORISATION_EVIDENCE_STALE, `evidence read ${a.programme_evidence_verified_at} / ${a.staff_evidence_verified_at}; limit ${AUTHORISATION_EVIDENCE_MAX_AGE_DAYS} days, none in the future`); continue; }
    if (!officialProgrammeHost || hostOf(a.programme_evidence_url) !== officialProgrammeHost) { why(GATE_CODE.AUTHORISATION_EVIDENCE_NOT_OFFICIAL, `programme evidence ${a.programme_evidence_url} is not on ${officialProgrammeHost}`); continue; }
    // the recipient the authorisation names must be CURRENT, on the official staff page it re-read
    const r = rec.rows.find((x) => (recipient.kind === RECIPIENT.COACH ? x.id === a.coach_id : x.contact_id === a.programme_contact_id));
    if (recipient.kind === RECIPIENT.COACH && r.currentness_status !== 'CURRENT') { why(GATE_CODE.RECIPIENT_AFFILIATION_UNVERIFIED, `coach currentness is ${r.currentness_status ?? 'unknown'}, not CURRENT`); continue; }
    if (recipient.kind === RECIPIENT.PROGRAMME_INBOX && r.status !== 'VERIFIED') { why(GATE_CODE.RECIPIENT_AFFILIATION_UNVERIFIED, `inbox status ${r.status}`); continue; }
    const staffHosts = staffHostsOf(r);
    if (!staffHosts.includes(hostOf(a.staff_evidence_url))) { why(GATE_CODE.RECIPIENT_AFFILIATION_UNVERIFIED, `staff evidence ${a.staff_evidence_url} is not on the recipient's official source host (${staffHosts.join(', ') || 'none recorded'})`); continue; }
    return decision(GATE_OUTCOME.CONDITIONAL_ALLOW, GATE_CODE.FUTURE_PROGRAMME_AUTHORISED,
      { ...detail, authorisation: { id: a.authorisation_id, consultant: a.consultant_operator_id, programmeEvidenceUrl: a.programme_evidence_url, staffEvidenceUrl: a.staff_evidence_url, expiresAt: a.expires_at } },
      { evidenceBasis: EVIDENCE_BASIS.AUTHORISATION, authorisationId: a.authorisation_id });
  }
  return block(refusals[0].code, { ...detail, refusals });
}

/* ------------------------------------------------------------------------------------------- */
/* THE BOUNDARY HELPERS                                                                         */
/* ------------------------------------------------------------------------------------------- */

export class RecruitmentYearGateError extends Error {
  constructor(d) {
    super(`Not contactable for this athlete's recruitment cycle (${d.code}).`);
    this.name = 'RecruitmentYearGateError'; this.code = d.code; this.recruitmentGateDecision = d;
  }
}

/** The decision, or throws RecruitmentYearGateError carrying it. For the execution claim. */
export function assertRecruitmentYearEligible(args, opts) {
  const d = recruitmentYearDecision(args, opts);
  if (!d.allowed) throw new RecruitmentYearGateError(d);
  return d;
}

/**
 * Append the decision to the ledger. A BLOCK is written by the boundary that refused; an ALLOW in
 * the same transaction as the outreach_send row it permitted (outreachSendId). Never throws into a
 * refusal: a ledger failure on a BLOCK must not turn a refusal into something else.
 */
export function recordGateDecision(d, { boundary, athleteId, collegeName, sport, recipient, programmeMessageId = null, outreachSendId = null, handle = db, now = new Date() }) {
  if (!BOUNDARY[boundary]) throw new Error(`unknown gate boundary ${boundary}`);
  const id = `RGD-${randomUUID()}`;
  handle.prepare(`INSERT INTO recruitment_gate_decisions (decision_id, decided_at, boundary, athlete_id, college_name, sport, entry_season,
      programme_season, recipient_kind, coach_id, programme_contact_id, outcome, code, evidence_basis, detail_json, authorisation_id,
      review_requested, programme_message_id, outreach_send_id, rule_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, new Date(ms(now)).toISOString(), boundary, athleteId, collegeName, sport, d.entrySeason ?? null, d.programmeSeason ?? null,
    recipient?.kind === RECIPIENT.PROGRAMME_INBOX ? RECIPIENT.PROGRAMME_INBOX : RECIPIENT.COACH,
    recipient?.kind === RECIPIENT.COACH ? recipient.coachId ?? d.detail?.recipientCoachId ?? null : null,
    recipient?.kind === RECIPIENT.PROGRAMME_INBOX ? recipient.programmeContactId ?? null : null,
    d.outcome, d.code, d.evidenceBasis ?? null, JSON.stringify(d.detail ?? {}), d.authorisationId ?? null,
    d.reviewRequested ? 1 : 0, programmeMessageId, outreachSendId, RULE_VERSION,
  );
  return id;
}

/** recordGateDecision for a refusal, swallowing a ledger failure (logged) so the refusal stands. */
export function recordGateRefusal(d, ctx) {
  try { return recordGateDecision(d, ctx); } catch (err) { console.warn(`  recruitment gate ledger write failed: ${err.message}`); return null; }
}

/** Programmes a consultant must review: every BLOCK that requested one, newest first. Read-only. */
export function fieldingReviewQueue({ handle = db } = {}) {
  if (!has(handle, 'recruitment_gate_decisions')) return [];
  return handle.prepare(`SELECT college_name, sport, code, MAX(decided_at) AS last_decided_at, COUNT(*) AS refusals
    FROM recruitment_gate_decisions WHERE review_requested = 1 GROUP BY college_name, sport, code ORDER BY last_decided_at DESC`).all();
}

/* ------------------------------------------------------------------------------------------- */
/* VALIDATED WRITERS — no route calls these; each use is a separately authorised operation.    */
/* ------------------------------------------------------------------------------------------- */

export class GateRecordError extends Error {
  constructor(code, message) { super(message); this.name = 'GateRecordError'; this.code = code; }
}

/**
 * Record a consultant's authorisation to approach a FUTURE programme. Refuses anything the gate
 * would not honour, so a row that exists is one that could open the gate while fresh.
 */
export function recordRecruitmentCycleAuthorisation({
  athleteId, collegeName, sport, entrySeason, recipient, consultantOperatorId,
  programmeEvidenceUrl, programmeEvidenceVerifiedAt, staffEvidenceUrl, staffEvidenceVerifiedAt, expiresAt,
}, { handle = db, now = new Date() } = {}) {
  const t = ms(now);
  const athlete = handle.prepare('SELECT id, recruiting_class_year, graduation_year FROM players WHERE id = ?').get(athleteId);
  if (!athlete) throw new GateRecordError('ATHLETE_NOT_FOUND', `No athlete ${athleteId}`);
  if (entrySeasonOf(athlete) !== toSeason(entrySeason)) throw new GateRecordError('ENTRY_SEASON_MISMATCH', `The athlete's entry year is ${entrySeasonOf(athlete)}, not ${entrySeason}.`);
  const prog = programmeRows({ collegeName, sport }, { handle });
  if (!prog) throw new GateRecordError('PROGRAMME_UNKNOWN', `${collegeName} / ${sport} is not a registry programme`);
  const status = statusesFor(prog.names, sport, handle)[0];
  if (!(status?.status === PROGRAMME_STATUS.FUTURE && toSeason(status.activeFromSeason) > CURRENT_PROGRAMME_SEASON && toSeason(entrySeason) >= toSeason(status.activeFromSeason))) {
    throw new GateRecordError('NOT_A_FUTURE_PROGRAMME', 'An authorisation is only for a FUTURE programme, for an entry season it will field.');
  }
  if (!String(consultantOperatorId ?? '').trim()) throw new GateRecordError('CONSULTANT_REQUIRED', 'An authorisation names the consultant who gave it.');
  for (const [k, u] of [['programmeEvidenceUrl', programmeEvidenceUrl], ['staffEvidenceUrl', staffEvidenceUrl]]) if (!hostOf(u)) throw new GateRecordError('EVIDENCE_URL_INVALID', `${k} must be an https URL`);
  for (const [k, v] of [['programmeEvidenceVerifiedAt', programmeEvidenceVerifiedAt], ['staffEvidenceVerifiedAt', staffEvidenceVerifiedAt]]) {
    const x = ms(v); if (!(x <= t && t - x <= AUTHORISATION_EVIDENCE_MAX_AGE_DAYS * DAY)) throw new GateRecordError('EVIDENCE_STALE', `${k} must be within ${AUTHORISATION_EVIDENCE_MAX_AGE_DAYS} days and not in the future`);
  }
  const exp = ms(expiresAt);
  if (!(exp > t && exp - t <= AUTHORISATION_MAX_LIFETIME_DAYS * DAY)) throw new GateRecordError('EXPIRY_INVALID', `expiresAt must be in the next ${AUTHORISATION_MAX_LIFETIME_DAYS} days`);
  if (!recipient || !RECIPIENT[recipient.kind] || !(recipient.kind === RECIPIENT.COACH ? recipient.coachId : recipient.programmeContactId)) throw new GateRecordError('RECIPIENT_REQUIRED', 'An authorisation names exactly one recipient.');
  const id = `RCA-${randomUUID()}`;
  handle.prepare(`INSERT INTO recruitment_cycle_authorisations (authorisation_id, athlete_id, college_name, sport, entry_season, recipient_kind, coach_id,
      programme_contact_id, consultant_operator_id, programme_evidence_url, programme_evidence_verified_at, staff_evidence_url, staff_evidence_verified_at, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, athleteId, prog.canonical.name, sport, toSeason(entrySeason), recipient.kind,
    recipient.kind === RECIPIENT.COACH ? recipient.coachId : null, recipient.kind === RECIPIENT.PROGRAMME_INBOX ? recipient.programmeContactId : null,
    String(consultantOperatorId).trim(), programmeEvidenceUrl, new Date(ms(programmeEvidenceVerifiedAt)).toISOString(), staffEvidenceUrl,
    new Date(ms(staffEvidenceVerifiedAt)).toISOString(), new Date(exp).toISOString(), new Date(t).toISOString(),
  );
  return id;
}

/** Revoke an authorisation (the only change a row accepts). */
export function revokeRecruitmentCycleAuthorisation(authorisationId, { operatorId, reason }, { handle = db, now = new Date() } = {}) {
  if (!String(operatorId ?? '').trim() || !String(reason ?? '').trim()) throw new GateRecordError('REVOCATION_INCOMPLETE', 'A revocation names who and why.');
  const r = handle.prepare('UPDATE recruitment_cycle_authorisations SET revoked_at = ?, revoked_by_operator_id = ?, revocation_reason = ? WHERE authorisation_id = ? AND revoked_at IS NULL')
    .run(new Date(ms(now)).toISOString(), String(operatorId).trim(), String(reason).trim(), authorisationId);
  return r.changes === 1;
}

/** Record season-specific fielding evidence (either direction). Append-only. */
export function recordProgrammeSeasonFielding({
  collegeName, sport, season, fielded, evidence, sourceUrl, verifiedAt, expiresAt, operatorId = null,
}, { handle = db, now = new Date() } = {}) {
  const t = ms(now);
  if (!programmeRows({ collegeName, sport }, { handle })) throw new GateRecordError('PROGRAMME_UNKNOWN', `${collegeName} / ${sport} is not a registry programme`);
  if (toSeason(season) == null) throw new GateRecordError('SEASON_INVALID', 'season must be a season year');
  if (fielded !== true && fielded !== false) throw new GateRecordError('FIELDED_REQUIRED', 'fielded must be true or false');
  if (!String(evidence ?? '').trim()) throw new GateRecordError('EVIDENCE_REQUIRED', 'a fielding attestation records the evidence behind it');
  if (!hostOf(sourceUrl)) throw new GateRecordError('EVIDENCE_URL_INVALID', 'sourceUrl must be an https URL');
  const v = ms(verifiedAt); const e = ms(expiresAt);
  if (!(v <= t)) throw new GateRecordError('EVIDENCE_STALE', 'verifiedAt must not be in the future');
  if (!(e > t && e - v <= FIELDING_ATTESTATION_MAX_LIFETIME_DAYS * DAY)) throw new GateRecordError('EXPIRY_INVALID', `expiresAt must be in the future and within ${FIELDING_ATTESTATION_MAX_LIFETIME_DAYS} days of verifiedAt`);
  const id = `PSF-${randomUUID()}`;
  handle.prepare(`INSERT INTO programme_season_fielding (attestation_id, college_name, sport, season, fielded, evidence, source_url, verified_at, expires_at, recorded_at, recorded_by_operator_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, collegeName, sport, toSeason(season), fielded ? 1 : 0, String(evidence).trim(), sourceUrl,
    new Date(v).toISOString(), new Date(e).toISOString(), new Date(t).toISOString(), operatorId);
  return id;
}
