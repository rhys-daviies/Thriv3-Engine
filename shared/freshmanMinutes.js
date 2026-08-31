/**
 * What a first year at a programme actually looks like.
 *
 * The question a recruit is really asking is "will I play?", and the average
 * freshman's minutes is the one number that cannot answer it. Freshman
 * playing time is bimodal almost everywhere: at Bentley in 2025 three
 * freshmen played over a thousand minutes, five played none, and the mean of
 * 340 describes nobody on the roster.
 *
 * So nothing here reports a mean. The unit is the *ladder* — freshmen ranked
 * by minutes — because a recruit can place themselves on it ("am I their best
 * incoming forward, or their fourth?") in a way they cannot place themselves
 * against an average.
 *
 * NOTHING HERE IS A FORECAST. The season a recruit is joining has not been
 * played, so it holds no minutes; every figure describes seasons that already
 * happened, and every verdict names which ones. Two consequences run through
 * the module. A season we could not attribute is reported as unattributed
 * rather than assumed continuous, and a programme whose current coach has not
 * yet coached a measurable season is told exactly that instead of being handed
 * the previous staff's record as if it were its own.
 */

import { readClassYear } from './classYear.js';
import { canonicalPosition } from './positions.js';
import { withReadablePerformance } from './performanceSource.js';
import { sameCoach } from './coachTenure.js';

/**
 * Where a player came from, because at some programmes it decides the ladder.
 *
 * McKendree men's is the case that forced this: 65% of its freshmen are
 * international, and 17 of the 20 who played a starter's season were. Read
 * whole, its ladder says the top five freshmen all start — 1850, 1092, 1027,
 * 926, 622. Read for a US high-school recruit it says 999, 54, 17. One seat,
 * not five. Bellarmine men's runs the other way, its domestic ladder better
 * than its international one, so this is not a correction that can be applied
 * as a rule of thumb — it has to be measured per programme.
 *
 * Null, never a bucket, where the roster records neither: 1,834 rows carry no
 * nationality and no country, and sorting those into "domestic" by default
 * would be the same error as reading a blank minutes cell as a zero.
 */
export function originOf(row) {
  const nationality = String(row?.nationality ?? '').trim();
  const country = String(row?.country ?? '').trim();
  if (/^(usa|united states|u\.?s\.?a?\.?)$/i.test(nationality)) return 'domestic';
  if (country || /^international$/i.test(nationality)) return 'international';
  if (nationality) return 'international';
  return null;
}

/**
 * How thin a cohort may be before narrowing to it says more about the sample
 * than the programme.
 *
 * Below these, the unfiltered ladder is returned with the refusal stated, so
 * a caller can say "not enough of them to tell you" rather than quoting a
 * median of three players and one season.
 */
export const MIN_COHORT_PLAYERS = 6;
export const MIN_COHORT_SEASONS = 2;

/**
 * How far the best season may sit above the median before the median stops
 * being a description of the seasons and becomes an average of two different
 * programmes.
 */
export const AGREEMENT_RATIO = 3;

/**
 * The cohort an athlete belongs to, so the ladder can be cut to the people
 * they will actually be competing with rather than the whole intake.
 */
export function cohortFor(athlete) {
  if (!athlete) return { position: null, origin: null };
  const key = canonicalPosition(athlete.position);
  return {
    position: key === 'UNKNOWN' ? null : key,
    origin: originOf(athlete),
  };
}

/**
 * Bands, not a continuum, because the difference between 850 and 950 minutes
 * is nothing and the difference between 40 and 400 is a season.
 *
 * `impact` sits at the same 600 the rest of the product calls a starter, so a
 * freshman who clears it is a freshman who took a place in the XI.
 */
export const MINUTE_BANDS = [
  { key: 'impact', label: 'Played like a starter', min: 600 },
  { key: 'rotation', label: 'In the rotation', min: 200 },
  { key: 'fringe', label: 'Fringe minutes', min: 1 },
  { key: 'none', label: 'Did not play', min: 0 },
];

export function bandFor(minutes) {
  const m = Number(minutes) || 0;
  return MINUTE_BANDS.find((b) => m >= b.min && (m > 0 || b.key === 'none')).key;
}

