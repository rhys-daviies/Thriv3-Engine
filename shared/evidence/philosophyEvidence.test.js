/**
 * Migration step 9.4 — the philosophy adapter.
 *
 * Two things are being asserted, and the second matters more than the first.
 *
 * That the translation is faithful: every number on these evidence objects is
 * the number `programmePhilosophy` produced, not a second computation of it.
 *
 * That the translation is CONTAINED: three operator-only kinds joined the
 * registry and nothing about an email changed. The claim protections are
 * carried by the registry and asserted here — DENIED everywhere but the
 * operator screen, QUALIFIED even there, and the classifier's own vocabulary
 * kept in `data` where it cannot be mistaken for a sentence.
 */

import { describe, it, expect } from 'vitest';
import { programmePhilosophy, playerFit } from '../philosophy.js';
import {
  programmeDevelopmentPattern, freshmanMinutesLadder, programmePoolBenchmark,
  athleteCohortLadder, PHILOSOPHY_GENERATORS,
} from './philosophyEvidence.js';
import { buildProgrammeContext } from './generate.js';
import {
  selectEvidence, EVIDENCE_KINDS, EVIDENCE_KIND_NAMES, TIERS, TEMPORALITY,
} from './index.js';
import { PERMISSION, permissionsFor } from './kinds.js';

const DEV_KINDS = [
  'PROGRAMME_DEVELOPMENT_PATTERN', 'FRESHMAN_MINUTES_LADDER',
  'ATHLETE_COHORT_LADDER', 'PROGRAMME_POOL_BENCHMARK',
];

const stamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

/**
 * A programme with four measurable seasons.
 *
 * Freshmen carry real minutes so the seasons pass MIN_MEASURED_SHARE, and the
 * squad is large enough for `freshmanShare` to quote a denominator.
 */
function rows({ seasons = ['2022', '2023', '2024', '2025'], freshmenPerSeason = 4, minutes = null } = {}) {
  const out = [];
  for (const season of seasons) {
    for (let i = 0; i < freshmenPerSeason; i += 1) {
      out.push({
        college_name: 'Example', sport: 'mens-soccer', season,
        player_name: `Fresh ${season}-${i}`, position: 'DEFENSE',
        class_year_label: 'Fr.', minutes_played: minutes === null ? 1200 - i * 200 : minutes,
        estimated_graduation_year: Number(season) + 4, updated_date: stamp,
        nationality: 'USA', country: null,
      });
    }
    for (let i = 0; i < 16; i += 1) {
      out.push({
        college_name: 'Example', sport: 'mens-soccer', season,
        player_name: `Vet ${season}-${i}`, position: 'MIDFIELD',
        class_year_label: 'Jr.', minutes_played: 900,
        estimated_graduation_year: Number(season) + 2, updated_date: stamp,
        nationality: 'USA', country: null,
      });
    }
  }
  return out;
}

const coachRows = (rs = [2022, 2023, 2024, 2025].map((season) => ({
  season, coach_name: 'One Boss', coach_title: 'Head Coach', reason: null,
}))) => rs;

function ctxFor(history, { coach = coachRows(), benchmarks = null } = {}) {
  return buildProgrammeContext({
    college: { name: 'Example', sport: 'mens-soccer' },
    squad: [], history, coachRows: coach, rosterUpdatedAt: stamp,
    philosophy: programmePhilosophy({ rows: history, coachRows: coach }),
    benchmarks,
  });
}

const athlete = { name: 'A Recruit', position: 'DEFENSE', country: 'New Zealand', classYear: 2027 };

const bench = {
  sufficient: true, sport: 'mens-soccer', seasons: ['2022', '2023', '2024', '2025'],
  programmes: 920,
  ladderByRank: [{ rank: 1, n: 900, p25: 901, median: 1118, p75: 1289 }],
  dials: null,
};

