/**
 * The freshman-minutes intelligence, as evidence.
 *
 * A TRANSLATION LAYER and nothing else. Every number below is lifted from a
 * result `shared/freshmanMinutes.js` and `shared/philosophy.js` already
 * produced; this file computes no shares, no medians and no verdicts. That is
 * the whole point of it existing separately from generate.js: the moment a
 * ladder is recomputed here, there are two answers to one question and the
 * report and the evidence can disagree about a programme.
 *
 * It makes no calls of its own at all: the philosophy result and the pool
 * benchmarks are computed once, server-side, and handed in on the context the
 * same way the recruiting patterns already are. A fourth kind — the ladder
 * narrowed to the athlete's cohort — is deliberately absent, and the reason is
 * recorded in full further down.
 *
 * WHAT THESE MAY BE USED FOR
 *
 * Operator inspection, qualified by the window they were measured over. Nothing
 * else. All three are `emailEligible: false` and MATCHING_SUMMARY DENIED in the
 * registry, so selection separates them before composition can see them and no
 * surface but the operator panel may render them.
 *
 * The distinction being protected is the one the source module was written
 * around: these describe seasons that happened. "Across the four seasons we can
 * read, the best first-year defender took a median of 812 minutes" is a
 * measurement. "This programme develops defenders" is a forecast, and no
 * roster row supports it. The registry's QUALIFIED grade is what stops a
 * renderer showing the first without the clause that makes it the first.
 */

import { defineEvidence, CONFIDENCE } from './kinds.js';

/**
 * The measured window, in the source module's own readability semantics.
 *
 * `profile.seasons` are the seasons that passed `MIN_MEASURED_SHARE` — read AND
 * usable. `profile.unreadableSeasons` are the seasons that had an intake and
 * too few recorded minutes to rank: attempted and not usable, which is exactly
 * what `seasonsUnread` means and is a distinction almost nothing else in the
 * codebase can make.
 *
 * A season the programme simply has no rows for appears in NEITHER list, and
 * that is the important part. `freshmanProfile` only ever reports a season as
 * unreadable when `intake > 0`, so an absent season cannot be promoted into a
 * failed read — which is how Marywood's three blank seasons became one of the
 * largest regime changes in the pool the last time the two were conflated.
 */
function windowFrom(profile, { n = null, cohort = null } = {}) {
  if (!profile) return null;
  const seasons = (profile.seasons ?? []).map((s) => String(s.season));
  const unread = (profile.unreadableSeasons ?? []).map(String);
  if (!seasons.length && !unread.length) return null;
  return { seasons, seasonsUnread: unread, n, cohort };
}

/** First-year players behind a profile — the sample the cohort floor counts. */
const playersIn = (profile) => (profile?.seasons ?? [])
  .reduce((sum, s) => sum + (Number(s.intake) || 0), 0);

/**
 * How firmly a freshman-minutes reading may be stated.
 *
 * Mirrors the source module's own sufficiency rules rather than inventing a
 * scale: `classifyProgramme` refuses to judge below MIN_COHORT_SEASONS, and
 * `freshmanProfile` reports a cohort as `thin` below MIN_COHORT_PLAYERS. A
 * profile the source calls thin is not one this layer should call HIGH.
 */
function confidenceFor(profile) {
  if (!profile) return CONFIDENCE.LOW;
  if (profile.cohort?.thin) return CONFIDENCE.LOW;
  const seasons = profile.seasonsObserved ?? 0;
  const unread = (profile.unreadableSeasons ?? []).length;
  if (seasons >= 3 && unread === 0) return CONFIDENCE.HIGH;
  if (seasons >= 2) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW;
}

/**
 * How first-year minutes behaved across the seasons we can read.
 *
 * The verdict KEY is carried in `data` and is not the claim. `steady` and
 * `regime-change` are the classifier's vocabulary for a report to reason with;
 * what a reader may be shown is the measurement underneath — the per-season
 * shares, the seasons observed, and the seasons we could not read.
 */
export function programmeDevelopmentPattern(athlete, ctx) {
  const ph = ctx?.philosophy;
  const profile = ph?.freshman;
  const verdict = ph?.verdict;
  if (!profile || !verdict) return null;
  // The source refuses to classify this one, and a refusal is not a finding.
  if (verdict.verdict === 'too-few-seasons') return null;

  return defineEvidence('PROGRAMME_DEVELOPMENT_PATTERN', {
    confidence: confidenceFor(profile),
    season: (ph.describes ?? []).join(', ') || null,
    source: 'roster_players:freshman-minutes',
    // One observation is one MEASURED SEASON here, because that is the unit the
    // classifier compares: it reads the spread and step between season shares.
    // The player count is carried in `data` beside it — both bound the reading
    // and they are not the same bound.
    describes: windowFrom(profile, { n: profile.seasonsObserved ?? null }),
    data: {
      // Analytical vocabulary. NOT a sentence, and not a claim — see the
      // registry note on this kind.
      verdict: verdict.verdict,
      verdictNote: verdict.note ?? null,
      describes: verdict.describes ?? ph.describes ?? null,
      seasonsObserved: profile.seasonsObserved ?? 0,
      players: playersIn(profile),
      unreadableSeasons: profile.unreadableSeasons ?? [],
      // The measurement the verdict was read off, season by season.
      freshmanShareBySeason: (profile.seasons ?? []).map((s) => ({
        season: String(s.season),
        shareOfSquadMinutes: s.shareOfSquadMinutes ?? null,
        intake: s.intake ?? null,
        measured: s.measured ?? null,
      })),
      // Supporting detail, from the same computed philosophy result.
      dials: ph.dials ?? null,
      coach: ph.coach?.coach ?? null,
      coachStillInPost: ph.coachStillInPost ?? null,
      spread: verdict.spread ?? null,
      step: verdict.step ?? null,
    },
  });
}

