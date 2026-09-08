/**
 * THE ATHLETE DECISION LAYER — what a report named after an athlete says first.
 *
 * The rule is written out in docs/athlete-decision-layer.md and summarised
 * here, because a ranking whose reasons live only in code is a black box no
 * matter how deterministic it is.
 *
 *   RANK THE FINDINGS. FREEZE THE PAGE ORDER.
 *
 * The same principle as the programme layer, and the same renderer draws it.
 * What differs is the subject: these findings are about one position, one entry
 * year and one origin group.
 *
 * WHY IT EXISTS. Before 13F, page 2 of "Rhys Davies × Mercyhurst" was the
 * programme decision layer, byte-identical to the standalone report — six
 * ranked findings, not one of which mentioned a defender, the 2027 entry year,
 * or the seventeen players already at that position. The athlete's own reading
 * was page 3, in five undifferentiated paragraphs with no metric anchors. The
 * analysis was there; the composition put the programme's answer in front of
 * the athlete's.
 *
 * WHAT THIS MODULE MAY NOT DO.
 *
 * Compute. Every figure is already in the model and already printed on a page.
 *
 * Score. No fit number, no composite, no hidden total. The priority classes
 * order findings; they do not measure an athlete or a programme, and they never
 * appear in the rendered text.
 *
 * Touch the programme layer. `decisionFindings` is imported nowhere here and
 * changed nowhere by this phase.
 *
 * Predict. The season being entered has not been played. Nothing here says how
 * many minutes an arriving player would get, and the pages it points at say so
 * outright.
 */
import { STARTER_MINUTES } from '../philosophy.js';
import { STEP_POINTS } from '../freshmanMinutes.js';
import { PROMINENCE, coachContextFor } from './coachContext.js';

const pc = (v) => `${Math.round(v * 100)}%`;
const pcPt = (v) => `${Math.round(v)}%`;
const nf = (v) => (v == null ? null : Math.round(v).toLocaleString('en-US'));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const nfHalf = (v) => (v == null ? null : (Number.isInteger(v) ? String(v) : v.toFixed(1)));

/**
 * The controlled candidate set. Declaration order is the ranking's final
 * tiebreak, so two candidates equal on class and evidence always resolve the
 * same way.
 */
export const ATHLETE_CATEGORIES = Object.freeze([
  { id: 'position-depth-at-entry', label: 'Your position at entry', section: 'athlete-current-position' },
  { id: 'position-arrival-reliance', label: 'Who takes minutes at your position', section: 'athlete-position-openings' },
  { id: 'position-first-year-record', label: 'First-years at your position', section: 'athlete-position-record' },
  { id: 'position-opening-history', label: 'When a place has opened', section: 'athlete-position-openings' },
  { id: 'position-intake', label: 'How often this position is added to', section: 'athlete-position-record' },
  { id: 'position-minute-reach', label: 'How far the minutes reach', section: 'athlete-position-record' },
  { id: 'origin-cohort', label: 'Players arriving from where you are', section: 'athlete-origin' },
  { id: 'competitive-structure', label: 'The level you would be joining', section: 'competitive-environment' },
  { id: 'coach-attribution', label: 'Whose record this is', section: 'competitive-history' },
  { id: 'programme-development', label: 'How players develop here', section: 'player-development' },
  { id: 'traced-position-movement', label: 'Where players at your position went', section: 'athlete-position-movement' },
]);

const RANK = new Map(ATHLETE_CATEGORIES.map((c, i) => [c.id, i]));
const CAT = new Map(ATHLETE_CATEGORIES.map((c) => [c.id, c]));

export const PRIORITY = Object.freeze(['A', 'B', 'C', 'D']);
const CLASS_RANK = new Map(PRIORITY.map((p, i) => [p, i]));
export const EVIDENCE_LEVELS = Object.freeze(['none', 'limited', 'moderate', 'strong', 'record']);
const EVIDENCE_RANK = new Map(EVIDENCE_LEVELS.map((l, i) => [l, i]));
const CEILING = { record: 'A', strong: 'A', moderate: 'B', limited: 'C', none: null };
const worse = (a, b) => (CLASS_RANK.get(a) >= CLASS_RANK.get(b) ? a : b);