describe('the adapter translates rather than recomputes', () => {
  it('carries the classifier\'s verdict unchanged', () => {
    const history = rows();
    const philosophy = programmePhilosophy({ rows: history, coachRows: coachRows() });
    const ev = programmeDevelopmentPattern(athlete, ctxFor(history));
    expect(ev.data.verdict).toBe(philosophy.verdict.verdict);
    expect(ev.data.seasonsObserved).toBe(philosophy.freshman.seasonsObserved);
  });

  it('carries the ladder rung for rung, not a summary of it', () => {
    const history = rows();
    const philosophy = programmePhilosophy({ rows: history, coachRows: coachRows() });
    const ev = freshmanMinutesLadder(athlete, ctxFor(history));
    // Deep equality against the source. A recomputation would drift here first.
    expect(ev.data.ladder).toEqual(philosophy.ladder);
    expect(ev.data.ladder.length).toBeGreaterThan(1);
    // Every rung keeps its own band, so no reader is handed one scalar.
    for (const rung of ev.data.ladder) {
      expect(rung).toHaveProperty('rank');
      expect(rung).toHaveProperty('median');
      expect(rung).toHaveProperty('low');
      expect(rung).toHaveProperty('high');
    }
  });

  it('matches the benchmark it was given, and names the pool', () => {
    const history = rows();
    const ev = programmePoolBenchmark(athlete, ctxFor(history, { benchmarks: bench }));
    expect(ev.comparison.poolSize).toBe(920);
    expect(ev.comparison.statistic).toBe('ladder-rank-1-median-minutes');
    expect(ev.comparison.basis).toContain('mens-soccer');
    expect(ev.data.pool).toEqual({ rank: 1, n: 900, p25: 901, median: 1118, p75: 1289 });
    expect(ev.data.programmeMedian).toBe(ctxFor(history).philosophy.ladder[0].median);
  });

  it('leaves percentile null rather than reporting a quartile as a position', () => {
    const ev = programmePoolBenchmark(athlete, ctxFor(rows(), { benchmarks: bench }));
    expect(ev.comparison.percentile).toBeNull();
    // The quartile is carried under its own name instead.
    expect(['at-or-below-p25', 'p25-to-median', 'median-to-p75', 'above-p75'])
      .toContain(ev.data.band);
  });

  it('generates nothing at all without a philosophy result', () => {
    const ctx = buildProgrammeContext({
      college: { name: 'Example', sport: 'mens-soccer' },
      squad: [], history: rows(), rosterUpdatedAt: stamp,
    });
    for (const fn of PHILOSOPHY_GENERATORS) expect(fn(athlete, ctx), fn.name).toBeNull();
  });

  it('declines the benchmark when the pool is insufficient rather than comparing to nothing', () => {
    const ctx = ctxFor(rows(), { benchmarks: { sufficient: false, programmes: 0 } });
    expect(programmePoolBenchmark(athlete, ctx)).toBeNull();
  });

  it('declines the pattern when the source refuses to classify', () => {
    // One season. `classifyProgramme` returns `too-few-seasons`, which is a
    // refusal and not a finding.
    const history = rows({ seasons: ['2025'] });
    const ctx = ctxFor(history);
    expect(ctx.philosophy.verdict.verdict).toBe('too-few-seasons');
    expect(programmeDevelopmentPattern(athlete, ctx)).toBeNull();
  });
});

describe('the classifier label is data, never a claim', () => {
  it('keeps the raw verdict key in data', () => {
    const ev = programmeDevelopmentPattern(athlete, ctxFor(rows()));
    expect(typeof ev.data.verdict).toBe('string');
    expect(ev.data.verdict).toMatch(/^[a-z-]+$/);
  });

  it('carries the measurement the verdict was read off, season by season', () => {
    const ev = programmeDevelopmentPattern(athlete, ctxFor(rows()));
    expect(ev.data.freshmanShareBySeason.length).toBe(ev.describes.seasons.length);
    for (const s of ev.data.freshmanShareBySeason) {
      expect(ev.describes.seasons).toContain(s.season);
    }
  });

  it('registers no copy for any development kind, so none can be rendered', async () => {
    const { RENDERABLE_KINDS } = await import('./render.js');
    for (const kind of DEV_KINDS) expect(RENDERABLE_KINDS, kind).not.toContain(kind);
  });
});