/** The whole-intake ladder, carried as a ladder rather than a headline. */
export function freshmanMinutesLadder(athlete, ctx) {
  const profile = ctx?.philosophy?.freshman;
  const ladder = ctx?.philosophy?.ladder;
  if (!profile || !Array.isArray(ladder) || !ladder.length) return null;

  return defineEvidence('FRESHMAN_MINUTES_LADDER', {
    confidence: confidenceFor(profile),
    season: (ctx.philosophy.describes ?? []).join(', ') || null,
    source: 'roster_players:freshman-minutes',
    // Players, not seasons. The rungs are medians ACROSS seasons, but the
    // observations underneath are first-years, and the sample a reader needs in
    // order not to over-read a rung is how many of them there were.
    describes: windowFrom(profile, { n: playersIn(profile) }),
    data: {
      // Every rung, exactly as ladderByRank produced it — rank, median, the
      // agreement band, and its own n.
      ladder,
      seasonsObserved: profile.seasonsObserved ?? 0,
      medianIntake: profile.medianIntake ?? null,
      medianPlayed: profile.medianPlayed ?? null,
      seasonsWithAnImpactFreshman: profile.seasonsWithAnImpactFreshman ?? null,
      unknownRows: profile.unknownRows ?? null,
      unreadableSeasons: profile.unreadableSeasons ?? [],
    },
  });
}

/**
 * THE ATHLETE COHORT LADDER IS NOT BUILT HERE, AND THE REASON IS UPSTREAM.
 *
 * `playerFit` returns { asked, cohort, ladder, seasonsObserved, position,
 * wholeIntakeLadder }. It builds a narrowed `freshmanProfile` to produce that
 * ladder and then discards it, so the cohort's SEASON IDENTIFIERS and PLAYER
 * COUNT are not observable from the result. Both are needed and neither can be
 * substituted:
 *
 *   The seasons, because the narrowed profile filters seasons independently.
 *   A season readable for a whole intake is not necessarily readable for a
 *   two-player cohort, so the programme's window is the wrong window and
 *   lending it to this kind would misstate what was measured.
 *
 *   The player count, because n >= 6 is the floor the product expressed the
 *   claim rule in. A cohort ladder that cannot say how many players it rests
 *   on cannot serve the purpose it was asked for.
 *
 * Re-running `freshmanProfile` here would answer both and is exactly what this
 * module exists not to do: two computations of one ladder is how a report and
 * an email come to disagree about a programme.
 *
 * The unblocking change is additive and one line — return the profile beside
 * the ladder — but it changes a Philosophy return shape, so it belongs to a
 * decision rather than to an adapter commit.
 */

/**
 * Where this programme sits against the comparable pool.
 *
 * `comparison` is required on this kind because the sentence is meaningless
 * without it. `percentile` is deliberately NULL — see the note on it below.
 */
export function programmePoolBenchmark(athlete, ctx) {
  const profile = ctx?.philosophy?.freshman;
  const bench = ctx?.benchmarks;
  if (!profile || !bench?.sufficient) return null;

  const top = (ctx.philosophy.ladder ?? [])[0] ?? null;
  if (!top || top.median == null) return null;

  const poolRank1 = (bench.ladderByRank ?? []).find((r) => r.rank === top.rank) ?? null;
  if (!poolRank1) return null;

  return defineEvidence('PROGRAMME_POOL_BENCHMARK', {
    confidence: confidenceFor(profile),
    season: (bench.seasons ?? []).join(', ') || null,
    source: 'roster_players:pool-benchmarks',
    describes: windowFrom(profile, { n: playersIn(profile) }),
    comparison: {
      basis: `${bench.sport} programmes with a readable freshman ladder, ${(bench.seasons ?? []).join('-')}`,
      statistic: `ladder-rank-${top.rank}-median-minutes`,
      poolSize: Number.isInteger(bench.programmes) ? bench.programmes : null,
      /**
       * NOT populated, and not an oversight.
       *
       * `buildPoolBenchmarks` keeps p25/median/p75 per rank and discards the
       * distribution it took them from, so the only ranking available is which
       * quartile a programme falls in. Writing that into a field called
       * `percentile` would report a bucket as a position — a programme just
       * above p75 and the best in the country would both read as 90. The
       * quartile is carried under its own name in `data.band`, and an exact
       * percentile would need `buildPoolBenchmarks` to keep its samples, which
       * is a change to the Philosophy calculation and out of scope here.
       */
      percentile: null,
    },
    data: {
      programmeRank: top.rank,
      programmeMedian: top.median,
      programmeBand: { low: top.low ?? null, high: top.high ?? null, agreement: top.agreement ?? null },
      pool: { rank: poolRank1.rank, n: poolRank1.n, p25: poolRank1.p25, median: poolRank1.median, p75: poolRank1.p75 },
      // The quartile, named for what it is.
      band: top.median <= poolRank1.p25 ? 'at-or-below-p25'
        : top.median <= poolRank1.median ? 'p25-to-median'
          : top.median <= poolRank1.p75 ? 'median-to-p75' : 'above-p75',
      poolDials: bench.dials ?? null,
      poolProgrammes: bench.programmes ?? null,
    },
  });
}

/** Every philosophy-derived generator, in the order the panel reads them. */
export const PHILOSOPHY_GENERATORS = Object.freeze([
  programmeDevelopmentPattern,
  freshmanMinutesLadder,
  programmePoolBenchmark,
]);