/** A true freshman: first year on campus, not a redshirt in their second. */
export function isTrueFreshman(row) {
  const read = readClassYear(row?.class_year_label, { season: row?.season });
  return read.klass === 'FRESHMAN' && !read.redshirt;
}

/** A redshirt freshman — on campus a year already, and that is its own answer. */
export function isRedshirtFreshman(row) {
  const read = readClassYear(row?.class_year_label, { season: row?.season });
  return read.klass === 'FRESHMAN' && read.redshirt;
}

const minutesOf = (row) => Number(row?.minutes_played) || 0;

/**
 * A row whose minutes were never recorded, as opposed to a player who did not
 * appear. `minutes_played` cannot tell them apart — the importer coerces a
 * blank to 0 — but `games_played` is stored with no such fallback, so a row
 * claiming zero minutes across games it played is a gap, not a benching.
 */
export function minutesAreMissing(row) {
  if (minutesOf(row) > 0) return false;
  const games = row?.games_played;
  return games === null || games === undefined || Number(games) > 0;
}

/**
 * One programme's freshman intake for one season, ranked.
 *
 * Rows with no minutes on record are counted and reported separately rather
 * than dropped or read as zeros: a programme whose stats page carries no
 * minutes column would otherwise look like one that plays no freshmen.
 */
export function freshmanSeason(rows, { season, position = null, origin = null } = {}) {
  // Canonicalised on both sides: the roster stores DEFENSE and the intake form
  // stores "Defender", and comparing them raw silently matches nobody — which
  // reads as a programme that has never recruited the position.
  const wanted = position ? canonicalPosition(position) : null;
  const cohort = rows
    .filter((r) => r.season === season && isTrueFreshman(r))
    .filter((r) => !wanted || canonicalPosition(r.position) === wanted)
    .filter((r) => !origin || originOf(r) === origin);

  const measured = cohort.filter((r) => !minutesAreMissing(r));
  const unknown = cohort.length - measured.length;

  const ladder = measured
    .map((r) => ({
      name: r.player_name,
      position: r.position,
      minutes: minutesOf(r),
      gamesPlayed: Number(r.games_played) || 0,
      gamesStarted: Number(r.games_started) || 0,
      band: bandFor(minutesOf(r)),
    }))
    .sort((a, b) => b.minutes - a.minutes || (a.name || '').localeCompare(b.name || ''))
    .map((p, i) => ({ ...p, rank: i + 1 }));

  const bands = Object.fromEntries(MINUTE_BANDS.map((b) => [b.key, 0]));
  for (const p of ladder) bands[p.band] += 1;

  const redshirted = rows.filter((r) => r.season === season && isRedshirtFreshman(r)).length;

  return {
    season,
    intake: cohort.length,
    measured: measured.length,
    unknown,
    ladder,
    bands,
    played: ladder.filter((p) => p.minutes > 0).length,
    totalMinutes: ladder.reduce((sum, p) => sum + p.minutes, 0),
    redshirted,
  };
}

/** The share of a squad's whole season that went to its freshmen. */
/**
 * How thin a season's minutes may be before its share means nothing.
 *
 * Marywood's 2023 squad had 39 players and a minutes figure for 3. A share
 * computed from those 3 is not a measurement of the squad, it is a
 * measurement of the three rows that happened to be readable.
 */
export const MIN_SQUAD = 10;
export const MIN_MEASURED_SHARE = 0.5;

export function freshmanShare(rows, { season, minSquad = MIN_SQUAD,
  minMeasuredShare = MIN_MEASURED_SHARE } = {}) {
  const squad = rows.filter((r) => r.season === season);
  if (squad.length < minSquad) return null;
  const measured = squad.filter((r) => !minutesAreMissing(r));
  // Null, never zero. "We could not read this squad's minutes" and "this
  // squad's freshmen played none" are opposite claims, and collapsing them
  // reads a data gap as a coaching decision.
  if (measured.length / squad.length < minMeasuredShare) return null;
  const total = measured.reduce((sum, r) => sum + minutesOf(r), 0);
  if (!total) return null;
  const fresh = measured.filter(isTrueFreshman).reduce((sum, r) => sum + minutesOf(r), 0);
  return fresh / total;
}

