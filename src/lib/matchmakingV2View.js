import { refusalPhrase, layerLabel } from '@shared/matching/v2/explain/vocabulary.js';
import { renderReason, CLIENT_UNSAFE } from '@shared/matching/v2/explain/render.js';
import { plainSentence, isFinancialCaveat } from '@/lib/plainReasons';

/**
 * THE VIEW MODEL FOR ONE MATCHMAKING V2 RUN — A9.3 / §U.
 *
 * Pure. No React, no fetch, no dates-since. Everything a V2 surface renders is
 * derived here so that the wording rules below are testable without mounting a
 * component, and so no component has to know the shape of a server response.
 *
 * ===========================================================================
 * WHY THERE IS A NORMALISER AT ALL: TWO SHAPES REACH THIS SCREEN.
 *
 * `POST /api/players/:id/matchmaking` answers with the LIVE service result
 * (`{runId, ...computeMatchmakingV2()}`), and `GET .../runs/current` answers
 * with the PERSISTED one (`readRun()`). They are the same engine facts and
 * they are NOT the same object:
 *
 *   live       unscoreable layer carries `missing: ['playingPathway']`
 *   persisted  it does not — A9.2 stores the reason, not the component list
 *
 *   live       `season`, `timings`
 *   persisted  `inputSnapshot`, schema versions, `contributionState`
 *
 * A9.2's parity is over `resultDigest`, which covers ids, status, rank,
 * pursuit, the three values and the three reasons — not `missing`. So the two
 * payloads agree about every engine fact and disagree about one presentational
 * extra, and a screen that read `missing` straight off a response would show a
 * line of detail immediately after Refresh that VANISHED on the next page
 * load. Same run, same rank, different explanation.
 *
 * So the view model is cut to the PERSISTED contract and both shapes are
 * mapped onto it. `missing` is dropped rather than shown-when-present: the
 * refusal reason is the engine's own statement of what is absent, it is
 * persisted, and it is the same sentence in both payloads.
 * ===========================================================================
 */

/** The accepted bands. Rank decides them; nothing here re-derives a score. */
export const BAND = Object.freeze({
  PRIORITY_OUTREACH: 'PRIORITY_OUTREACH',
  STRONG_PURSUIT: 'STRONG_PURSUIT',
  VIABLE_CONSIDERATION: 'VIABLE_CONSIDERATION',
  BROADER_UNIVERSE: 'BROADER_UNIVERSE',
});

/**
 * Band presentation. `range` is the rank span, printed beside the label so the
 * band reads as a slice of a list rather than as a verdict on a school.
 *
 * `tone` is a Badge variant and is NEVER the only carrier of the band — §S.
 * Every band prints its own words next to the colour, which is also why there
 * is no band whose entire meaning is "red".
 */
export const BAND_PRESENTATION = Object.freeze({
  [BAND.PRIORITY_OUTREACH]: { label: 'Priority outreach', range: '1–25', tone: 'green', order: 0 },
  [BAND.STRONG_PURSUIT]: { label: 'Strong pursuit', range: '26–50', tone: 'blue', order: 1 },
  [BAND.VIABLE_CONSIDERATION]: { label: 'Viable consideration', range: '51–100', tone: 'purple', order: 2 },
  [BAND.BROADER_UNIVERSE]: { label: 'Broader universe', range: '101+', tone: 'muted', order: 3 },
});

export const bandPresentation = (band) => BAND_PRESENTATION[band] ?? null;

export const STATUS = Object.freeze({
  RANKED: 'RANKED',
  SUPPORTED_LIMITED_DATA: 'SUPPORTED_LIMITED_DATA',
  UNSUPPORTED_ASSOCIATION: 'UNSUPPORTED_ASSOCIATION',
});

