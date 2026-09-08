/**
 * COMPETITIVE INTELLIGENCE V1 — the data package, and the contract that binds it.
 *
 * Phase 12F renders from this and from nothing else. There is no page here, no
 * geometry, no font and no column width: a field is either in this object, in
 * which case 12F may draw it under the gate stated beside it, or it is not, in
 * which case no amount of layout makes it renderable.
 *
 * WHY THE CONTRACT LIVES WITH THE DATA. Every previous phase that separated
 * "what we know" from "what we may say" ended up with the second drifting under
 * layout pressure — a figure that was refused by the model appearing on a page
 * because there was room for it. `V1_FIELDS`, `V1_NON_CLAIMS` and
 * `FORBIDDEN_READER_LANGUAGE` are exported from the same module as the numbers,
 * and tests assert them over every sentence the package can produce.
 *
 * WHAT V1 KNOWS, in one sentence: what each programme recorded in each season it
 * can be read for, which conference and division that season was played in, how
 * that season's rate sat among programmes measured in the same division and
 * year, and where the evidence runs out.
 *
 * WHAT V1 DOES NOT KNOW, and will not imply: who anybody played, whether a
 * schedule was hard, whether a conference is strong, where a programme finished,
 * how far it went in a postseason, whether it is getting better, or whether a
 * coach caused any of it.
 */
import { WINDOW, recordString } from '../competitiveHistory.js';
import { COVERAGE_CLASS, coverageClass, structuralHistory as structuralHistoryFrom } from '../conferenceHistory.js';
import { structuralFacts, conferenceRecordFact, FORBIDDEN as FORBIDDEN_STRUCTURAL } from './structuralFacts.js';

/**
 * THE V1 FIELD CONTRACT.
 *
 *   RENDER                     may be drawn wherever it is present
 *   RENDER_WITH_COVERAGE_GATE  may be drawn only with its own denominator
 *                              beside it, and only when the gate passes
 *   INTERNAL_ONLY              in the package for provenance and auditing; it
 *                              may not reach a page in V1
 *   DEFER                      not in V1 at all
 */
export const V1_FIELDS = Object.freeze({
  overallRecord: { verdict: 'RENDER', note: 'W-L-D per season, as every source publishes it' },
  winPercentage: { verdict: 'RENDER', note: 'NCAA winning percentage, (W + D/2) / matches' },
  historicalDivision: { verdict: 'RENDER', note: 'the division that season was played in, or absent' },
  historicalConference: { verdict: 'RENDER', note: 'the conference that season was played in, or absent' },
  conferenceRecord: {
    verdict: 'RENDER_WITH_COVERAGE_GATE',
    gate: 'only where record_status is RECORD_KNOWN; the conference must be named beside it and it may never be compared across conferences',
  },
  seasonBenchmark: {
    verdict: 'RENDER_WITH_COVERAGE_GATE',
    gate: 'only where the season carries an established historical division and the pool clears MIN_POOL; the pool size must be stated in the same sentence',
  },
  structuralConferenceChange: { verdict: 'RENDER', note: 'both seasons stated; no direction implied' },
  structuralDivisionChange: { verdict: 'RENDER', note: 'both divisions stated; never as an improvement or a decline' },
  coachAttributedSeasonCount: {
    verdict: 'RENDER_WITH_COVERAGE_GATE',
    gate: 'a count of seasons and its denominator only; no before/after comparison and no causal framing',
  },
  coverage: { verdict: 'RENDER', note: 'which seasons are established and which are not' },
  refusals: { verdict: 'RENDER', note: 'why a figure is absent, in the words of AB' },
  membershipProvenance: { verdict: 'INTERNAL_ONLY', note: 'which official source established the row' },
  conferenceSize: { verdict: 'INTERNAL_ONLY', note: 'collected, and not a comparison a reader can use in V1' },
  conferenceTableRow: { verdict: 'INTERNAL_ONLY', note: 'the row as printed. NOT a finish — the PSAC prints East then West' },
  seed: { verdict: 'INTERNAL_ONLY', note: 'the conference’s own notation, kept as evidence' },
  conferenceFinish: { verdict: 'DEFER', note: 'needs the pod structure parsed; not proven safe' },
  postseasonDepth: { verdict: 'DEFER', note: '54 raw titles collected in 12C; no normalisation is safe yet' },
  scheduleStrength: { verdict: 'DEFER', note: 'rejected in 12A and never reopened' },
  opponentStrength: { verdict: 'DEFER', note: 'rejected in 12A and never reopened' },
  goalsForAgainst: { verdict: 'DEFER', note: 'collected in the 12C proof only, at 87.5% and quarantine-gated' },
});