const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/**
 * What the Nth-best freshman GOT here, across every season on file.
 *
 * The one figure a recruit can actually act on, and a historical one: what
 * happened to the position they might occupy, not what will. An average says
 * what happened to a group they will not be a member of. A player told they
 * are a programme's top incoming defender can read rank 1; one who suspects
 * they are third can read rank 3, and decide accordingly.
 */
export function ladderByRank(seasons, { maxRank = 8, weights = null } = {}) {
  const out = [];
  for (let rank = 1; rank <= maxRank; rank += 1) {
    const atRank = seasons
      .map((s) => {
        const p = s.ladder.find((x) => x.rank === rank);
        return p ? { minutes: p.minutes, season: s.season, name: p.name ?? null } : null;
      })
      .filter(Boolean);
    if (!atRank.length) break;
    const minutes = atRank.map((p) => p.minutes);
    const w = weights
      ? atRank.map((p) => (weights[p.season] ?? weights[Number(p.season)] ?? 1))
      : null;
    out.push({
      rank,
      seasonsWithThisMany: atRank.length,
      median: w ? weightedMedian(minutes, w) : median(minutes),
      low: Math.min(...minutes),
      high: Math.max(...minutes),
      band: bandFor(w ? weightedMedian(minutes, w) : median(minutes)),
      // Stated rather than implied, so a caller can say which coach's
      // programme the number actually describes.
      weighted: Boolean(w),
      // The seasons this rung is actually made of, in the order they were
      // handed in. A rung is two to four observations and a reader deserves
      // to see them: a median of 42 drawn from 42, 1001 and 14 is a different
      // object from a median of 42 drawn from 40, 42 and 44, and only the
      // second is a description of the programme.
      //
      // Only seasons that HAVE a player at this rank appear. A season whose
      // intake was smaller, or whose minutes were never published, is absent
      // rather than present at zero — a manufactured zero would drag the
      // median down and read as a coaching decision.
      //
      // `weight` carries the per-season weighting the median was actually
      // computed with, so a weighted rung can be explained without the
      // renderer reconstructing weightsFromVerdict for itself. It is null on
      // an unweighted ladder, never 1, because "not weighted" and "weighted
      // at full" are different facts.
      contributions: atRank.map((p, i) => ({
        season: p.season,
        minutes: p.minutes,
        name: p.name ?? null,
        weight: w ? w[i] : null,
      })),
    });
  }

  // Within any one season the ladder falls by construction, so a median that
  // rises as you go down it is not a finding — it is the ranks being taken
  // over different sets of seasons. North Florida men's read
  // 209, 346, 529 for a US defender across 4, 2 and 2 seasons. Everything
  // from the first rise is marked incomparable so a caller can stop there
  // rather than print a ladder that gets better the further down you look.
  let comparable = true;
  for (let i = 0; i < out.length; i += 1) {
    if (i > 0 && out[i].median > out[i - 1].median) comparable = false;
    out[i].comparable = comparable;
    // A median the seasons do not agree on is a number to show as a range.
    // Gustavus Adolphus's international freshmen ran 42, 1001 and 14 minutes
    // in three seasons; the median is 42 and quoting it alone would say
    // "they do not play internationals" when one of the three played a full
    // season. Two bands apart, or a high several times the median, is a
    // disagreement rather than a measurement.
    // The high has to reach real minutes for the gap to mean anything:
    // Bentley's freshman defenders read 0 with a high of 44, which is two
    // bands but one fact — none of them played.
    const highBand = bandFor(out[i].high);
    out[i].agreement = (out[i].high >= AGREEMENT_RATIO * Math.max(out[i].median, 1)
      && highBand !== bandFor(out[i].median)
      && (highBand === 'impact' || highBand === 'rotation')) ? 'wide' : 'tight';
  }
  return out;
}

/**
 * A median that respects per-season weight.
 *
 * Weighting rather than filtering, because a programme whose coach changed
 * last year would otherwise be left with a single season and a confidence it
 * has not earned. The old seasons still count — they describe the institution
 * — they just count less than the ones the current coach actually ran.
 */