/** At most six findings, no floor, and class D only while the page is thin. */
export const MAX_FINDINGS = 6;
export const FILL_TO = 3;

const levelOf = (evidence) => {
  if (!evidence) return 'none';
  if (evidence.sufficient === false) return 'none';
  return EVIDENCE_LEVELS.includes(evidence.level) ? evidence.level : 'limited';
};

/**
 * A middle half said as a range, or as one value where it has no width.
 *
 * "a comparable middle half of 3 to 3" is a range printed against itself, which
 * reads as a rendering fault rather than as a pool whose quartiles coincide.
 */
const middleHalfText = (pool) => {
  const mh = pool?.middleHalf;
  if (!mh) return null;
  const low = nfHalf(mh.low); const high = nfHalf(mh.high);
  return low === high ? low : `${low} to ${high}`;
};

/** Outside the pool's middle half, either way. Null pool, null answer. */
const outsideMiddleHalf = (value, pool) => {
  const mh = pool?.middleHalf;
  if (value == null || !mh || mh.low == null || mh.high == null) return null;
  return value > mh.high || value < mh.low;
};

/**
 * THE TRANSFER ASSUMPTION, in the one place it lives.
 *
 * The athlete input carries a class year and no entry type, so this report
 * cannot tell a first-time college entrant from somebody arriving with college
 * seasons behind them. Every production athlete is ASSUMED to be a first-time
 * entrant and the first-year categories are phrased accordingly.
 *
 * Where a future input does establish an entry type and it is not a first-time
 * entrant, the first-year categories refuse rather than describe somebody
 * else's route as if it were theirs. A regression test holds that.
 */
export function entryTypeIsFirstTime(athlete) {
  const t = athlete?.entryType;
  if (t == null) return true; // the documented assumption
  return String(t).toLowerCase() === 'first-year' || String(t).toLowerCase() === 'first-time';
}

const candidate = (id, over = {}) => ({
  category: id,
  label: CAT.get(id).label,
  section: CAT.get(id).section,
  eligible: false,
  reason: null,
  materiality: null,
  evidence: 'none',
  priority: null,
  text: null,
  metric: null,
  evidenceNote: null,
  rank: null,
  rendered: false,
  ...over,
});

const refuse = (id, reason) => candidate(id, { eligible: false, reason });

/**
 * The only place a priority is assigned: the evidence sets a ceiling, the
 * materiality sets a floor, the worse of the two wins. No arithmetic.
 */
const admit = (id, { reason, materiality, evidence, text, metric, evidenceNote, section }) => {
  const ceiling = CEILING[evidence];
  if (!ceiling) return refuse(id, 'evidence-insufficient');
  const band = evidence === 'record' ? null : `EVIDENCE — ${evidence.toUpperCase()}`;
  return candidate(id, {
    eligible: true,
    reason,
    materiality,
    evidence,
    priority: worse(materiality, ceiling),
    text,
    metric: metric ?? null,
    evidenceNote: [band, evidenceNote].filter(Boolean).join(' · ') || null,
    ...(section !== undefined ? { section } : {}),
  });
};

// ---------------------------------------------------------------------------
// The eleven canonical findings
// ---------------------------------------------------------------------------

/**
 * 1. The position group around the entry year.
 *
 * CLASS A ON A COMPARISON OF TWO MEASURED QUANTITIES, not on a threshold
 * somebody picked: the number of current players at this position eligible
 * BEYOND the entry year, against the number that a typical season at this
 * position sees reach a starter's season. Where the first is at least the
 * second, the group that will still be there outnumbers the group that
 * normally gets starter minutes, and that changes how every other figure in
 * the report should be read. Both numbers are in the sentence.
 */
