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
import { programmePhilosophy } from '../philosophy.js';
import {
  programmeDevelopmentPattern, freshmanMinutesLadder, programmePoolBenchmark,
  PHILOSOPHY_GENERATORS,
} from './philosophyEvidence.js';
import { buildProgrammeContext } from './generate.js';
import {
  selectEvidence, EVIDENCE_KINDS, EVIDENCE_KIND_NAMES, TIERS, TEMPORALITY,
} from './index.js';
import { PERMISSION, permissionsFor } from './kinds.js';

const DEV_KINDS = [
  'PROGRAMME_DEVELOPMENT_PATTERN', 'FRESHMAN_MINUTES_LADDER', 'PROGRAMME_POOL_BENCHMARK',
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
      expect(EVIDENCE_KINDS[kind].emailEligible, kind).toBe(false);
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
    const emailable = EVIDENCE_KIND_NAMES.filter((k) => EVIDENCE_KINDS[k].emailEligible);
    for (const kind of DEV_KINDS) expect(emailable, kind).not.toContain(kind);
  });
});
