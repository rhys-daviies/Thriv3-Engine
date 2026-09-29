/**
 * TEMPORAL MODEL — Phase 7E. What is true NOW vs what was true in a prior season.
 *
 *   programme_membership_periods   division / conference / membership status over seasons,
 *                                  keyed on athletics entity + sport + first_season.
 *                                  One open period (last_season NULL) = the current state.
 *   programme_conference_seasons   per-season OBSERVED conference + historical division
 *                                  (evidence; never rewritten by a refresh)
 *   season_freezes                 fingerprints of finished seasons; any change is a gate
 *                                  failure
 *
 * A transition CLOSES the open period at season-1 and OPENS a new one. It never edits a
 * closed period and never back-dates: a change "effective" at or before the open period's
 * first season is a correction of history and needs an explicit, reviewed correction.
 */
import crypto from 'node:crypto';

export const MEMBERSHIP_STATUSES = Object.freeze(['ACTIVE', 'PROVISIONAL', 'RECLASSIFYING', 'DISCONTINUED']);
export function governingBody(division) {
  if (/^NCAA/.test(division || '')) return 'NCAA';
  if (['NAIA', 'NJCAA', 'USCAA', 'NCCAA'].includes(division)) return division;
  return 'OTHER';
}

export const periodKey = (p) => `${p.athletics_entity_id}|${p.sport}|${p.first_season}`;
const covers = (p, season) => Number(season) >= Number(p.first_season) && (p.last_season == null || Number(season) <= Number(p.last_season));

export function periodsFor(periods, entityId, sport) {
  return periods.filter((p) => p.athletics_entity_id === entityId && p.sport === sport).sort((a, b) => a.first_season - b.first_season);
}
export function openPeriod(periods, entityId, sport) {
  const open = periodsFor(periods, entityId, sport).filter((p) => p.last_season == null);
  return open.length === 1 ? open[0] : null;
}
export function periodAt(periods, entityId, sport, season) {
  const hit = periodsFor(periods, entityId, sport).filter((p) => covers(p, season));
  return hit.length === 1 ? hit[0] : null;
}

/**
 * Plan a membership change effective from `season`. Returns { ops, problems }.
 * ops: CLOSE_PERIOD (expected last_season NULL) + OPEN_PERIOD, or OPEN_PERIOD alone when the
 * programme has no period yet.
 */
export function planTransition(periods, change) {
  const { athletics_entity_id: e, sport, season } = change;
  const problems = [];
  if (!e || !sport || !Number.isInteger(Number(season))) return { ops: [], problems: ['transition needs entity, sport and an integer season'] };
  if (!MEMBERSHIP_STATUSES.includes(change.membership_status)) problems.push(`bad membership_status ${change.membership_status}`);
  const open = openPeriod(periods, e, sport);
  const ops = [];
  if (open) {
    const same = open.division === change.division && (open.conference || null) === (change.conference || null)
      && open.membership_status === change.membership_status && (open.postseason_eligible ?? null) === (change.postseason_eligible ?? null);
    if (same) return { ops: [], problems, unchanged: true };
    if (Number(season) <= Number(open.first_season)) problems.push(`change effective ${season} would rewrite the open period that began ${open.first_season} — a correction of history, not a transition`);
    ops.push({ op: 'CLOSE_PERIOD', key: periodKey(open), expected_last_season: null, last_season: Number(season) - 1 });
  }
  if (periodsFor(periods, e, sport).some((p) => p.last_season != null && covers(p, season))) problems.push(`season ${season} is already covered by a closed period`);
  ops.push({
    op: 'OPEN_PERIOD',
    row: {
      athletics_entity_id: e, sport, first_season: Number(season), last_season: null,
      governing_body: governingBody(change.division), division: change.division, membership_status: change.membership_status,
      conference: change.conference ?? null, postseason_eligible: change.postseason_eligible ?? null, college_id: change.college_id ?? open?.college_id ?? null,
      source_url: change.source_url ?? null, source_tier: change.source_tier, provenance: change.provenance, review_due_season: change.review_due_season ?? null,
    },
  });
  return { ops, problems };
}