function positionDepthFinding(model) {
  const id = 'position-depth-at-entry';
  const a = model.summary?.athlete;
  if (!a) return refuse(id, 'no-athlete');
  const here = a.currentPositionPlayers ?? [];
  if (!here.length) return refuse(id, 'no-current-roster-at-position');
  const beyond = (a.currentPlayersBeyondEntry ?? []).length;
  const finalSeason = (a.currentPlayersInFinalSeasonAtEntry ?? []).length;
  const noun = String(a.positionLabel ?? 'this position').toLowerCase();
  const reach = model.positionUtilisation?.athletePosition?.available
    ? model.positionUtilisation.athletePosition.medianPlayersWith600Plus : null;
  const crowded = reach != null && beyond >= reach;
  const proj = a.currentProjectedMinutesOfPlayersBeyondEntry;

  return admit(id, {
    reason: crowded ? 'beyond-entry-group-exceeds-typical-starter-count' : 'position-group-readable',
    materiality: crowded ? 'A' : 'C',
    // The roster is a record of who is on it, not a sample of anything.
    evidence: 'record',
    text: `${plural(here.length, `${noun}`, `${noun}s`)} are on the current roster, `
      + `${beyond} of them eligible beyond ${a.entrySeason}`
      + (finalSeason ? ` and ${finalSeason} in a final eligible season in ${a.entrySeason}` : '')
      + (reach != null
        ? `. A typical season here sees ${nfHalf(reach)} ${noun}s reach a `
          + `${STARTER_MINUTES}-minute season.`
        : '.'),
    metric: `${beyond} of ${here.length}`,
    evidenceNote: proj?.playersWithProjection
      ? `${nf(proj.currentProjectedMinutes)} projected minutes attached to `
        + `${proj.playersWithProjection} of those ${beyond}`
      : 'none of them carries a projected-minutes figure',
  });
}

/**
 * 2. Who takes the minutes when they come free at this position.
 *
 * The share that went to players who did not arrive as first-years, measured
 * against THE PROGRAMME'S OWN share rather than against a pool — there is no
 * position-level pool for the mix, and a position that behaves differently from
 * its own programme is the fact an athlete needs. `STEP_POINTS` is the margin
 * `classifyProgramme` already uses to call a change a change.
 */
function positionArrivalRelianceFinding(model) {
  const id = 'position-arrival-reliance';
  const a = model.summary?.athlete;
  const o = a?.positionOpeningOutcomes;
  if (!o?.dials?.n) return refuse(id, 'no-position-season-readable');
  const evidence = levelOf(o.evidence);
  if (evidence === 'none') return refuse(id, 'evidence-insufficient');
  const noun = String(a.positionLabel ?? 'this position').toLowerCase();
  const mine = o.dials.newcomer;
  const programme = model.dials?.newcomer ?? null;
  const gap = programme == null ? null : mine - programme;
  const departs = gap != null && Math.abs(gap) >= STEP_POINTS;
  return admit(id, {
    reason: departs ? 'position-mix-departs-from-programme' : 'position-mix-readable',
    materiality: departs ? 'B' : 'C',
    evidence,
    text: `${pcPt(mine)} of the minutes that came free at ${noun} went to players who did not `
      + `arrive as first-years`
      + (programme == null ? '.'
        : `, against ${pcPt(programme)} across the programme as a whole.`),
    metric: pcPt(mine),
    evidenceNote: `${plural(o.dials.n, 'position-season', 'position-seasons')} readable · `
      + `${pcPt(o.dials.returning)} returning, ${pcPt(o.dials.freshman)} first-years`,
  });
}

/**
 * 3. First-years at this position.
 *
 * Measured against the programme-wide share of first-years reaching a starter's
 * season, which is the figure the programme act prints. Refused where the entry
 * type cannot be established as a first-time entrant: this describes a route,
 * and it must not be handed to somebody arriving by a different one.
 */