describe('describes uses the source module\'s own readability semantics', () => {
  it('names the seasons the profile could actually read', () => {
    const history = rows();
    const philosophy = programmePhilosophy({ rows: history, coachRows: coachRows() });
    const ev = freshmanMinutesLadder(athlete, ctxFor(history));
    expect(ev.describes.seasons).toEqual(philosophy.freshman.seasons.map((s) => String(s.season)));
  });

  it('reports a season with an intake and too few minutes as UNREAD', () => {
    // 2024's freshmen all carry null minutes: an intake that exists and cannot
    // be measured, which is what MIN_MEASURED_SHARE is for.
    const history = [
      ...rows({ seasons: ['2022', '2023', '2025'] }),
      ...rows({ seasons: ['2024'], minutes: null }).map((r) => (
        r.class_year_label === 'Fr.' ? { ...r, minutes_played: null } : r)),
    ];
    const ev = freshmanMinutesLadder(athlete, ctxFor(history));
    expect(ev.describes.seasonsUnread).toContain('2024');
    expect(ev.describes.seasons).not.toContain('2024');
  });

  it('does NOT report a season the programme never had as unread', () => {
    // 2024 is absent from the rows entirely. Nothing tried to read it.
    const ev = freshmanMinutesLadder(athlete, ctxFor(rows({ seasons: ['2022', '2023', '2025'] })));
    expect(ev.describes.seasons).toEqual(['2022', '2023', '2025']);
    expect(ev.describes.seasonsUnread).toEqual([]);
  });

  it('counts n in the unit each kind is actually read in', () => {
    const history = rows({ freshmenPerSeason: 4 });
    const ctx = ctxFor(history);
    // The pattern compares seasons, so its n is seasons.
    expect(programmeDevelopmentPattern(athlete, ctx).describes.n)
      .toBe(ctx.philosophy.freshman.seasonsObserved);
    // The ladder rests on first-years, so its n is players: 4 x 4 seasons.
    expect(freshmanMinutesLadder(athlete, ctx).describes.n).toBe(16);
  });

  it('downgrades confidence when a season could not be read', () => {
    const clean = freshmanMinutesLadder(athlete, ctxFor(rows()));
    const history = [
      ...rows({ seasons: ['2022', '2023', '2025'] }),
      ...rows({ seasons: ['2024'] }).map((r) => (
        r.class_year_label === 'Fr.' ? { ...r, minutes_played: null } : r)),
    ];
    const holed = freshmanMinutesLadder(athlete, ctxFor(history));
    expect(clean.confidence).toBe('HIGH');
    expect(holed.confidence).toBe('MEDIUM');
  });
});

describe('registry semantics', () => {
  it('gives the pattern SIGNAL and the measurements FACT', () => {
    expect(EVIDENCE_KINDS.PROGRAMME_DEVELOPMENT_PATTERN.tier).toBe(TIERS.SIGNAL);
    expect(EVIDENCE_KINDS.FRESHMAN_MINUTES_LADDER.tier).toBe(TIERS.FACT);
    expect(EVIDENCE_KINDS.PROGRAMME_POOL_BENCHMARK.tier).toBe(TIERS.FACT);
  });

  it('marks all three HISTORICAL', () => {
    for (const kind of DEV_KINDS) {
      expect(EVIDENCE_KINDS[kind].temporality, kind).toBe(TEMPORALITY.HISTORICAL);
    }
  });

  it('files them under development, not under internal', () => {
    // A family is what an observation is about; a permission is what may be
    // done with it. Folding the second into the first is the mistake that left
    // POSITION_GROUP_SIZE filed as roster evidence with its restriction in a
    // comment.
    for (const kind of DEV_KINDS) {
      expect(EVIDENCE_KINDS[kind].category, kind).toBe('development');
    }
  });

  it('keeps the whole-intake ladder and the pattern in separate dedupe groups', () => {
    const groups = DEV_KINDS.map((k) => EVIDENCE_KINDS[k].dedupeGroup);
    expect(new Set(groups).size).toBe(DEV_KINDS.length);
  });
});

describe('permissions', () => {
  it('denies OUTREACH for all three', () => {
    for (const kind of DEV_KINDS) {
      expect(permissionsFor(kind).OUTREACH, kind).toBe(PERMISSION.DENIED);
      expect(permissionsFor(kind).OUTREACH !== PERMISSION.DENIED, kind).toBe(false);
    }
  });

  it('denies MATCHING_SUMMARY for all three', () => {
    for (const kind of DEV_KINDS) {
      expect(permissionsFor(kind).MATCHING_SUMMARY, kind).toBe(PERMISSION.DENIED);
    }
  });

  it('grants the operator QUALIFIED, not ALLOWED — the window is not optional', () => {
    for (const kind of DEV_KINDS) {
      expect(permissionsFor(kind).OPERATOR_EVIDENCE, kind).toBe(PERMISSION.QUALIFIED);
    }
  });

  it('carries the permissions through onto the built object', () => {
    const ev = freshmanMinutesLadder(athlete, ctxFor(rows()));
    expect(ev.permissions).toEqual({
      OPERATOR_EVIDENCE: PERMISSION.QUALIFIED,
      MATCHING_SUMMARY: PERMISSION.DENIED,
      OUTREACH: PERMISSION.DENIED,
    });
  });
});

