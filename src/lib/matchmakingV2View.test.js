import { describe, it, expect } from 'vitest';
import * as view from '@/lib/matchmakingV2View';
import { REFUSAL_PHRASE } from '@shared/matching/v2/explain/vocabulary.js';
import {
  persistedRun, LIMITED_DATA_PROGRAMME, UNSUPPORTED_PROGRAMME, MAJOR_REFUSAL_PROGRAMME,
} from '@/lib/__fixtures__/matchmakingV2Run.js';

const {
  runView, programmeView, layerView, scopeProgrammes, scoreOutOf100, stalenessView,
  majorPreference, bandPresentation, statusPresentation, SCOPE, FORBIDDEN_MAJOR_PHRASES,
  RUN_INPUT_FIELDS, changedSinceRun,
} = view;

describe('V2 view model', () => {
  it('V1. the Top 100 is the exact prefix of the one ordering, never a second list', () => {
    const run = runView(persistedRun());
    const top = scopeProgrammes(run.programmes, SCOPE.TOP_100);

    expect(top.every((p) => p.ranked && p.rank <= 100)).toBe(true);
    expect(top.map((p) => p.rank)).toEqual([1, 25, 26, 50, 51, 100]);
    /** Order is the server's. Nothing in the view model re-sorts. */
    expect(top.map((p) => p.rank)).toEqual([...top.map((p) => p.rank)].sort((a, b) => a - b));
  });

  it('V2. #101 and beyond are absent from the Top 100 and present in the full universe', () => {
    const run = runView(persistedRun());
    expect(scopeProgrammes(run.programmes, SCOPE.TOP_100).find((p) => p.rank === 101)).toBeUndefined();

    const all = scopeProgrammes(run.programmes, SCOPE.FULL_UNIVERSE);
    expect(all.find((p) => p.rank === 101)?.name).toBe('Millikin');
    expect(all).toHaveLength(run.programmes.length);
  });

  it('V3. every band boundary maps to the accepted range', () => {
    const run = runView(persistedRun());
    const bandOf = (rank) => run.programmes.find((p) => p.rank === rank).band;

    expect(bandOf(1)).toBe('PRIORITY_OUTREACH');
    expect(bandOf(25)).toBe('PRIORITY_OUTREACH');
    expect(bandOf(26)).toBe('STRONG_PURSUIT');
    expect(bandOf(50)).toBe('STRONG_PURSUIT');
    expect(bandOf(51)).toBe('VIABLE_CONSIDERATION');
    expect(bandOf(100)).toBe('VIABLE_CONSIDERATION');
    expect(bandOf(101)).toBe('BROADER_UNIVERSE');

    expect(bandPresentation('PRIORITY_OUTREACH').range).toBe('1–25');
    expect(bandPresentation('BROADER_UNIVERSE').range).toBe('101+');
  });

  it('V4. exact rank survives into the view model', () => {
    const run = runView(persistedRun());
    expect(run.programmes.find((p) => p.name === 'Catawba').rank).toBe(100);
    expect(run.programmes.find((p) => p.name === 'Millikin').rank).toBe(101);
  });

  it('V5. LIMITED_DATA is not a band and carries no rank', () => {
    const p = programmeView(LIMITED_DATA_PROGRAMME);
    expect(p.ranked).toBe(false);
    expect(p.rank).toBeNull();
    expect(p.band).toBeNull();
    expect(p.pursuit).toBeNull();
    expect(p.missingLayers).toEqual(['opportunity', 'recruitability']);
  });

  it('V6. LIMITED_DATA and UNSUPPORTED are given different words, not one shared state', () => {
    const limited = statusPresentation('SUPPORTED_LIMITED_DATA');
    const unsupported = statusPresentation('UNSUPPORTED_ASSOCIATION');

    expect(limited.label).not.toBe(unsupported.label);
    expect(limited.summary).not.toBe(unsupported.summary);
    expect(limited.tone).not.toBe(unsupported.tone);

    /**
     * Neither sentence may be a claim about the programme's quality or the
     * athlete's chances. Both must say what THRIV3 lacks.
     */
    for (const s of [limited, unsupported]) {
      const text = `${s.summary} ${s.note}`.toLowerCase();
      expect(text).toContain('thriv3');
      for (const banned of ['poor', 'weak', 'bad match', 'low likelihood', 'unlikely']) {
        expect(text).not.toContain(banned);
      }
    }
    /** And the unsupported one must not read as "the athlete cannot go there". */
    expect(unsupported.note.toLowerCase()).toContain('can attend');
  });

  /* ---------------------------------------------------------------- */
  /* Precision                                                        */
  /* ---------------------------------------------------------------- */

  it('V7. Pursuit is rounded, and adjacent ranks are allowed to share a number', () => {
    /**
     * A8 measured that hundreds of adjacent ranks differ by <0.001. #100 and
     * #101 in the fixture are 0.4822 and 0.4821 — a real pair from the live
     * run. Both must display as 48, and the ORDER must still be 100 then 101.
     */
    const run = runView(persistedRun());
    const a = run.programmes.find((p) => p.rank === 100);
    const b = run.programmes.find((p) => p.rank === 101);

    expect(a.pursuit).toBe(48);
    expect(b.pursuit).toBe(48);
    expect(a.rank).toBeLessThan(b.rank);

    expect(scoreOutOf100(0.665709)).toBe(67);
    expect(scoreOutOf100(null)).toBeNull();
    /** No decimals ever reach a surface. */
    expect(Number.isInteger(scoreOutOf100(0.4821))).toBe(true);
  });

  /* ---------------------------------------------------------------- */
  /* Layers                                                           */
  /* ---------------------------------------------------------------- */

  it('V8. a scoreable layer reports coverage only when it is short of full', () => {
    const full = layerView('financial', { state: 'SCOREABLE', value: 0.45, grade: 'PARTIAL', coverage: 1 });
    expect(full.coverage).toBeNull();
    expect(full.gradeText).toBe('Partial evidence');
    expect(full.score).toBe(45);

    const partial = layerView('opportunity', { state: 'SCOREABLE', value: 0.8, grade: 'MEASURED', coverage: 0.62 });
    expect(partial.coverage).toBeCloseTo(0.62);
    expect(partial.gradeText).toBe('Measured');
  });

  it('V9. an unscoreable layer carries the ENGINE’S phrase, not a frontend paraphrase', () => {
    const l = layerView('recruitability', LIMITED_DATA_PROGRAMME.recruitability);
    expect(l.scoreable).toBe(false);
    expect(l.score).toBeNull();
    expect(l.reason).toBe('NO_ROSTER_ON_FILE');
    /** Identity with the frozen vocabulary, not merely "looks similar". */
    expect(l.phrase).toBe(REFUSAL_PHRASE.NO_ROSTER_ON_FILE);
  });

  it('V10. `missing` is dropped, so no surface can depend on a field the persisted run lacks', () => {
    /**
     * The LIVE service emits `missing: [...]` on an unscoreable layer and the
     * PERSISTED run does not. A card reading it would show a line of detail
     * right after Refresh that vanished on the next page load.
     */
    const live = {
      ...LIMITED_DATA_PROGRAMME,
      opportunity: { ...LIMITED_DATA_PROGRAMME.opportunity, missing: ['playingPathway'] },
    };
    const fromLive = programmeView(live);
    const fromPersisted = programmeView(LIMITED_DATA_PROGRAMME);

    expect(JSON.stringify(fromLive)).toBe(JSON.stringify(fromPersisted));
    expect(JSON.stringify(fromLive)).not.toContain('playingPathway');
  });

  /* ---------------------------------------------------------------- */
  /* The major wording boundary — §L                                  */
  /* ---------------------------------------------------------------- */

  it('V11. no exported string of this module can claim a major is not offered', () => {
    /**
     * `FORBIDDEN_MAJOR_PHRASES` is the list itself and is excluded by name —
     * including it would make this test fail against its own fixture, which is
     * exactly the shape of the A8.0B mistake where a guard was written so it
     * could not bite. Everything else is walked, recursively, values only.
     */
    const strings = [];
    const walk = (v) => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    for (const [name, value] of Object.entries(view)) {
      if (name === 'FORBIDDEN_MAJOR_PHRASES') continue;
      if (typeof value === 'function') continue;
      walk(value);
    }

    expect(strings.length).toBeGreaterThan(20);
    for (const s of strings) {
      for (const banned of FORBIDDEN_MAJOR_PHRASES) {
        expect(s.toLowerCase()).not.toContain(banned);
      }
    }
  });

  it('V12. the major refusal phrase says what the recorded list IS, never what it omits', () => {
    const l = layerView('opportunity', MAJOR_REFUSAL_PROGRAMME.opportunity);
    expect(l.phrase).toBe(REFUSAL_PHRASE.MAJOR_NOT_IN_PARTIAL_EVIDENCE);
    for (const banned of FORBIDDEN_MAJOR_PHRASES) {
      expect(l.phrase.toLowerCase()).not.toContain(banned);
    }
    /** And it states the positive fact that licenses the refusal. */
    expect(l.phrase).toContain('largest fields of study');
  });

  it('V13. the major preference is absent rather than "none" when unstated', () => {
    expect(majorPreference({ intended_major: 'Exercise Science' }).label)
      .toBe('Major preference: Exercise Science');
    expect(majorPreference({ intended_major: '   ' })).toBeNull();
    expect(majorPreference({})).toBeNull();
    expect(majorPreference(null)).toBeNull();
  });

  /* ---------------------------------------------------------------- */
  /* Staleness — §D                                                   */
  /* ---------------------------------------------------------------- */

  it('V14. each stale reason becomes operator language, and several can hold at once', () => {
    const s = stalenessView({
      current: false,
      reasons: ['PLAYER_INPUT_CHANGED', 'CORPUS_CHANGED', 'ENGINE_CHANGED'],
    });
    expect(s.current).toBe(false);
    expect(s.reasons).toHaveLength(3);
    expect(s.reasons.map((r) => r.text)).toEqual([
      'The athlete’s profile changed after these matches were generated.',
      'Thriv3’s recruiting data has been updated since these matches were generated.',
      'The matcher has been updated since these matches were generated.',
    ]);
    /** No digest, hash, SHA or schema version reaches the sentence — §O. */
    for (const r of s.reasons) {
      expect(r.text).not.toMatch(/[0-9a-f]{16,}|digest|sha|schema/i);
    }
  });

  it('V15. an unrecognised stale code is dropped rather than printed raw', () => {
    const s = stalenessView({ current: false, reasons: ['CORPUS_CHANGED', 'SOMETHING_NEW'] });
    expect(s.reasons.map((r) => r.code)).toEqual(['CORPUS_CHANGED']);
  });

  it('V16. the run view carries no engine freeze, corpus digest or schema version', () => {
    const run = runView(persistedRun());
    const serialised = JSON.stringify(run);
    expect(serialised).not.toContain('003d144271c9705806e0909f00fd753c778fdeb7');
    expect(serialised).not.toContain('adf924962496cfa1fad1eefd97333edc09994c210d8c072e9e14d3d90e2d240c');
    expect(run.engineFreeze).toBeUndefined();
    expect(run.corpusDigest).toBeUndefined();
    expect(run.resultSchemaVersion).toBeUndefined();
    expect(run.inputSnapshot).toBeUndefined();

    /**
     * A9.4 NARROWED THIS RATHER THAN RELAXING IT.
     *
     * A9.3 carried no part of the snapshot, so "no snapshot" was the whole
     * assertion. §O needs six named preference fields to mark what changed
     * since a ranking, so the check now names the fields that must STILL
     * never reach a surface — which bites on a field being added, where
     * `toBeUndefined()` on the container would not.
     */
    const run2 = runView(persistedRun({
      inputSnapshot: {
        intended_major: 'exercise science',
        competitive_level_priority: 4,
        gpa: 3.9,
        sat_score: 1450,
        act_score: 33,
        state: 'CA',
        nationality: 'USA',
        origin: 'USA',
        football_ability: 9,
      },
    }));
    expect(Object.keys(run2.inputs).sort()).toEqual([...RUN_INPUT_FIELDS].sort());
    for (const excluded of ['gpa', 'sat_score', 'act_score', 'state', 'nationality', 'origin', 'football_ability']) {
      expect(run2.inputs, excluded).not.toHaveProperty(excluded);
    }
    const serialised2 = JSON.stringify(run2);
    for (const value of ['3.9', '1450', '"CA"', '"USA"']) {
      expect(serialised2, value).not.toContain(value);
    }
  });

  it('V18. `inputs` says what the run was computed from, and what has moved since', () => {
    const run = runView(persistedRun({
      inputSnapshot: {
        intended_major: 'exercise science',
        competitive_level_priority: 4,
        playing_opportunity_priority: 5,
        academic_strength_priority: null,
        contribution_state: 'STATED',
        max_annual_contribution_usd: 25000,
      },
    }));
    expect(run.inputs.intended_major).toBe('exercise science');
    expect(run.inputs.academic_strength_priority).toBeNull();

    const unchanged = changedSinceRun({
      intended_major: 'exercise science',
      competitive_level_priority: 4,
      playing_opportunity_priority: 5,
      academic_strength_priority: null,
      contribution_state: 'STATED',
      max_annual_contribution_usd: 25000,
    }, run.inputs);
    expect([...unchanged]).toEqual([]);

    /** Answering a previously unanswered priority is a change. */
    const moved = changedSinceRun({
      intended_major: 'exercise science',
      competitive_level_priority: 4,
      playing_opportunity_priority: 5,
      academic_strength_priority: 5,
      contribution_state: 'STATED',
      max_annual_contribution_usd: 25000,
    }, run.inputs);
    expect([...moved]).toEqual(['academic_strength_priority']);

    /** Compared RAW, so a case change counts — exactly as `inputDigest` does. */
    expect([...changedSinceRun({ intended_major: 'Exercise Science' }, run.inputs)])
      .toContain('intended_major');

    /** A run with no snapshot marks nothing, rather than marking everything. */
    expect([...changedSinceRun({ intended_major: 'anything' }, null)]).toEqual([]);
  });

  it('V17. counts come from the run record, not from recounting the array', () => {
    const run = runView(persistedRun());
    expect(run.counts).toEqual({
      poolSize: 1205, supportedUniverse: 917, ranked: 828, limitedData: 89, unsupported: 288,
    });
    /** The fixture holds 11 programmes and still reports the run's 828. */
    expect(run.programmes).toHaveLength(11);
  });
});