function positionFirstYearFinding(model) {
  const id = 'position-first-year-record';
  const a = model.summary?.athlete;
  const h = a?.positionFreshmanHistory;
  if (!entryTypeIsFirstTime(model.athlete)) return refuse(id, 'entry-type-not-established');
  if (!h?.measured) return refuse(id, 'no-first-year-at-position-measured');
  const evidence = levelOf(h.evidence);
  if (evidence === 'none') return refuse(id, 'evidence-insufficient');
  const noun = String(a.positionLabel ?? 'this position').toLowerCase();
  const share = h.starters / h.measured;
  const programme = model.lifecycle?.development?.everStarter?.share ?? null;
  const gap = programme == null ? null : (share - programme) * 100;
  const departs = gap != null && Math.abs(gap) >= STEP_POINTS;
  return admit(id, {
    reason: departs ? 'position-first-years-depart-from-programme' : 'position-first-years-readable',
    materiality: departs ? 'B' : 'C',
    evidence,
    text: `${h.starters} of the ${h.measured} first-year ${noun}s with minutes on file reached a `
      + `${STARTER_MINUTES}-minute season`
      + (programme == null ? '.'
        : `, against ${pc(programme)} of first-years across the whole squad.`),
    metric: `${h.starters} of ${h.measured}`,
    evidenceNote: `${plural(h.evidence?.sample?.seasons ?? 0, 'season', 'seasons')} of position minutes`
      + (h.cohortLadder?.length ? ` · ladder shown for ${h.cohortLadder.length} ranks` : ''),
  });
}

/**
 * 4. What happened the last times a place opened here.
 *
 * A REPEATED ROUTE IS A PATTERN; a split one is context. Class B where one
 * route started after every opening, which is a count over observed events
 * rather than a share with a threshold on it.
 */
function positionOpeningFinding(model) {
  const id = 'position-opening-history';
  const a = model.summary?.athlete;
  const v = a?.positionVacancyHistory;
  const o = a?.positionOpeningOutcomes;
  if (!v?.openings) return refuse(id, 'no-opening-observed-at-position');
  const evidence = levelOf(o?.evidence);
  if (evidence === 'none') return refuse(id, 'evidence-insufficient');
  const noun = String(a.positionLabel ?? 'this position').toLowerCase();
  const every = v.openings >= 2
    && (v.newcomerTookIt === v.openings || v.freshmanTookIt === v.openings);
  const route = v.newcomerTookIt === v.openings ? 'an experienced arrival' : 'a first-year';
  return admit(id, {
    reason: every ? 'one-route-started-after-every-opening' : 'openings-observed',
    materiality: every ? 'B' : 'C',
    evidence,
    text: `A starter left ${noun} in ${v.openings} of ${v.transitions} season-to-season changes on `
      + `file`
      + (every
        ? `, and ${route} started after every one of them.`
        : `; a first-year started after ${v.freshmanTookIt} of them and an experienced arrival `
          + `after ${v.newcomerTookIt}.`),
    metric: `${v.openings} of ${v.transitions}`,
    evidenceNote: `${plural(v.startersDeparted, 'starter', 'starters')} left the position across `
      + `those changes`,
  });
}

/** 5. How often this position is added to, against its pool. */
function positionIntakeFinding(model) {
  const id = 'position-intake';
  const a = model.summary?.athlete;
  const p = model.pressure?.athletePosition?.historical;
  if (!p || p.suppressed) return refuse(id, 'intake-not-readable');
  if (!p.pool) return refuse(id, 'no-pool-to-compare');
  const noun = String(a?.positionLabel ?? 'this position').toLowerCase();
  const outside = outsideMiddleHalf(p.medianTotalIncoming, p.pool);
  return admit(id, {
    reason: outside ? 'intake-outside-pool-middle-half' : 'intake-inside-pool-middle-half',
    materiality: outside ? 'B' : 'C',
    // A count over recruiting cycles: the sample is the cycles themselves.
    evidence: p.cyclesWithReadableRosterPresence >= 3 ? 'strong'
      : p.cyclesWithReadableRosterPresence >= 2 ? 'moderate' : 'limited',
    text: `This programme added ${p.totalIncomingPerCycle.join(', ')} ${noun}s across `
      + `${plural(p.cyclesWithReadableRosterPresence, 'recruiting cycle', 'recruiting cycles')} — a `
      + `median of ${nfHalf(p.medianTotalIncoming)} against a comparable middle half of `
      + `${middleHalfText(p.pool)}.`,
    metric: nfHalf(p.medianTotalIncoming),
    evidenceNote: `${nf(p.pool.programmes)} comparable programmes · ${p.firstYears} first-years and `
      + `${p.experiencedArrivals} experienced arrivals among them`,
  });
}

