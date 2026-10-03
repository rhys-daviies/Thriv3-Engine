/**
 * The factual evidence a BLIND reviewer needs, and nothing else.
 *
 * -- WHY THIS MODULE EXISTS ------------------------------------------------
 *
 * The first human review could not answer three of its own reason codes.
 * View A asked "is there a strong roster opportunity here?" while showing no
 * roster at all, and the reviewer marked "insufficient roster data" on every
 * one of 43 programmes - which is a defect in the instrument, not a finding
 * about the model.
 *
 * -- THE RULE ---------------------------------------------------------------
 *
 * EVIDENCE, NEVER THE ANSWER. Every field here is a count, a state, or a
 * published attribute. Nothing derived from a scorer appears: no positional
 * opportunity value, no market-match value, no recruitability, no coverage
 * number, no grade, no reason code. A reviewer who could reconstruct the
 * model's conclusion from View A is no longer reviewing it blind.
 *
 * The states are deliberately the same words the layer uses - FULL, PARTIAL,
 * INSUFFICIENT - because the reviewer is entitled to know how much of the
 * question Thriv3 could answer, which is a fact about our data rather than a
 * judgement about the programme.
 */
import { isScoreable } from '../../../shared/matching/v2/index.js';
import { positionEvidence, starterState, STARTER_STATE } from './rosterEvidence.js';
import { athleteDistanceKm, homeState } from './recruitingMarketEvidence.js';

const EVIDENCE = { FULL: 'FULL', PARTIAL: 'PARTIAL', INSUFFICIENT: 'INSUFFICIENT', UNKNOWN: 'UNKNOWN' };

/** Class years at the position, as counts. Context a coach would read off a roster. */
function classBreakdown(roster, programme, position) {
  const out = {};
  for (const r of roster ?? []) {
    if (r.college_name !== programme) continue;
    const label = (r.class_year_label || 'unreadable').trim();
    out[label] = (out[label] || 0) + 1;
  }
  return out;
}

export function buildValidationFacts({
  colleges, ctx, sport, position, entryYear, athleteState, athleteIsInternational,
  academicScale,
}) {
  const facts = new Map();
  for (const college of colleges) {
    const ev = positionEvidence({
      programme: college.name, position, sport, division: college.division,
      entryYear, rosterIndex: ctx.rosterIndex, arrivalIndex: ctx.arrivalIndex,
      arrivalsHorizon: ctx.arrivalsHorizon,
    });
    const se = ev.starterEvidence ?? {};
    const departingKnown = (se.departing ?? 0) - (se.departingUnknown ?? 0);

    /**
     * The three states the positional layer itself distinguishes, described
     * as coverage rather than as a conclusion.
     */
    const state = !ev.rosterOnFile ? EVIDENCE.INSUFFICIENT
      : !ev.eligibilityRuled ? EVIDENCE.INSUFFICIENT
        : !ev.positionRows ? EVIDENCE.INSUFFICIENT
          : (se.departing ?? 0) === 0 ? EVIDENCE.FULL
            : departingKnown === 0 ? EVIDENCE.INSUFFICIENT
              : (se.departingUnknown ?? 0) > 0 ? EVIDENCE.PARTIAL : EVIDENCE.FULL;

    const roster = {
      position,
      entryYear,
      positionalRosterCount: ev.positionRows ?? 0,
      classYears: classBreakdown(ctx.roster, college.name, position),
      departingBeforeEntryYear: ev.openings ?? 0,
      eligibleToRemain: ev.eligibleToRemain ?? 0,
      identifiableDepartingStarters: ev.vacatedStarters ?? 0,
      departingPlayersUnplaceable: se.departingUnknown ?? 0,
      arrivalsAtPosition: ev.arrivalsApplicable === false ? null : ev.arrivals,
      arrivalsRecordedTo: ev.arrivalsHorizon ?? null,
      evidenceState: state,
      rosterOnFile: Boolean(ev.rosterOnFile),
      eligibilityRuleOnFile: Boolean(ev.eligibilityRuled),
    };

    /** Recruiting market: counts and a factual description of the footprint. */
    const prog = ctx.marketIndex?.programmes?.get(college.name) ?? null;
    let market = { evidenceState: EVIDENCE.INSUFFICIENT, recentArrivals: prog?.arrivals ?? 0 };
    if (prog && prog.arrivals >= 8) {
      if (athleteIsInternational) {
        market = {
          evidenceState: EVIDENCE.FULL,
          recentArrivals: prog.arrivals,
          internationalArrivals: prog.international,
          /** A DESCRIPTION, from the counts. Never the component's value. */
          describedAs: prog.international / prog.arrivals >= 0.25 ? 'recruits internationally in numbers'
            : prog.international / prog.arrivals >= 0.08 ? 'recruits some international players'
              : 'few recent international recruits',
        };
      } else {
        const dist = athleteDistanceKm({ athleteState, college, centroids: ctx.centroids });
        const placed = prog.domesticWithGeo ?? 0;
        market = placed >= 3 ? {
          evidenceState: EVIDENCE.FULL,
          recentArrivals: prog.arrivals,
          domesticRecruitsPlaced: placed,
          recruitsWithin300km: prog.near,
          describedAs: prog.near / placed >= 0.6 ? 'recruits mostly locally'
            : prog.near / placed <= 0.35 ? 'recruits across a broad area' : 'recruits regionally',
          athleteDistanceKm: dist === null ? null : Math.round(dist),
        } : { evidenceState: EVIDENCE.INSUFFICIENT, recentArrivals: prog.arrivals };
      }
    }

    /** International utilisation, as the two shares and the sample. */
    const u = ctx.utilisation?.get(college.name) ?? null;
    if (u && u.rosterRows >= 15 && u.totalMinutes > 0) {
      market.internationalRosterShare = Number((u.internationalRows / u.rosterRows).toFixed(2));
      market.internationalMinutesShare = Number((u.internationalMinutes / u.totalMinutes).toFixed(2));
      market.utilisationSampleRosterRows = u.rosterRows;
    }

    const pct = academicScale
      ? academicScale(college.academic_rating, college.academic_rating_source) : null;
    facts.set(college.id, {
      roster,
      market,
      academic: {
        rating: pct === null ? null : college.academic_rating,
        relativeStanding: pct === null ? null
          : pct >= 0.8 ? 'among the strongest in this pool'
            : pct >= 0.6 ? 'above average for this pool'
              : pct >= 0.4 ? 'around the middle of this pool'
                : pct >= 0.2 ? 'below average for this pool' : 'among the weaker in this pool',
        evidenceState: pct === null ? EVIDENCE.UNKNOWN : EVIDENCE.FULL,
      },
    });
  }
  return facts;
}

export { EVIDENCE };
