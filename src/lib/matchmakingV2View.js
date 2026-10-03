import { refusalPhrase, layerLabel } from '@shared/matching/v2/explain/vocabulary.js';

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

export const LAYER_KEYS = Object.freeze(['recruitability', 'financial', 'opportunity']);

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
    staleness: stalenessView(staleness ?? payload.staleness),
  };
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