/** 6. How far the minutes at this position reach, against its pool. */
function positionMinuteReachFinding(model) {
  const id = 'position-minute-reach';
  const a = model.summary?.athlete;
  const u = model.positionUtilisation?.athletePosition;
  if (!u?.available) return refuse(id, u?.supported === false ? 'not-reported-for-goalkeepers' : 'minute-reach-not-readable');
  const pool = u.pool?.playersWith600Plus;
  if (!pool) return refuse(id, 'no-pool-to-compare');
  const noun = String(a?.positionLabel ?? 'this position').toLowerCase();
  const outside = outsideMiddleHalf(u.medianPlayersWith600Plus, pool);
  return admit(id, {
    reason: outside ? 'minute-reach-outside-pool-middle-half' : 'minute-reach-inside-pool-middle-half',
    materiality: outside ? 'B' : 'C',
    evidence: u.readableSeasons >= 3 ? 'strong' : u.readableSeasons >= 2 ? 'moderate' : 'limited',
    text: `${nfHalf(u.medianPlayersWith600Plus)} ${noun}s reached a ${STARTER_MINUTES}-minute `
      + `season in a typical year out of ${nfHalf(u.medianPlayersWithMinutes)} used, against a `
      + `comparable middle half of ${middleHalfText(pool)}.`,
    metric: nfHalf(u.medianPlayersWith600Plus),
    evidenceNote: `${plural(u.readableSeasons, 'readable season', 'readable seasons')} of `
      + `${u.seasons.length} · ${nf(pool.programmes)} comparable programmes`,
  });
}

/**
 * 7. The origin cohort at this programme.
 *
 * Only where the cohort DESCRIBES THE ATHLETE'S OWN GROUP. A relaxed or refused
 * cohort is not a finding about them — the page states the refusal in full, and
 * that page is in the pathway act at every programme since 13F.
 */
function originFinding(model) {
  const id = 'origin-cohort';
  const o = model.summary?.athlete?.originContext;
  if (!o) return refuse(id, 'not-computed');
  if (o.cohortRefused) return refuse(id, `cohort-refused:${o.cohortRefused}`);
  if (!o.describesRequestedCohort) return refuse(id, 'cohort-does-not-describe-this-athlete');
  const p = o.programme;
  if (!p?.sameOrigin?.share == null || !p?.sameOrigin?.players) return refuse(id, 'no-programme-cohort');
  const evidence = levelOf(o.evidence);
  if (evidence === 'none') return refuse(id, 'evidence-insufficient');
  const group = o.requestedOrigin === 'international' ? 'from outside the United States'
    : 'from within the United States';
  const other = p.otherOrigin;
  const gap = other?.share == null ? null : (p.sameOrigin.share - other.share) * 100;
  const departs = gap != null && Math.abs(gap) >= STEP_POINTS;
  return admit(id, {
    reason: departs ? 'origin-groups-differ-at-this-programme' : 'origin-cohort-readable',
    materiality: departs ? 'B' : 'C',
    evidence,
    text: `${p.sameOrigin.starters} of the ${p.sameOrigin.players} first-years arriving here `
      + `${group} reached a ${STARTER_MINUTES}-minute season`
      + (other?.players ? `, against ${other.starters} of ${other.players} in the other group.` : '.'),
    metric: `${p.sameOrigin.starters} of ${p.sameOrigin.players}`,
    evidenceNote: 'every position, not only this one · origin is grouped only as within or outside '
      + 'the United States',
  });
}