/**
 * Invariants over the period table (used by the validator and the monitor).
 *   P1 at most one open period per entity+sport
 *   P2 no overlapping periods
 *   P3 an open period's carrier row exists, is active (unless DISCONTINUED), has the same entity
 *      and sport, and colleges.division/conference == the period's (the pointer agrees)
 *   P4 every active, non-linked programme row has an open period (only once periods are seeded)
 */
export function periodProblems(periods, colleges, rowLinks = []) {
  const out = [];
  const byId = new Map(colleges.map((c) => [c.id, c]));
  const linked = new Set(rowLinks.map((l) => l.college_id));
  const groups = new Map();
  for (const p of periods) { const k = `${p.athletics_entity_id}|${p.sport}`; (groups.get(k) || groups.set(k, []).get(k)).push(p); }
  for (const [k, list] of groups) {
    const s = list.slice().sort((a, b) => a.first_season - b.first_season);
    if (s.filter((p) => p.last_season == null).length > 1) out.push(`P1 ${k}: more than one open membership period`);
    for (let i = 1; i < s.length; i++) { const prev = s[i - 1]; if (prev.last_season == null || Number(prev.last_season) >= Number(s[i].first_season)) out.push(`P2 ${k}: periods ${prev.first_season} and ${s[i].first_season} overlap`); }
    const open = s.find((p) => p.last_season == null);
    if (open) {
      const c = open.college_id ? byId.get(open.college_id) : null;
      if (!c) out.push(`P3 ${k}: open period carrier row ${open.college_id} missing`);
      else {
        if (c.athletics_entity_id !== open.athletics_entity_id || c.sport !== open.sport) out.push(`P3 ${k}: carrier row ${c.name} is another programme`);
        if (open.membership_status !== 'DISCONTINUED' && c.active !== 1) out.push(`P3 ${k}: carrier row ${c.name} is inactive but the period is ${open.membership_status}`);
        if (open.membership_status !== 'DISCONTINUED' && c.division !== open.division) out.push(`P3 ${k}: colleges.division ${c.division} disagrees with current membership ${open.division}`);
        if (open.membership_status !== 'DISCONTINUED' && (c.conference ?? null) !== (open.conference ?? null)) out.push(`P3 ${k}: colleges.conference ${c.conference} disagrees with current membership conference ${open.conference}`);
      }
    }
  }
  if (periods.length) {
    for (const c of colleges) {
      if (c.active !== 1 || linked.has(c.id) || !c.athletics_entity_id) continue;
      if (!groups.get(`${c.athletics_entity_id}|${c.sport}`)?.some((p) => p.last_season == null)) out.push(`P4 ${c.name} [${c.sport}] active programme has no open membership period`);
    }
  }
  return out;
}

/** Season-keyed tables a freeze fingerprints, with the content columns that define "what happened". */
export const FROZEN_TABLES = Object.freeze({
  roster_players: { season: 'season', cols: ['college_name', 'sport', 'division', 'season', 'player_name', 'class_year_label', 'position', 'minutes_played', 'games_played', 'games_started', 'nationality', 'hometown', 'country', 'source_roster_url'] },
  coach_seasons: { season: 'season', cols: ['school', 'sport', 'season', 'division', 'coach_name', 'coach_title', 'method', 'source_url'] },
  programme_seasons: { season: 'season', cols: ['college_id', 'sport', 'season', 'wins', 'draws', 'losses', 'matches_played', 'source_record_name'] },
  programme_conference_seasons: { season: 'season', cols: ['college_id', 'sport', 'season', 'conference_id', 'conference_raw', 'historical_division', 'conference_wins', 'conference_draws', 'conference_losses', 'member_raw', 'source_url'] },
});

/** Order-independent fingerprint of one season across the frozen tables (+ row counts). */
export function seasonFingerprint(db, season) {
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const out = {};
  for (const [t, spec] of Object.entries(FROZEN_TABLES)) {
    if (!has(t)) continue;
    const present = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
    const cols = spec.cols.filter((c) => present.has(c));
    const rows = db.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM ${t} WHERE CAST(${spec.season} AS INTEGER) = ?`).raw().all(Number(season));
    const lines = rows.map((r) => JSON.stringify(r)).sort();
    out[t] = { rows: lines.length, sha256: crypto.createHash('sha256').update(lines.join('\n')).digest('hex') };
  }
  return out;
}