/**
 * THE FROZEN NON-CLAIMS. V1 makes none of these, at any coverage level.
 *
 * They are listed rather than described because each one is a sentence somebody
 * will eventually want to write, and the list is what makes refusing it a
 * decision already taken rather than an argument to be had again.
 */
export const V1_NON_CLAIMS = Object.freeze([
  'an overall competitive score',
  'a good/bad or strong/weak label for a programme',
  'a rising or falling characterisation',
  'an improving or declining badge',
  'any prediction of future results',
  'any causal attribution of results to a coach',
  'any schedule-strength claim',
  'any opponent-strength claim',
  'any stronger/similar/weaker opponent analysis',
  'any comparison of one conference’s quality with another’s',
  'any conference finish or standing position',
  'any postseason depth claim',
  'any use of the current rating, ranking or soccer_score as historical evidence',
  'any implication that moving division is an improvement or a decline',
]);

/**
 * Words the reader-facing text may not contain, in any V1 sentence.
 *
 * Inflection-bounded, for the reason 12B.1 recorded: a bare prefix match on
 * `\bstrong` flags Strongsville and a bare `\brise` flags Risen. This extends
 * `structuralFacts.FORBIDDEN` to the whole competitive vocabulary.
 */
const FAMILIES = [
  'improv(?:e|es|ed|ing|ement)', 'declin(?:e|es|ed|ing)', 'dominat(?:e|es|ed|ing|ion)',
  'strugg(?:le|les|led|ling)', 'thriv(?:e|es|ed|ing)', 'promot(?:e|es|ed|ing|ion)',
  'relegat(?:e|es|ed|ing|ion)', 'elevat(?:e|es|ed|ing|ion)', 'upgrad(?:e|es|ed|ing)',
  'downgrad(?:e|es|ed|ing)',
];
const WHOLE = [
  'elite', 'weak', 'weaker', 'weakest', 'strong', 'stronger', 'strongest',
  'dominant', 'rising', 'falling', 'better', 'worse', 'best', 'worst',
  'tough', 'tougher', 'easy', 'easier', 'soft', 'softer',
  'successful', 'unsuccessful', 'success', 'failure',
  'top-tier', 'lower-tier', 'powerhouse', 'perennial',
  'rose', 'fell', 'stepped up', 'moved up', 'moved down', 'dropped down',
  'got worse', 'got better', 'on the up', 'trending',
];
export const FORBIDDEN_READER_LANGUAGE = new RegExp(
  `(?:\\b(?:${FAMILIES.join('|')})\\b)|(?:\\b(?:${WHOLE.map((w) => w.replace(/ /g, '\\s+')).join('|')})\\b)`,
  'i',
);

/**
 * The sentences that state an absence.
 *
 * MISSING EVIDENCE MUST NOT SOUND LIKE NEGATIVE EVIDENCE. "No conference record
 * available" reads, to a family, like a programme that did badly. Each of these
 * says what could not be established and what would establish it, and none of
 * them says anything about the programme.
 */
export const COVERAGE_SENTENCES = Object.freeze({
  CONFERENCE_UNKNOWN: (season) => `Historical conference membership could not be established for ${season}.`,
  DIVISION_UNKNOWN: (season) => `Competitive benchmark unavailable for ${season} because the division the programme played in that season could not be established.`,
  RECORD_UNAVAILABLE: (season, conference) => `Conference record for ${season} is not available from the verified source${conference ? ` for the ${conference}` : ''}.`,
  SEASON_NOT_READABLE: (season) => `The ${season} season is not readable: the programme's own roster records more appearances than the season's record accounts for.`,
  SEASON_ABSENT: (season) => `No win/draw/loss record is on file for ${season}.`,
  POOL_TOO_SMALL: (season, n) => `Competitive benchmark unavailable for ${season}: only ${n} programmes in that division and season are measured, which is too few to quote a position from.`,
  WINDOW_PARTIAL: (n) => `Conference membership is established for ${n === 1 ? 'one' : n} of the four seasons measured.`,
});