export function weightedMedian(values, weights) {
  const pairs = values
    .map((v, i) => ({ v, w: Number(weights[i]) || 0 }))
    .filter((p) => p.w > 0)
    .sort((a, b) => a.v - b.v);
  if (!pairs.length) return median(values);
  const total = pairs.reduce((sum, p) => sum + p.w, 0);
  let acc = 0;
  for (const p of pairs) {
    acc += p.w;
    if (acc >= total / 2) return p.v;
  }
  return pairs[pairs.length - 1].v;
}

/**
 * Thresholds, in percentage points of a squad's minutes going to freshmen.
 *
 * Both derived from the pool rather than picked: across the 1,369 programmes
 * with credible four-season data, a >=10-point gap between the first two
 * seasons and the last two separates 33% of them, and a season-to-season
 * standard deviation >=8 marks a further 17% as genuinely unsettled.
 */
export const STEP_POINTS = 10;
export const SPREAD_POINTS = 8;

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const stdev = (a) => (a.length < 2 ? 0 : Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2))));

/**
 * What kind of programme this is, once the coach is known.
 *
 * The minutes alone cannot tell these apart, and they mean opposite things to
 * a recruit. Bentley ran 4%, 2%, 26%, 32% under two coaches — a regime change,
 * and only the last three seasons describe what she would join. Hofstra ran
 * 2%, 0%, 8%, 18% under one coach for all four — that is not a change to
 * discount, it is a programme whose freshman policy is genuinely unsettled.
 *
 * The new coach's first season is excluded from their side of the comparison:
 * it is played with the squad the previous coach recruited, which is exactly
 * why Bentley's first Dacey season reads lower than Lukis's last.
 */