/**
 * The two non-ranked states, in words — §J and §K.
 *
 * ===========================================================================
 * BOTH SENTENCES ARE ABOUT THRIV3. NEITHER IS ABOUT THE SCHOOL.
 *
 * This is the single most dangerous surface in the V2 frontend. A consultant
 * reading a list of 1,205 programmes will take anything that is not a rank as
 * a demotion unless the screen says otherwise, and the two reasons a programme
 * is not ranked are both admissions of what Thriv3 does not hold:
 *
 *   SUPPORTED_LIMITED_DATA    we model this association and lack the evidence
 *                             to rank THIS programme for THIS athlete
 *   UNSUPPORTED_ASSOCIATION   we do not yet hold the eligibility rules for
 *                             this association at all
 *
 * Neither means a weak programme, a poor fit, or a place the athlete cannot
 * go. `note` is the clause that says so, and it is rendered, not a tooltip.
 * ===========================================================================
 */
export const STATUS_PRESENTATION = Object.freeze({
  [STATUS.SUPPORTED_LIMITED_DATA]: {
    label: 'Not enough evidence to rank',
    tone: 'amber',
    summary: 'Thriv3 matches this association but does not hold enough evidence to rank this programme for this athlete.',
    note: 'This is a gap in Thriv3’s data, not a judgement about the programme or the athlete’s chances there.',
  },
  [STATUS.UNSUPPORTED_ASSOCIATION]: {
    label: 'Association not modelled',
    tone: 'muted',
    summary: 'Thriv3 does not yet hold the eligibility rules required to rank this association.',
    note: 'The athlete can attend these institutions. Thriv3 simply cannot place them in a ranking yet.',
  },
});

export const statusPresentation = (status) => STATUS_PRESENTATION[status] ?? null;

/**
 * WORDING THIS SCREEN MAY NEVER PRODUCE — §L, and it is the engine's rule.
 *
 * A8.2 established that `notable_majors` is PARTIAL POSITIVE EVIDENCE: 321 of
 * 349 D1 women's programmes omit Mathematics, Penn State and Ohio State among
 * them. Absence from that list says nothing about whether a major is offered,
 * which is why the engine returns UNSCOREABLE rather than a measured zero and
 * why `MAJOR_NOT_IN_PARTIAL_EVIDENCE` is phrased as what the list IS.
 *
 * A frontend is one careless summary away from putting the inference back:
 * "Exercise Science not offered" under a refusal is a false claim about a real
 * institution, made by us, in front of a family. These are the spellings that
 * claim it. The test that enforces this walks the exported strings of this
 * module AND renders all three states — a constant is easy to check and easy
 * to bypass, so neither check stands alone.
 */
export const FORBIDDEN_MAJOR_PHRASES = Object.freeze([
  'does not offer',
  'doesn’t offer',
  'doesn\'t offer',
  'not offered',
  'no such major',
  'lacks',
  'does not have this major',
  'major unavailable',
]);

/**
 * The major, as an ACTIVE RANKING PREFERENCE rather than a filter — §L.
 *
 * Returns null when there is no intended major, so the chip is absent rather
 * than reading "Major preference: none" — an athlete who has not stated one is
 * not expressing indifference, and majorFit goes NOT_APPLICABLE for them,
 * costing no coverage at all.
 */
export function majorPreference(player) {
  const major = (player?.intended_major ?? '').trim();
  return major ? { major, label: `Major preference: ${major}` } : null;
}

/* ------------------------------------------------------------------ */
/* Scores                                                              */
/* ------------------------------------------------------------------ */

/**
 * A Pursuit score, as a WHOLE NUMBER out of 100 — §N.
 *
 * ===========================================================================
 * THE PRECISION HERE IS A TRUTH CLAIM, AND A8 MEASURED WHAT IT MAY BE.
 *
 * Hundreds of adjacent ranks differ by less than 0.001. Printing 0.4821 next
 * to 0.4819 invites a consultant to tell a family that one programme beat
 * another, when the gap is smaller than any evidence behind it supports.
 * Rounding to a whole number makes neighbours SHARE a displayed score, which
 * is the honest picture, and `PRECISION_NOTE` says so in the open rather than
 * leaving a reader to wonder why #34 and #35 both read 48.
 *
 * The stored value is untouched. This is a rendering, and ordering is the
 * server's — nothing on this screen ever re-sorts by the rounded number.
 * ===========================================================================
 */