/**
 * HOW V1 MAY REFERENCE COACH ATTRIBUTION, and it may not change it.
 *
 * A COUNT AND ITS DENOMINATOR. "Three of the four measured competitive seasons
 * were recorded during seasons attributed to the current coach" is a statement
 * about which seasons the attribution model placed, and a reader can check it
 * against the seasons listed. Naming the seasons is equally allowed.
 *
 * WHAT IS NOT ALLOWED, and the reason is not tone. Splitting the record into
 * before and after a coach's arrival and putting the two side by side is a
 * causal claim whatever words surround it: the reader will read the difference
 * as the coach's effect, and nothing in this data can support that. Four
 * seasons cannot separate a coach from a recruiting class, a conference move, a
 * schedule, or chance.
 */
export const COACH_INTEGRATION = Object.freeze({
  allowed: [
    'the number of measured competitive seasons attributed to the current coach, with its denominator',
    'which seasons those are, by year',
    'the aggregate record across those seasons, stated as a summary of seasons and carrying the seasons it covers',
  ],
  refused: [
    'any before/after split of the record around a coach’s arrival',
    'any statement that a coach improved, changed, lifted or damaged the programme',
    'any comparison of one coach’s seasons with another’s',
    'any per-coach rate presented as a coach’s rate rather than as those seasons’ rate',
  ],
});

const seasonRefusals = (season, entry) => {
  const out = [];
  if (!entry.historicalConference) out.push({ season, kind: 'CONFERENCE_UNKNOWN', text: COVERAGE_SENTENCES.CONFERENCE_UNKNOWN(season) });
  if (!entry.historicalDivision) out.push({ season, kind: 'DIVISION_UNKNOWN', text: COVERAGE_SENTENCES.DIVISION_UNKNOWN(season) });
  else if (entry.benchmark && entry.benchmark.available === false) {
    out.push(entry.benchmark.n != null && entry.benchmark.n > 0
      ? { season, kind: 'POOL_TOO_SMALL', text: COVERAGE_SENTENCES.POOL_TOO_SMALL(season, entry.benchmark.n) }
      : { season, kind: 'DIVISION_UNKNOWN', text: COVERAGE_SENTENCES.DIVISION_UNKNOWN(season) });
  }
  if (entry.historicalConference && entry.conferenceRecord == null) {
    out.push({ season, kind: 'RECORD_UNAVAILABLE', text: COVERAGE_SENTENCES.RECORD_UNAVAILABLE(season, entry.historicalConference) });
  }
  return out;
};

/**
 * The package.
 *
 * @param history     `competitiveHistory` output — the record and its benchmark
 * @param structural  `structuralHistory` output, or null where nothing was collected
 * @param coach       the coach-attribution model's output, unmodified, or null
 *
 * A SPARSE PROGRAMME GETS A SHORTER PACKAGE, NEVER AN INVENTED ONE. Every
 * aggregate carries the seasons it covers, no gap is interpolated, and where a
 * programme has one season on file `comparisons` is empty rather than filled
 * with a comparison against itself.
 */