/**
 * 8. The level. A division change inside the window means the position pool
 * comparisons above straddle two sets of programmes.
 */
function competitiveStructureFinding(model) {
  const id = 'competitive-structure';
  const pkg = model.competitive;
  if (!pkg?.available) return refuse(id, 'no-competitive-package');
  const change = (pkg.structuralFacts ?? []).find((f) => f.kind === 'DIVISION_CHANGE');
  if (!change) return refuse(id, 'no-division-change-in-window');
  return admit(id, {
    reason: 'division-change-in-window',
    materiality: 'A',
    evidence: 'record',
    // The frozen structural sentence, verbatim, plus what it means here.
    text: `${change.text} Every comparison at your position in this report is scoped to a `
      + 'division, so the seasons either side of that are read against different sets of '
      + 'programmes.',
    metric: change.seasons.join('–'),
    evidenceNote: `conference on file for ${pkg.coverage.membershipKnown} of `
      + `${pkg.coverage.readableSeasons} measured seasons`,
  });
}

/**
 * 9. Whose record this is. Only the case that reframes the whole window — none
 * or one measured season under the current coach, or an interim. Every other
 * case belongs to the programme snapshot, where it already is.
 */
function coachFinding(model, coach) {
  const id = 'coach-attribution';
  if (!coach || coach.prominence !== PROMINENCE.PROMINENT || !coach.banner) {
    return refuse(id, coach ? `not-prominent:${coach.prominence}` : 'no-coach-attribution');
  }
  return admit(id, {
    reason: coach.interim ? 'interim-head-coach' : 'window-not-under-current-coach',
    materiality: 'A',
    evidence: 'record',
    // Page-independent: this finding is ranked, so it may be drawn first or
    // fifth, and "described above" was true only some of the time.
    text: `${coach.banner} The pathway this report describes at your position is this programme's `
      + 'record; it describes a coaching context other than the current one.',
    metric: `${coach.attributed ?? 0} of ${coach.measured ?? 0} seasons`,
    evidenceNote: coach.predecessor
      ? `${coach.predecessor.name} is the named coach on file for the other measured seasons`
      : 'from the coach record on file',
  });
}

/**
 * 10. Programme development, as context and a pointer.
 *
 * CLASS D DELIBERATELY. It is a programme-wide figure, it is already a
 * programme finding one page later and has a page of its own, and 13E found it
 * on four surfaces at once. It enters the athlete layer only where there is
 * room, which is where there is little else to say.
 */
function developmentFinding(model) {
  const id = 'programme-development';
  const d = model.lifecycle?.development;
  if (!d?.minutesCoverage?.readable) return refuse(id, 'minutes-not-readable');
  const ever = d.everStarter;
  if (ever?.share == null) return refuse(id, 'no-headline-metric');
  const later = d.byYear?.[2]?.share ?? d.byYear?.[1]?.share ?? null;
  const first = d.byYear?.[0]?.share ?? null;
  const grows = first != null && later != null && later > first;
  return admit(id, {
    reason: 'programme-development-context',
    materiality: 'D',
    evidence: 'record',
    text: `Across the whole squad rather than this position, ${ever.reached} of ${ever.denominator} `
      + `measurable first-years have reached a ${STARTER_MINUTES}-minute season here`
      + (grows
        ? `, and the share doing so rises from ${pc(first)} in a first season to ${pc(later)} by a third.`
        : '.'),
    metric: pc(ever.share),
    evidenceNote: `${d.minutesCoverage.measured} of ${d.minutesCoverage.playerSeasons} first-year `
      + 'seasons carry published minutes',
  });
}

/**
 * 11. Traced movement at this position. Class D, and only where the position's
 * own sample cleared its gate — never where it fell back to the programme-wide
 * group, because that is not a fact about this position.
 */