export function classifyProgramme(profile, tenure) {
  if (!profile || !profile.seasons?.length) return null;

  // A season whose share could not be measured is dropped, not read as zero.
  // Coercing null to 0 turned Marywood — three seasons with no minutes on
  // file at all — into "0%, 0%, 0%, 74%" and then into one of the largest
  // regime changes in the pool, on the strength of a missing column.
  const shares = profile.seasons
    .filter((s) => s.shareOfSquadMinutes !== null && s.shareOfSquadMinutes !== undefined)
    .map((s) => ({ season: Number(s.season), pct: s.shareOfSquadMinutes * 100 }))
    .filter((s) => Number.isFinite(s.season))
    .sort((a, b) => a.season - b.season);
  if (shares.length < 2) {
    return { verdict: 'too-few-seasons', spread: 0, step: null, weightFrom: null,
      note: 'one season on file — not enough to describe a pattern' };
  }

  const spread = stdev(shares.map((s) => s.pct));
  const half = Math.floor(shares.length / 2);
  const early = shares.slice(0, half).map((s) => s.pct);
  const late = shares.slice(shares.length - half).map((s) => s.pct);
  const step = mean(late) - mean(early);
  const stepped = Math.abs(step) >= STEP_POINTS;

  const measuredSeasons = shares.map((s) => s.season);
  const base = {
    spread,
    step,
    coach: tenure?.current?.coach ?? null,
    // Every verdict states which seasons it is describing and which it could
    // not read. A recruit is being advised on history, not given a forecast,
    // so the history has to name its own boundaries.
    describes: measuredSeasons,
    unknownSeasons: tenure?.unknownSeasons ?? [],
    knownThrough: tenure?.knownThrough ?? null,
  };

  if (!tenure || !tenure.current) {
    return { ...base, verdict: 'coach-unknown', weightFrom: null,
      note: 'no coach on file, so these seasons cannot be attributed to anyone' };
  }

  const changed = tenure.changes.length > 0;
  const since = tenure.current.since;

  // A season we could not read is not a season in which nothing changed.
  // Bellarmine women's ran 23%, 30%, 26%, 20% with four starter-level freshmen
  // every year and was filed "one coach, a consistent pattern" — because 2024
  // and 2025 came back blank. It was three coaches: Babba, McKinney,
  // Bornhoffer. The pattern surviving two changes is a better thing to tell a
  // recruit than the false claim it was one man's doing, and neither is
  // reachable while a blank counts as continuity.
  const unknownRecent = (tenure.unknownSeasons ?? []).filter((u) => u >= since);
  if (unknownRecent.length) {
    return { ...base, verdict: 'coach-unknown-recent', since, weightFrom: null,
      note: `no coach on file for ${unknownRecent.join(', ')} — the seasons through `
        + `${tenure.knownThrough} were ${tenure.current.coach}'s, and we are not assuming he stayed` };
  }

  // The person in the job has not yet coached a season anyone can measure.
  // There is no projection to make here and saying so is the whole answer:
  // North Florida men's took Marlon Montanella for 2026, and every season on
  // file was run by Marinatos or Davies.
  if (!measuredSeasons.some((s) => s >= since)) {
    return { ...base, verdict: 'new-coach-no-record', since, weightFrom: null,
      note: `${tenure.current.coach} took over for ${since} and has not yet coached a season `
        + 'we can measure — the figures below are the previous staff\'s' };
  }

  // A programme that had nobody in the job is not a programme with a
  // consistent philosophy. South Carolina State printed TBA as head coach for
  // 2022 and 2023 and its freshman share ran 69% and 41% — the highest in the
  // pool — before collapsing once a permanent coach arrived. Read as "one
  // coach throughout" that becomes a policy shift; read correctly it is a
  // programme that was being held together, which is the thing a recruit
  // actually needs to know.
  const vacantEarly = (tenure.vacantSeasons ?? tenure.gaps).filter((g) => g < since);
  if (vacantEarly.length) {
    return { ...base, verdict: 'vacancy-in-window', since, weightFrom: since,
      vacantSeasons: vacantEarly,
      note: `no permanent head coach on file for ${vacantEarly.join(', ')} — only the seasons since ${since} describe the programme as it is now` };
  }

  // Two changes or more, and the pattern held across all of them.
  //
  // This is the strongest evidence the module can produce and it was
  // invisible until now, because every other branch compares either side of
  // the LATEST change only. Bellarmine women's ran 23%, 30%, 26%, 20% with
  // four starter-level freshmen every season under Babba, then McKinney, then
  // Bornhoffer — three coaches in four years. Compared around Bornhoffer
  // alone it read `change-too-recent`, one season and no guide. Compared
  // across all three spells it is the opposite: a programme that plays its
  // freshmen whoever is in charge, which is a property of the institution and
  // survives the next hire too.
  if (tenure.changes.length >= 2 && shares.length >= 3) {
    const perSegment = tenure.segments
      .map((seg) => shares.filter((s) => s.season >= seg.from && s.season <= seg.to).map((s) => s.pct))
      .filter((pcts) => pcts.length)
      .map(mean);
    if (perSegment.length >= 3) {
      const swing = Math.max(...perSegment) - Math.min(...perSegment);
      // Stable, not merely averaging out. Cal State Dominguez Hills ran
      // 23%, 26%, 4%, 30% — three coaches whose segment means sit 9 points
      // apart, which passes the swing test on the strength of a 4 and a 30
      // cancelling inside one spell. A pattern that survived a change has to
      // have been a pattern first.
      if (swing < STEP_POINTS && spread < SPREAD_POINTS) {
        return { ...base, verdict: 'structural-through-changes', since, weightFrom: null,
          coaches: tenure.segments.map((s) => s.coach), swing,
          note: `the pattern held across ${tenure.changes.length} coaching changes — it belongs to the `
            + 'programme rather than to any one coach, so every season counts' };
      }
    }
  }

  if (changed) {
    const before = shares.filter((s) => s.season < since).map((s) => s.pct);
    // The new coach's first season is excluded from their side: it is played
    // with the squad the previous coach recruited, which is exactly why
    // Bentley's first Dacey season read lower than Lukis's last.
    const after = shares.filter((s) => s.season > since).map((s) => s.pct);
    if (!before.length || !after.length) {
      return { ...base, verdict: 'change-too-recent', since, weightFrom: since,
        note: 'the coach changed too recently to compare the two spells — the newest season is the only guide' };
    }
    const acrossChange = mean(after) - mean(before);
    return Math.abs(acrossChange) >= STEP_POINTS
      ? { ...base, verdict: 'regime-change', step: acrossChange, since, weightFrom: since,
          note: 'the coach changed and the pattern changed with them — the earlier seasons describe a different programme' }
      : { ...base, verdict: 'continuity-through-change', step: acrossChange, since, weightFrom: null,
          note: 'the coach changed but the pattern did not — this looks structural, so every season counts' };
  }

  // ONE COACH THROUGHOUT — AND WHAT IT TAKES TO SAY SO.
  //
  // Everything below this line describes a single coach across the whole
  // window, so a usable head-coach observation is required for every season
  // being described. Nothing may stand in for one: not an unread page, not a
  // season with no row, not a vacancy, and not a title naming somebody else's
  // job. `tenureFor` reads rows through `readCoachRow`, so an associate head
  // or a strength coach arrives here as an unresolved season rather than as a
  // name, and this gate is what stops the absence being read as continuity.
  //
  // The branches above are untouched. Only this fall-through claimed
  // continuity, and it claimed it from the ABSENCE of an observed change —
  // `tenure.changes` counts a transition only between two adjacent resolved
  // seasons, so a change either side of an unread season counted as none.
  // Mercyhurst men's is the worked case: 2022 Brian Osborne, 2023 and 2024
  // unread, 2025 Austin Solomon. Two names, no adjacent pair, and the report
  // said "one coach, a consistent pattern — the record is as firm as this
  // gets" over a window with two coaches in it and half of it unread.
  const nameIn = (season) => tenure.segments
    .find((g) => season >= g.from && season <= g.to)?.coach ?? null;
  const observedNames = [...new Set(measuredSeasons.map(nameIn).filter(Boolean))];
  const unobserved = measuredSeasons.filter((s) => !nameIn(s));

  if (unobserved.length) {
    const named = observedNames.length === 1 ? observedNames[0] : null;
    return { ...base, verdict: 'coach-unknown-recent', since, weightFrom: null,
      note: `no head coach on file for ${unobserved.join(', ')}`
        + (named ? ` — the rest of the window was ${named}'s` : '')
        + ', and a season we could not read is not a season in which nobody changed' };
  }
  // Two names inside the window with no adjacent pair between them: the change
  // is real and the season it happened in is one the figures could not measure.
  // Saying which two coaches is the whole of what we know.
  if (observedNames.length > 1) {
    return { ...base, verdict: 'coach-unknown-recent', since, weightFrom: null,
      note: `${observedNames.join(' and ')} are both on file across these seasons, and the `
        + 'season the change happened in is not one we could measure' };
  }

  // One coach throughout. A step here is not a hire, it is the same person
  // changing their mind — Hofstra ran 2%, 0%, 8%, 18% under Richard Nuttall
  // for all four years. Its spread of 7.0 sits under the volatility
  // threshold, so without checking the step it would have been filed as
  // steady, which is the opposite of what a recruit needs to hear.
  //
  // Each note names its own window. Unscoped, "one coach throughout" reads as
  // a claim about the season a recruit would join, and at Ursuline the post is
  // recorded vacant for exactly that season — four seasons of Jason Kubbins
  // and nobody in the job now. Both facts are true and the report shows them
  // on one card; only the sentence that failed to say which seasons it meant
  // made them look like a contradiction.
  if (stepped) {
    return { ...base, verdict: 'policy-shift-same-coach',
      weightFrom: shares[shares.length - half].season,
      note: 'the same coach across every season measured, but the recent seasons look '
        + 'different from the early ones — weight the recent ones' };
  }
  if (spread >= SPREAD_POINTS) {
    return { ...base, verdict: 'erratic-same-coach', weightFrom: null,
      note: 'one coach across every season measured, and the freshman policy swings season '
        + 'to season — treat any single year with caution' };
  }
  return { ...base, verdict: 'steady', weightFrom: null,
    note: 'one coach across every season measured, a consistent pattern — every season '
      + 'counts and the record is as firm as this gets' };
}