export function competitivePackage({ history = null, structural = null, coach = null } = {}) {
  if (!history || !history.readableSeasons) {
    return {
      available: false,
      window: history?.window ?? WINDOW.UNAVAILABLE,
      describes: [],
      seasons: [],
      structuralFacts: [],
      conferenceRecords: [],
      coachContext: null,
      coverage: {
        readableSeasons: 0,
        expectedSeasons: history?.expectedSeasons ?? 4,
        membershipKnown: 0,
        divisionKnown: 0,
        recordKnown: 0,
        classes: {},
      },
      refusals: (history?.missingSeasons ?? []).map((s) => ({ season: s, kind: 'SEASON_ABSENT', text: COVERAGE_SENTENCES.SEASON_ABSENT(s) }))
        .concat((history?.unreadableSeasons ?? []).map((u) => ({ season: u.season, kind: 'SEASON_NOT_READABLE', text: COVERAGE_SENTENCES.SEASON_NOT_READABLE(u.season) }))),
      contract: { fields: V1_FIELDS, nonClaims: V1_NON_CLAIMS },
    };
  }

  // THE PACKAGE IS INTERNALLY CONSISTENT OR IT IS NOTHING. Membership can cover a
  // season whose win/draw/loss record is not readable, and a structural fact
  // citing a season the package does not show would be a page referring to a
  // row that is not on it. So the structural side is narrowed to the seasons the
  // record side established before any fact is derived from it.
  const shown = new Set(history.seasons.map((s) => s.season));
  const narrowed = structural ? {
    ...structural,
    rows: (structural.rows ?? []).filter((r) => shown.has(r.season)),
    conferenceRecords: (structural.conferenceRecords ?? []).filter((r) => shown.has(r.season)),
  } : null;
  const narrowedFacts = narrowed ? structuralHistoryFrom(narrowed.rows) : null;

  const bySeason = new Map((narrowed?.rows ?? []).map((r) => [r.season, r]));
  const recordBySeason = new Map((narrowed?.conferenceRecords ?? []).map((r) => [r.season, r]));

  const seasons = history.seasons.map((s) => {
    const st = bySeason.get(s.season) ?? null;
    const cr = recordBySeason.get(s.season) ?? null;
    const entry = {
      season: s.season,
      overallRecord: recordString(s.wins, s.losses, s.draws),
      wins: s.wins, losses: s.losses, draws: s.draws, matchesPlayed: s.matchesPlayed,
      winPercentage: s.winPercentage,
      historicalDivision: s.historicalDivision ?? null,
      historicalConference: st?.conferenceName ?? null,
      conferenceRecord: cr?.available ? cr.record : null,
      conferenceMatches: cr?.available ? cr.matches : null,
      benchmark: s.benchmark ?? null,
      // INTERNAL_ONLY, and marked as such in the field contract.
      internal: st ? {
        membershipProvenance: st.source?.provenance ?? null,
        conferenceSize: st.conferenceSize ?? null,
        conferenceTableRow: st.conferenceTableRow ?? null,
        conferenceGroup: st.conferenceGroup ?? null,
        seed: st.seed ?? null,
        sourceUrl: st.source?.url ?? null,
      } : null,
    };
    entry.coverageClass = coverageClass({
      conferenceId: st?.conferenceId ?? null,
      seasonConfirmed: !!st,
      conferenceWins: cr?.available ? cr.wins : null,
    });
    return entry;
  });

  const classes = {};
  for (const s of seasons) classes[s.coverageClass] = (classes[s.coverageClass] ?? 0) + 1;

  const refusals = [
    ...history.missingSeasons.map((s) => ({ season: s, kind: 'SEASON_ABSENT', text: COVERAGE_SENTENCES.SEASON_ABSENT(s) })),
    ...history.unreadableSeasons.map((u) => ({ season: u.season, kind: 'SEASON_NOT_READABLE', text: COVERAGE_SENTENCES.SEASON_NOT_READABLE(u.season) })),
    ...seasons.flatMap((s) => seasonRefusals(s.season, s)),
  ].sort((a, b) => a.season - b.season || a.kind.localeCompare(b.kind));

  const membershipKnown = seasons.filter((s) => s.historicalConference).length;
  if (membershipKnown && membershipKnown < 4) {
    refusals.push({ season: null, kind: 'WINDOW_PARTIAL', text: COVERAGE_SENTENCES.WINDOW_PARTIAL(membershipKnown) });
  }

  return {
    available: true,
    window: history.window,
    describes: history.describes,
    seasons,
    summary: history.summary,
    // Facts in sequence. A structural change is two seasons stated, never a direction.
    structuralFacts: narrowedFacts ? structuralFacts(narrowedFacts) : [],
    conferenceRecords: (narrowed?.conferenceRecords ?? []).map(conferenceRecordFact).filter(Boolean),
    coachContext: coach ? {
      currentCoach: history.coach?.currentCoach ?? null,
      competitiveSeasonCount: history.coach?.competitiveSeasonCount ?? null,
      currentCoachCompetitiveSeasonCount: history.coach?.currentCoachCompetitiveSeasonCount ?? null,
      currentCoachCompetitiveSeasons: history.coach?.currentCoachCompetitiveSeasons ?? [],
      unattributedSeasons: history.coach?.unattributedSeasons ?? [],
      integration: COACH_INTEGRATION,
    } : null,
    coverage: {
      readableSeasons: history.readableSeasons,
      expectedSeasons: history.expectedSeasons,
      membershipKnown,
      divisionKnown: seasons.filter((s) => s.historicalDivision).length,
      recordKnown: seasons.filter((s) => s.conferenceRecord).length,
      benchmarkAvailable: seasons.filter((s) => s.benchmark?.available).length,
      classes,
    },
    refusals,
    contract: { fields: V1_FIELDS, nonClaims: V1_NON_CLAIMS },
  };
}

/** Every reader-facing string the package carries, for the language contract test. */
export function readerSentences(pkg) {
  return [
    ...(pkg.structuralFacts ?? []).map((f) => f.text),
    ...(pkg.conferenceRecords ?? []).map((f) => f.text),
    ...(pkg.refusals ?? []).map((r) => r.text),
  ];
}

export { FORBIDDEN_STRUCTURAL, COVERAGE_CLASS };