function tracedMovementFinding(model) {
  const id = 'traced-position-movement';
  const p = model.lifecycle?.athletePosition;
  if (!p) return refuse(id, 'not-computed');
  if (p.group !== 'position') return refuse(id, 'position-sample-below-gate');
  if (!p.atPositionObserved) return refuse(id, 'none-traced-at-position');
  const noun = String(model.summary?.athlete?.positionLabel ?? 'this position').toLowerCase();
  return admit(id, {
    reason: 'position-sample-cleared-its-gate',
    materiality: 'D',
    evidence: 'limited',
    text: `${p.atPositionObserved} of ${p.atPositionDepartures} ${noun}s who left this programme `
      + 'appear on another roster the following season.',
    metric: `${p.atPositionObserved} of ${p.atPositionDepartures}`,
    evidenceNote: 'a traced move is a name on another roster, not a reason for leaving',
  });
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** Every candidate, eligible or not, with its reason. */
export function athleteDecisionCandidates(model) {
  if (!model?.summary?.athlete) return [];
  const coach = model.coachContext
    ?? coachContextFor(model.coachAttribution, { division: model.college?.division });
  return [
    positionDepthFinding(model),
    positionArrivalRelianceFinding(model),
    positionFirstYearFinding(model),
    positionOpeningFinding(model),
    positionIntakeFinding(model),
    positionMinuteReachFinding(model),
    originFinding(model),
    competitiveStructureFinding(model),
    coachFinding(model, coach),
    developmentFinding(model),
    tracedMovementFinding(model),
  ];
}

/**
 * The ranked, selected athlete findings, and every candidate considered.
 *
 * All A and B; C to fill to six; D only while fewer than three have been taken.
 * Nothing is padded and no absence is admitted — a sparse programme returns two
 * findings, and the pathway page's own "what this record can be read for /
 * what it cannot yet be read for" block carries the rest.
 */
export function athleteDecisionFindings(model) {
  const considered = athleteDecisionCandidates(model);
  const ranked = considered
    .filter((c) => c.eligible)
    .sort((a, b) => CLASS_RANK.get(a.priority) - CLASS_RANK.get(b.priority)
      || EVIDENCE_RANK.get(b.evidence) - EVIDENCE_RANK.get(a.evidence)
      || RANK.get(a.category) - RANK.get(b.category));

  const chosen = [];
  for (const c of ranked) {
    if (chosen.length >= MAX_FINDINGS) break;
    if (c.priority === 'D' && chosen.length >= FILL_TO) continue;
    chosen.push(c);
  }
  chosen.forEach((c, i) => { c.rank = i + 1; c.rendered = true; });
  let n = chosen.length;
  for (const c of ranked) if (!c.rendered) { n += 1; c.rank = n; }
  return { findings: chosen, considered };
}

/**
 * The inputs that actually shape this report, and only those.
 *
 * NOT A PROFILE. `nationality` is carried on the model and used nowhere — the
 * analysis folds origin to within or outside the United States and says so —
 * and `level` is carried and used nowhere at all. Showing either would tell a
 * reader their nationality or their rating shaped a figure that neither
 * touched.
 */
export function athleteInputStrip(model) {
  const a = model.summary?.athlete;
  if (!a) return [];
  const origin = model.athlete?.origin === 'international'
    ? 'Outside the United States' : model.athlete?.origin === 'domestic'
      ? 'Within the United States' : null;
  return [
    ['Position', a.positionLabel ?? null],
    ['Entry year', a.entrySeason ?? null],
    ['Origin group', origin],
    ['Sport', model.college?.sport === 'womens-soccer' ? 'Women’s soccer' : 'Men’s soccer'],
  ].filter(([, v]) => v != null);
}

/** What the report measures, and what it does not. Stated once. */
export const SCOPE_STATEMENT = 'This report describes the football environment this programme’s '
  + 'record can be measured for: who has played, when places have opened and who took them. It '
  + 'does not assess academic fit, cost, choice of major, campus preference or the institution — '
  + 'none of those is in the data behind it.';