describe('selection isolation', () => {
  const history = rows();

  it('never selects a development kind into an email', () => {
    const ctx = ctxFor(history, { benchmarks: bench });
    const result = selectEvidence(athlete, ctx);
    for (const kind of DEV_KINDS) {
      expect(result.selected.map((e) => e.kind), kind).not.toContain(kind);
    }
  });

  it('routes them to internal, where composition cannot see them', () => {
    const ctx = ctxFor(history, { benchmarks: bench });
    const result = selectEvidence(athlete, ctx);
    const internalKinds = result.internal.map((e) => e.kind);
    expect(internalKinds).toContain('FRESHMAN_MINUTES_LADDER');
    // And none of them is offerable as an email angle.
    for (const kind of DEV_KINDS) {
      expect(result.ranked.map((e) => e.kind), kind).not.toContain(kind);
    }
  });

  it('leaves every email-eligible kind exactly as it was', () => {
    // The same programme with and without a philosophy result must produce the
    // same email evidence. This is the isolation guarantee in one assertion.
    const withPhilosophy = selectEvidence(athlete, ctxFor(history, { benchmarks: bench }));
    const without = selectEvidence(athlete, buildProgrammeContext({
      college: { name: 'Example', sport: 'mens-soccer' },
      squad: [], history, coachRows: coachRows(), rosterUpdatedAt: stamp,
    }));
    expect(withPhilosophy.selected.map((e) => e.kind)).toEqual(without.selected.map((e) => e.kind));
    expect(withPhilosophy.paragraph).toEqual(without.paragraph);
    expect(withPhilosophy.structure.key).toEqual(without.structure.key);
  });

  it('keeps every development kind out of the email-eligible set registry-wide', () => {
    const emailable = EVIDENCE_KIND_NAMES.filter((k) => permissionsFor(k).OUTREACH !== PERMISSION.DENIED);
    for (const kind of DEV_KINDS) expect(emailable, kind).not.toContain(kind);
  });
});

/* ------------------------------------------------------------------------- */
/* ATHLETE_COHORT_LADDER — step 9.5                                          */
/* ------------------------------------------------------------------------- */