/**
 * Per-season weights implied by a classification.
 *
 * `weightFrom` unifies the two reasons a season may no longer describe the
 * programme a recruit would join — a new coach, or the same coach changing
 * approach. Everything from that season counts fully; everything before it
 * counts less, but still counts.
 */
export function weightsFromVerdict(verdict, seasons) {
  if (!verdict?.weightFrom) return null;
  const out = {};
  for (const s of seasons) {
    const season = Number(s.season ?? s);
    out[season] = season >= verdict.weightFrom ? 1 : 0.35;
  }
  return out;
}

/**
 * Every season, plus what they say together.
 *
 * Consistency is the point of using four years rather than one. A programme
 * that started two freshmen every season is telling a recruit something a
 * programme that did it once, in a season with an injury crisis, is not.
 */
/**
 * A ranked ladder every rung of which is zero is not an opportunity finding.
 *
 * It is the shape a programme takes when its stats page was never read, and
 * `readable` cannot catch it: that gate asks what SHARE of an intake carried a
 * minutes figure, and a season where the importer assumed a zero for everybody
 * answers "all of it". 84 programmes printed a ladder reading 0 at every rank
 * — "best freshman: 0 minutes" — which is the same sentence commit 296492e
 * removed from 154 others, arriving by a different route.
 *
 * The refusal is deliberately not "no freshman played much". `high` is the
 * best single freshman at that rung in any season on file, so one minute
 * anywhere clears it. Nothing survives this that a programme actually
 * published.
 *
 * If a programme has genuinely never given a freshman a minute in four
 * seasons, that belongs in a sentence saying so, not in a table of zeros a
 * reader will take for a measurement.
 */