export function scoreOutOf100(value) {
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

export const PRECISION_NOTE = 'Scores are rounded, so programmes close together in the list can show the same number. The ranking order is exact.';

/** Engine grades, in the engine's own words. Not re-labelled, not re-ordered. */
export const GRADE_LABEL = Object.freeze({
  MEASURED: 'Measured',
  PARTIAL: 'Partial evidence',
});

export const gradeLabel = (grade) => GRADE_LABEL[grade] ?? null;

/**
 * One layer, ready to render.
 *
 * `coverage` is reported ONLY when it is short of 1. Full coverage is the
 * ordinary case — it holds on all three layers for most ranked programmes —
 * and a row of "100% coverage" on every card is noise that trains an operator
 * to stop reading the one that says 63%.
 */
export function layerView(key, layer) {
  const label = layerLabel(key);
  if (!layer || layer.state !== 'SCOREABLE') {
    const reason = layer?.reason ?? null;
    return {
      key,
      label,
      scoreable: false,
      score: null,
      grade: null,
      gradeText: null,
      coverage: Number.isFinite(layer?.coverage) ? layer.coverage : null,
      reason,
      /**
       * The ENGINE'S sentence for this refusal, never a frontend paraphrase.
       * `MAJOR_NOT_IN_PARTIAL_EVIDENCE` is the reason this matters: its phrase
       * was written in A8.2 to say what the recorded list covers rather than
       * what it omits, and any re-wording here would be the place the banned
       * inference crept back in.
       */
      phrase: refusalPhrase(reason),
    };
  }
  return {
    key,
    label,
    scoreable: true,
    score: scoreOutOf100(layer.value),
    grade: layer.grade ?? null,
    gradeText: gradeLabel(layer.grade),
    coverage: Number.isFinite(layer.coverage) && layer.coverage < 1 ? layer.coverage : null,
    reason: null,
    phrase: null,
  };
}

/**
 * THE FROZEN LAYER NAMES, RE-EXPORTED THROUGH THIS MODULE — A10 §L.
 *
 * `shared/matching/v2/explain/vocabulary.js` owns the spellings, and the V2
 * import boundary (shared/matching/v2/importGraph.test.js) allows exactly one
 * doorway from `src/` for this kind of frozen vocabulary: this file. A second
 * component importing the vocabulary directly would widen that allowlist for
 * no reason, and retyping "Coach recruitability" would give the product two
 * names for one layer.
 */
export { layerLabel };

/* ------------------------------------------------------------------ */
/* Explanations — A11 §7, §8                                           */
/* ------------------------------------------------------------------ */

/**
 * THE ENGINE'S OWN SENTENCES, THROUGH THE ONE APPROVED DOORWAY.
 *
 * `render.js` turns a reason code and its evidence into English. It lives
 * under `shared/matching/v2/`, which `src/` may not import except through
 * this module — so the explanation surfaces import from here, exactly as they
 * do for the layer labels above.
 *
 * NOTHING IS WRITTEN HERE. Every sentence is the engine's, built from the
 * evidence the scorer recorded. A frontend paraphrase is how a refusal
 * carefully worded in A8.2 turns back into the claim it was written to avoid.
 */

/**
 * Codes the operator register may print and a client register may not.
 *
 * `render.js` names them itself and says why: a gate loss is an instruction to
 * an operator and a bewilderment to a parent, and "no verified athletic-aid
 * rule" sounds like a warning about the school rather than about our records.
 * The audience today is the consultant, so these ARE rendered — but they are
 * marked, so the family-facing register A7.6 deliberately did not build can be
 * built by selecting rather than by remembering.
 */
export const OPERATOR_ONLY_CODES = Object.freeze(new Set(CLIENT_UNSAFE.codes));

export const isOperatorOnly = (reason) => OPERATOR_ONLY_CODES.has(reason?.code);

/**
 * One reason as a sentence, or null when the renderer has no wording for it.
 *
 * A code with no sentence renders NOTHING rather than its own identifier:
 * "POSITION_ARRIVALS_NOT_YET_KNOWN" on screen is worse than silence.
 */
export function reasonSentence(reason) {
  try {
    const text = renderReason(reason);
    return typeof text === 'string' && text.trim() ? text : null;
  } catch {
    return null;
  }
}

/** Reasons in the polarity order a reader wants: strengths, then concerns, then gaps. */
export const POLARITY_ORDER = Object.freeze(['strength', 'concern', 'unknown', 'context']);

export function explanationView(explanation, { layer = null } = {}) {
  if (!explanation) return null;
  const all = layer
    ? (explanation.layerReasons?.[layer] ?? [])
    : (explanation.reasons ?? []);

  const rows = all
    /**
     * `listLevel` reasons are about the whole shortlist, not this programme —
     * "most of this pool is out of reach" is true and unreadable on all 100
     * rows. The engine marks them so a surface can hoist them once; this one
     * drops them from the per-programme view.
     */
    .filter((r) => !r.listLevel)
    .map((r) => ({
      ...r,
      sentence: reasonSentence(r),
      operatorOnly: isOperatorOnly(r),
      /**
       * A11.2 §2. The same reason said without the arithmetic, for the
       * concise summary. Null where no plain wording exists, and the summary
       * then prints the engine's sentence rather than dropping the reason.
       */
      plain: plainSentence(r),
      financialCaveat: isFinancialCaveat(r),
    }))
    .filter((r) => r.sentence);

  rows.sort((a, b) => {
    const pa = POLARITY_ORDER.indexOf(a.polarity);
    const pb = POLARITY_ORDER.indexOf(b.polarity);
    if (pa !== pb) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    return (a.band ?? 99) - (b.band ?? 99) || (a.sub ?? 0) - (b.sub ?? 0);
  });

  return rows;
}

export const LAYER_KEYS = Object.freeze(['recruitability', 'financial', 'opportunity']);

/** How many ranked reasons the concise summary shows before the caveats. */
export const SUMMARY_LIMIT = 3;

/**
 * THE CONCISE ANSWER — A11.2 §1D, §2.
 *
 * ===========================================================================
 * THE LEADING FEW REASONS, PLUS THE ONES THAT MUST NOT BE BURIED.
 *
 * Two different selections, and they are different on purpose:
 *
 *   THE LEADING FEW   `explanationView` has already ordered by polarity and
 *                     band, so the first three are the strongest supported
 *                     statements. Three, because §1D asks for roughly one to
 *                     three and the target is a card a consultant reads in
 *                     about ten seconds.
 *
 *   THE CAVEATS       A financial caveat is usually "context" polarity and
 *                     would sit fourth or lower. "This association does not
 *                     permit athletic scholarships" is not a footnote to a
 *                     family budgeting for four years, so it is hoisted
 *                     rather than ranked — §2 is explicit that financial
 *                     caveats must remain.
 *
 * Caveats keep their own order and follow the leading reasons, so the summary
 * still reads strengths-first rather than opening on a warning.
 *
 * Each row carries `text`, which is the plain wording where one exists and
 * the engine's own sentence otherwise. No reason is ever dropped for having
 * no plain version.
 * ===========================================================================
 */
export function summaryView(explanation, { limit = SUMMARY_LIMIT } = {}) {
  const rows = explanationView(explanation);
  if (!rows) return null;

  const lead = rows.slice(0, limit);
  const taken = new Set(lead);
  const caveats = rows.filter((r) => r.financialCaveat && !taken.has(r));

  return [...lead, ...caveats].map((r) => ({ ...r, text: r.plain ?? r.sentence }));
}

/* ------------------------------------------------------------------ */
/* Programmes                                                          */
/* ------------------------------------------------------------------ */

/**
 * One programme, from either payload shape, as the card consumes it.
 *
 * `missing` is deliberately not carried — see the module note. Everything here
 * exists in BOTH the live and the persisted response.
 */
export function programmeView(p) {
  const ranked = p.status === STATUS.RANKED;
  return {
    programmeId: p.programmeId ?? null,
    name: p.name,
    division: p.division ?? null,
    status: p.status,
    universe: p.universe,
    ranked,
    rank: ranked ? p.rank : null,
    band: ranked ? (p.band ?? null) : null,
    pursuit: ranked ? scoreOutOf100(p.pursuit) : null,
    pursuitGrade: ranked ? (p.pursuitGrade ?? null) : null,
    pursuitGradeText: ranked ? gradeLabel(p.pursuitGrade) : null,
    layers: LAYER_KEYS.map((k) => layerView(k, p[k])),
    /**
     * Which layers could not be scored. Present on non-ranked programmes in
     * both payloads; derived for a ranked one, where it is always empty by
     * construction (a programme with an unscoreable layer cannot be ranked).
     */
    missingLayers: ranked ? [] : (p.missingLayers ?? []),
  };
}

/* ------------------------------------------------------------------ */
/* Scopes                                                              */
/* ------------------------------------------------------------------ */

export const SCOPE = Object.freeze({ TOP_100: 'TOP_100', FULL_UNIVERSE: 'FULL_UNIVERSE' });

export const SCOPE_LABEL = Object.freeze({
  [SCOPE.TOP_100]: 'Top 100',
  [SCOPE.FULL_UNIVERSE]: 'Full universe',
});

/**
 * The Top 100 as a PREFIX of the one ordering — never a second list.
 *
 * `rank <= 100` rather than `slice(0, 100)`: the two agree today and they stop
 * agreeing the moment anything upstream changes what a non-ranked programme
 * sorts as, and the rank is what the band is defined on. Mirrors
 * `topSlice()` in the service, which is the same decision on the server.
 */
export function scopeProgrammes(programmes, scope) {
  if (scope === SCOPE.TOP_100) return programmes.filter((p) => p.ranked && p.rank <= 100);
  return programmes;
}

/* ------------------------------------------------------------------ */
/* Staleness                                                           */
/* ------------------------------------------------------------------ */

/**
 * Machine reasons, in operator language — §D.
 *
 * Three independent facts, never collapsed into one sentence, because the
 * response differs: an input change is the operator's own edit, a corpus
 * change is new evidence arriving, and an engine change is a freeze that
 * moved. No digest, no SHA, no schema version reaches this screen — §O.
 */
export const STALE_REASON_TEXT = Object.freeze({
  PLAYER_INPUT_CHANGED: 'The athlete’s profile changed after these matches were generated.',
  CORPUS_CHANGED: 'Thriv3’s recruiting data has been updated since these matches were generated.',
  ENGINE_CHANGED: 'The matcher has been updated since these matches were generated.',
  NO_RUN: 'No matches have been generated for this athlete yet.',
});

export function stalenessView(staleness) {
  if (!staleness) return { current: true, reasons: [] };
  return {
    current: !!staleness.current,
    reasons: (staleness.reasons ?? [])
      .map((code) => ({ code, text: STALE_REASON_TEXT[code] ?? null }))
      /** An unrecognised code is dropped rather than printed raw — §O. */
      .filter((r) => r.text),
  };
}

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

/**
 * A whole run, from either payload, plus its staleness.
 *
 * `counts` comes from the run rather than from counting the array: the server
 * wrote those numbers alongside the rows inside one transaction, and a screen
 * that recounted could disagree with the record it is displaying.
 */
export function runView(payload, { staleness = null } = {}) {
  if (!payload) return null;
  const programmes = (payload.programmes ?? []).map(programmeView);
  return {
    runId: payload.runId ?? null,
    computedAt: payload.computedAt ?? null,
    matcherVersion: payload.matcherVersion ?? null,
    sport: payload.sport ?? null,
    counts: payload.counts ?? null,
    programmes,
    /**
     * The preference fields this run was computed from — §O. Absent on a
     * live POST body, which carries no `inputSnapshot`; the screen then simply
     * marks nothing as changed, which is true: a run computed a moment ago was
     * computed from what is on the profile now.
     */
    inputs: runInputs(payload.inputSnapshot),
    staleness: stalenessView(staleness ?? payload.staleness),
  };
}

/* ------------------------------------------------------------------ */
/* The inputs this run was computed from — A9.4 §O                     */
/* ------------------------------------------------------------------ */

/**
 * THE PREFERENCE FIELDS A RUN CARRIES FORWARD, AND ONLY THOSE.
 *
 * ===========================================================================
 * A9.3 DROPPED THE WHOLE SNAPSHOT. THIS PUTS BACK NAMED FIELDS, NOT THE
 * SNAPSHOT.
 *
 * `inputSnapshot` holds all twenty matchmaking inputs, including `gpa`,
 * `sat_score`, `act_score`, `state` and `nationality`. None of those is
 * needed to answer the question §O asks — "is what I am looking at still
 * what this ranking was built from?" — and carrying them to a screen that
 * does not show them is how a payload becomes a place person-level data
 * accumulates unnoticed.
 *
 * So the view model picks the fields the preference summary actually
 * renders. The privacy assertion in the view-model tests was not removed when
 * this arrived; it was narrowed to name the fields that must still never
 * appear, which is a sharper check than the one it replaced.
 *
 * Compared RAW, deliberately. `inputDigest` hashes raw values, so "exercise
 * science" -> "Exercise Science" makes the run stale; a comparison here that
 * normalised case would show no change beside a run the server correctly
 * calls outdated, and the screen would be arguing with itself.
 * ===========================================================================
 */
export const RUN_INPUT_FIELDS = Object.freeze([
  'intended_major',
  'competitive_level_priority',
  'playing_opportunity_priority',
  'academic_strength_priority',
  'contribution_state',
  'max_annual_contribution_usd',
  /**
   * The position and the recruitment preferences, which the bar now shows.
   * None of them is person-level contact data; `state`, `nationality` and the
   * test scores stay off this list.
   */
  'position',
  'academic_minimum',
  'preferred_states',
  'preferred_regions',
  'preferred_divisions',
  'preferred_conferences',
  'preferred_institution_types',
]);

/** Lists whose order means nothing; compared sorted, and empty reads as unanswered. */
const LIST_INPUTS = new Set([
  'preferred_states', 'preferred_regions', 'preferred_divisions', 'preferred_conferences', 'preferred_institution_types',
]);

function comparable(field, value) {
  if (!LIST_INPUTS.has(field)) return value ?? null;
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (!Array.isArray(v) || v.length === 0) return null;
  return JSON.stringify([...new Set(v.map(String))].sort());
}

/**
 * The shown fields, off a persisted snapshot. Null when a run carries none.
 *
 * A field the snapshot never RECORDED is carried as `undefined`: a run from
 * before the recruitment preferences existed has no opinion about them, and a
 * field it never held must not read as "changed" beside it.
 */
export function runInputs(snapshot) {
  if (!snapshot) return null;
  const out = {};
  for (const f of RUN_INPUT_FIELDS) {
    // `undefined`, not null: "this run never recorded it" is not "it was unanswered".
    out[f] = Object.prototype.hasOwnProperty.call(snapshot, f) ? (snapshot[f] ?? null) : undefined;
  }
  return out;
}

/**
 * Which of those have moved since the run was computed.
 *
 * A Set of field names, so a surface marks the field that changed rather than
 * printing a diff. Empty when nothing moved, and empty when the run carries no
 * snapshot at all — an unknown is not a change, and marking every field on a
 * run that simply predates this would be a screen inventing history.
 */
export function changedSinceRun(player, inputs) {
  const changed = new Set();
  if (!player || !inputs) return changed;
  for (const f of RUN_INPUT_FIELDS) {
    if (inputs[f] === undefined) continue;
    if (comparable(f, player[f]) !== comparable(f, inputs[f])) changed.add(f);
  }
  return changed;
}

/** "3 October 2026 at 17:04" — a time an operator can repeat, in their locale. */
export function generatedAtText(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