describe('playerFit provenance', () => {
  /**
   * A programme whose international first-years are numerous enough to survive
   * narrowing, so a cohort actually holds rather than relaxing to the intake.
   */
  function mixedRows({ seasons = ['2022', '2023', '2024', '2025'], intlMinutes = 1200 } = {}) {
    const out = [];
    for (const season of seasons) {
      for (let i = 0; i < 3; i += 1) {
        out.push({
          college_name: 'Example', sport: 'mens-soccer', season,
          player_name: `Intl ${season}-${i}`, position: 'DEFENSE', class_year_label: 'Fr.',
          minutes_played: intlMinutes - i * 300, estimated_graduation_year: Number(season) + 4,
          updated_date: stamp, nationality: 'International', country: 'New Zealand',
        });
      }
      for (let i = 0; i < 3; i += 1) {
        out.push({
          college_name: 'Example', sport: 'mens-soccer', season,
          player_name: `Dom ${season}-${i}`, position: 'MIDFIELD', class_year_label: 'Fr.',
          minutes_played: 400, estimated_graduation_year: Number(season) + 4,
          updated_date: stamp, nationality: 'USA', country: null,
        });
      }
      for (let i = 0; i < 14; i += 1) {
        out.push({
          college_name: 'Example', sport: 'mens-soccer', season,
          player_name: `Vet ${season}-${i}`, position: 'MIDFIELD', class_year_label: 'Jr.',
          minutes_played: 900, estimated_graduation_year: Number(season) + 2,
          updated_date: stamp, nationality: 'USA', country: null,
        });
      }
    }
    return out;
  }

  const fitOf = (history, who = athlete) => {
    const philosophy = programmePhilosophy({ rows: history, coachRows: coachRows() });
    return playerFit(philosophy, who, history);
  };

  it('keeps every pre-existing field', () => {
    const fit = fitOf(mixedRows());
    for (const f of ['asked', 'cohort', 'ladder', 'seasonsObserved', 'position', 'wholeIntakeLadder']) {
      expect(fit, f).toHaveProperty(f);
    }
    // The ladder is still whatever it was; provenance is beside it, not instead.
    expect(Array.isArray(fit.ladder)).toBe(true);
  });

  it('adds provenance and nothing else', () => {
    const fit = fitOf(mixedRows());
    const extra = Object.keys(fit).filter((k) => ![
      'asked', 'cohort', 'ladder', 'seasonsObserved', 'position', 'wholeIntakeLadder',
    ].includes(k));
    expect(extra).toEqual(['provenance']);
  });

  it('reports the seasons the COHORT used, not the programme\'s', () => {
    // 2024's internationals are unmeasurable; the domestic intake is fine, so
    // the programme keeps four seasons and the cohort loses one.
    const history = mixedRows().map((r) => (
      r.season === '2024' && r.country === 'New Zealand'
        ? { ...r, minutes_played: null } : r));
    const philosophy = programmePhilosophy({ rows: history, coachRows: coachRows() });
    const fit = playerFit(philosophy, athlete, history);
    expect(philosophy.freshman.seasons.map((s) => String(s.season)))
      .toEqual(['2022', '2023', '2024', '2025']);
    expect(fit.provenance.seasons).toEqual(['2022', '2023', '2025']);
  });

  it('preserves a cohort season that was attempted and unreadable', () => {
    const history = mixedRows().map((r) => (
      r.season === '2024' && r.country === 'New Zealand'
        ? { ...r, minutes_played: null } : r));
    const fit = fitOf(history);
    // The cohort held (no relaxation), so the unreadable set describes it.
    expect(fit.cohort.relaxed).toBeNull();
    expect(fit.provenance.seasonsUnread).toContain('2024');
  });

  it('does not mark a season the programme never had as unreadable', () => {
    const fit = fitOf(mixedRows({ seasons: ['2022', '2023', '2025'] }));
    expect(fit.provenance.seasons).toEqual(['2022', '2023', '2025']);
    expect(fit.provenance.seasonsUnread).toEqual([]);
  });

  it('says null, not empty, when the cohort was relaxed', () => {
    // A programme with too few internationals: the narrowing is refused and
    // relaxed, so the unreadable set on file belongs to the cohort ASKED for.
    const history = rows();
    const fit = fitOf(history);
    expect(fit.cohort.relaxed).toBeTruthy();
    expect(fit.provenance.seasonsUnread).toBeNull();
  });

  it('counts players in the cohort, summed as the sufficiency rule sums them', () => {
    const fit = fitOf(mixedRows());
    // Three international defenders per season across four seasons.
    expect(fit.provenance.players).toBe(12);
    expect(fit.cohort.position).toBe('DEFENSE');
    expect(fit.cohort.origin).toBe('international');
  });

  it('returns null provenance when no profile could be built', () => {
    const fit = fitOf([]);
    expect(fit.provenance).toBeNull();
    expect(fit.ladder).toEqual([]);
  });

  describe('the evidence built from it', () => {
    const ctxWithFit = (history, who = athlete) => {
      const philosophy = programmePhilosophy({ rows: history, coachRows: coachRows() });
      return buildProgrammeContext({
        college: { name: 'Example', sport: 'mens-soccer' },
        squad: [], history, coachRows: coachRows(), rosterUpdatedAt: stamp,
        philosophy, fit: playerFit(philosophy, who, history),
      });
    };

    it('deep-equals the ladder playerFit produced', () => {
      const history = mixedRows();
      const ctx = ctxWithFit(history);
      const ev = athleteCohortLadder(athlete, ctx);
      expect(ev.data.ladder).toEqual(ctx.fit.ladder);
    });

    it('describes the cohort window, never the programme window', () => {
      const history = mixedRows().map((r) => (
        r.season === '2024' && r.country === 'New Zealand'
          ? { ...r, minutes_played: null } : r));
      const ctx = ctxWithFit(history);
      const cohortEv = athleteCohortLadder(athlete, ctx);
      const progEv = freshmanMinutesLadder(athlete, ctx);
      expect(cohortEv.describes.seasons).toEqual(['2022', '2023', '2025']);
      expect(progEv.describes.seasons).toEqual(['2022', '2023', '2024', '2025']);
      expect(cohortEv.describes.seasons).not.toEqual(progEv.describes.seasons);
    });

    it('takes n and the cohort straight from the provenance', () => {
      const ctx = ctxWithFit(mixedRows());
      const ev = athleteCohortLadder(athlete, ctx);
      expect(ev.describes.n).toBe(ctx.fit.provenance.players);
      expect(ev.describes.cohort).toEqual({
        position: ctx.fit.cohort.position, origin: ctx.fit.cohort.origin,
      });
      // And NOT the athlete's own fields, which differ once a narrowing relaxes.
      expect(ev.data.asked).toEqual(ctx.fit.asked);
    });

    it('records whether the unreadable set describes this cohort', () => {
      const relaxed = athleteCohortLadder(athlete, ctxWithFit(rows()));
      // Relaxed programmes produce no cohort narrowing worth reporting, or one
      // whose unread set is unknowable — either way nothing is invented.
      if (relaxed) {
        expect(relaxed.data.unreadSeasonsKnown).toBe(false);
        // UNKNOWN, carried as null rather than flattened to an empty list. An
        // empty list would say we looked and found no holes in THIS cohort,
        // which is the one thing the relaxation means we cannot say.
        expect(relaxed.describes.seasonsUnread).toBeNull();
      }
      const held = athleteCohortLadder(athlete, ctxWithFit(mixedRows()));
      expect(held.data.unreadSeasonsKnown).toBe(true);
    });

    it('records the claim floor without enforcing it', () => {
      const ev = athleteCohortLadder(athlete, ctxWithFit(mixedRows()));
      expect(ev.data.claimFloor).toBe(6);
      expect(ev.data.meetsClaimFloor).toBe(ev.describes.n >= 6);
      // Nothing gates on it yet, and the kind is barred from outreach anyway.
      expect(ev.permissions.OUTREACH).toBe(PERMISSION.DENIED);
    });

    it('generates nothing when no narrowing held', () => {
      // The chain relaxed all the way to the whole intake: that is not this
      // athlete's cohort, and FRESHMAN_MINUTES_LADDER already carries it.
      const history = rows();
      const ctx = ctxWithFit(history);
      if (!ctx.fit.cohort?.applied) expect(athleteCohortLadder(athlete, ctx)).toBeNull();
    });

    it('generates nothing without a fit on the context', () => {
      const history = mixedRows();
      const ctx = buildProgrammeContext({
        college: { name: 'Example', sport: 'mens-soccer' },
        squad: [], history, coachRows: coachRows(), rosterUpdatedAt: stamp,
        philosophy: programmePhilosophy({ rows: history, coachRows: coachRows() }),
      });
      expect(athleteCohortLadder(athlete, ctx)).toBeNull();
    });

    it('is QUALIFIED for the operator and DENIED everywhere else', () => {
      expect(permissionsFor('ATHLETE_COHORT_LADDER')).toEqual({
        OPERATOR_EVIDENCE: PERMISSION.QUALIFIED,
        MATCHING_SUMMARY: PERMISSION.DENIED,
        OUTREACH: PERMISSION.DENIED,
      });
    });

    it('has no copy, so nothing can render it into an email', async () => {
      const { RENDERABLE_KINDS } = await import('./render.js');
      expect(RENDERABLE_KINDS).not.toContain('ATHLETE_COHORT_LADDER');
    });

    it('never enters outreach selection', () => {
      const result = selectEvidence(athlete, ctxWithFit(mixedRows()));
      expect(result.selected.map((e) => e.kind)).not.toContain('ATHLETE_COHORT_LADDER');
      expect(result.ranked.map((e) => e.kind)).not.toContain('ATHLETE_COHORT_LADDER');
    });

    it('keeps the two ladders in different dedupe groups so neither hides the other', () => {
      expect(EVIDENCE_KINDS.ATHLETE_COHORT_LADDER.dedupeGroup)
        .not.toBe(EVIDENCE_KINDS.FRESHMAN_MINUTES_LADDER.dedupeGroup);
    });
  });
});