function ladderIsEntirelyZero(byRank) {
  return byRank.length > 0 && byRank.every((r) => r.high === 0);
}

export function freshmanProfile(rawRows, {
  seasons, position = null, origin = null, athlete = null, maxRank = 8,
} = {}) {
  // A programme-season whose stats page was never read carries a fabricated
  // zero for every player on it, and every gate below asks how much was
  // measured — to which a fabricated season answers "all of it". Blanking it
  // here, once, is what stops it counting as measured freshmen, as
  // zero-minute freshmen, as ladder rungs, and as a season in which the
  // programme gave its intake nothing.
  const rows = withReadablePerformance(rawRows ?? []);

  // An athlete narrows the ladder to the people they would be competing with.
  // Explicit position/origin still win, so a caller can ask a question the
  // athlete does not imply.
  const asked = athlete ? cohortFor(athlete) : { position: null, origin: null };
  const wantPosition = position ?? asked.position;
  const wantOrigin = origin ?? asked.origin;

  // A season whose freshmen are mostly unrecorded is not a season we can rank.
  //
  // MIT's 2024 intake is nine players with a minutes figure for none of them;
  // one earlier season has a figure for one. The ladder built from whichever
  // rows happen to be legible reported "best freshman: 0 minutes, did not
  // play" — which is the opposite of what the data says, and it said it about
  // 154 programmes. The same threshold already guards freshmanShare one level
  // up; it belongs here too.
  const readable = (s) => s.intake > 0 && s.measured / s.intake >= MIN_MEASURED_SHARE;

  const build = (p, o) => seasons
    .map((season) => ({
      ...freshmanSeason(rows, { season, position: p, origin: o }),
      // A share of squad minutes is only meaningful for the whole intake:
      // narrowed, the numerator is a subset and the denominator is not.
      shareOfSquadMinutes: (p || o) ? null : freshmanShare(rows, { season }),
    }))
    .filter(readable);

  const unreadableSeasons = seasons
    .map((season) => freshmanSeason(rows, { season, position: wantPosition, origin: wantOrigin }))
    .filter((s) => s.intake > 0 && !readable(s))
    .map((s) => s.season);

  const thinOf = (list) => {
    const players = list.reduce((sum, s) => sum + s.intake, 0);
    if (players >= MIN_COHORT_PLAYERS && list.length >= MIN_COHORT_SEASONS) return null;
    // "0 in 0 seasons" is accurate and reads as a broken template. An empty
    // group is an empty group.
    if (!players) return 'nobody on file';
    return `${players} in ${list.length} season${list.length === 1 ? '' : 's'}`;
  };

  // A caller who names a cohort gets that cohort, thin or not.
  //
  // Relaxing under an explicit request is a footgun and it went off: an
  // aggregate that asked 1,922 programmes for their goalkeeper ladder got the
  // whole intake back wherever the keepers were too few, and reported 46,826
  // freshman goalkeepers — more than every outfield position combined. The
  // thinness is reported so a caller can drop the row; it is not papered over
  // with somebody else's numbers.
  if (!athlete && (position || origin)) {
    const built = build(wantPosition, wantOrigin);
    if (!built.length) return null;
    if (ladderIsEntirelyZero(ladderByRank(built, { maxRank }))) return null;
    return shape(built, {
      position: wantPosition, origin: wantOrigin, applied: true,
      refused: null, relaxed: null, thin: thinOf(built),
      unreadableSeasons: seasons
        .map((season) => freshmanSeason(rows, { season, position: wantPosition, origin: wantOrigin }))
        .filter((s) => s.intake > 0 && !(s.measured / s.intake >= MIN_MEASURED_SHARE))
        .map((s) => s.season),
    }, maxRank);
  }

  // Relax one dimension at a time, never straight to the whole intake.
  //
  // A US defender at McKendree is 5 players over 2 seasons — too thin to read
  // on its own. Falling all the way back to the whole intake would hand him
  // 1850, 1092, 1027, which are the international numbers and the single most
  // misleading answer available. Dropping only the position leaves the US
  // ladder, which is the dimension that decides whether he is in the
  // competition at all; position decides which ladder inside it.
  const chain = [
    [wantPosition, wantOrigin],
    [null, wantOrigin],
    [wantPosition, null],
    [null, null],
  ].filter(([p, o], i, all) =>
    // Skip a step identical to one already tried.
    all.findIndex(([p2, o2]) => p2 === p && o2 === o) === i);

  let perSeason = null;
  const cohort = { position: null, origin: null, applied: false, refused: null, relaxed: null, thin: null };
  for (const [pos, org] of chain) {
    const built = build(pos, org);
    const why = (pos || org) ? thinOf(built) : null;
    if (why) {
      // Record only the first refusal — it is the one the caller asked for.
      if (!cohort.refused) {
        const named = [pos, org].filter(Boolean).join(' / ');
        cohort.refused = why === 'nobody on file'
          ? `${named}: nobody on file`
          : `${named}: only ${why} — too few to read separately`;
      }
      continue;
    }
    perSeason = built;
    cohort.position = pos;
    cohort.origin = org;
    cohort.applied = Boolean(pos || org);
    if (cohort.refused) cohort.relaxed = [pos, org].filter(Boolean).join(' / ') || 'whole intake';
    break;
  }

  if (!perSeason || !perSeason.length) return null;
  if (ladderIsEntirelyZero(ladderByRank(perSeason, { maxRank }))) {
    // Named rather than dropped, so a report says it could not read these
    // seasons instead of saying nothing about them.
    return null;
  }
  return shape(perSeason, { ...cohort, unreadableSeasons }, maxRank);
}

/** The profile object, from a list of seasons and the cohort they describe. */
function shape(perSeason, cohort, maxRank) {
  const impactCounts = perSeason.map((s) => s.bands.impact);
  return {
    seasons: perSeason,
    position: cohort.position,
    origin: cohort.origin,
    // Which cohort this ladder describes, and — where narrowing was asked for
    // and refused or relaxed — what happened instead.
    cohort,
    seasonsObserved: perSeason.length,
    // Named, not just dropped, so a report can say what it could not read.
    unreadableSeasons: cohort.unreadableSeasons ?? [],
    // How reliably this programme gives a freshman a starter's season.
    seasonsWithAnImpactFreshman: impactCounts.filter((n) => n > 0).length,
    medianImpactPerSeason: median(impactCounts),
    medianIntake: median(perSeason.map((s) => s.intake)),
    medianPlayed: median(perSeason.map((s) => s.played)),
    byRank: ladderByRank(perSeason, { maxRank }),
    unknownRows: perSeason.reduce((sum, s) => sum + s.unknown, 0),
  };
}
