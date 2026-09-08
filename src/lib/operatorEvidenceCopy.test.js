import { describe, it, expect } from 'vitest';
import { operatorCopyFor, COPY_KINDS, DECISION_CLASS_LABEL } from './operatorEvidenceCopy';
import { FIXTURES } from './__fixtures__/operatorEvidence.js';
import { EVIDENCE_KINDS, DECISION_CLASS, POLARITY } from '@shared/evidence/kinds.js';

/**
 * The presentation layer, and the line it must not cross.
 *
 * These tests are mostly about what the copy registry is NOT allowed to do.
 * It is the one place in the system where a sentence is assembled outside the
 * evidence engine, and the failure mode it invites is a screen that quietly
 * becomes a second source of claims — adding two counts, calling a number
 * good, or filling a gap with something generic that reads like copy someone
 * wrote.
 */

/** Every kind the top-reasons policy can select as a primary. */
const ELIGIBLE = Object.entries(EVIDENCE_KINDS)
  .filter(([, s]) => s.polarity === POLARITY.POSITIVE && s.decisionClass !== DECISION_CLASS.CONTEXT)
  .map(([kind]) => kind);

describe('every kind that can be a reason has words', () => {
  it('covers all fifteen eligible kinds', () => {
    // Read from the registry rather than listed here, so a new positive
    // non-context kind fails this instead of silently rendering as a gap.
    expect(ELIGIBLE).toHaveLength(15);
    expect(ELIGIBLE.filter((k) => !COPY_KINDS.includes(k))).toEqual([]);
  });

  it('adds copy for nothing the policy cannot select', () => {
    // The other direction: copy for a CONTEXT or NEUTRAL kind would be words
    // for a claim this surface never makes, and it would rot unnoticed.
    expect(COPY_KINDS.filter((k) => !ELIGIBLE.includes(k))).toEqual([]);
  });

  it('phrases every kind that really appears in the fixtures', () => {
    const missing = [];
    for (const model of Object.values(FIXTURES)) {
      for (const reason of model.topReasons) {
        if (!operatorCopyFor(reason.primary, 'primary')) missing.push(reason.primary.kind);
        for (const s of reason.supporting) {
          if (!operatorCopyFor(s, 'supporting')) missing.push(s.kind);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('labels the three decision classes a reason can carry', () => {
    expect(Object.keys(DECISION_CLASS_LABEL).sort()).toEqual(['FIT', 'OPENING', 'PATHWAY']);
    // CONTEXT deliberately absent — topReasons never selects one, so a label
    // would be a promise this surface cannot keep.
    expect(DECISION_CLASS_LABEL.CONTEXT).toBeUndefined();
  });
});

describe('an unknown kind fails visibly rather than generically', () => {
  it('returns null instead of assembling something from raw fields', () => {
    expect(operatorCopyFor({ kind: 'SOME_FUTURE_KIND', facts: { count: 4, position: 'DEFENSE' } }))
      .toBeNull();
  });

  it('returns null when a kind it knows cannot fill its own headline', () => {
    // A detail with no conclusion above it would be a floating sentence, and
    // half a claim is worse than none.
    expect(operatorCopyFor({ kind: 'POSITION_GRADUATION', facts: {} })).toBeNull();
  });

  it('survives a missing facts object', () => {
    expect(operatorCopyFor({ kind: 'POSITION_GRADUATION' })).toBeNull();
    expect(operatorCopyFor(null)).toBeNull();
  });
});

describe('roster copy does not do arithmetic', () => {
  const jax = FIXTURES.Jacksonville.topReasons[0];

  it('states the graduation count the server gave it', () => {
    const copy = operatorCopyFor(jax.primary, 'primary');
    expect(jax.primary.facts.count).toBe(3);
    expect(copy.conclusion).toContain('3');
    expect(copy.conclusion).toContain('defenders');
  });

  it('never combines graduation, starters and the cliff into one number', () => {
    const all = [
      operatorCopyFor(jax.primary, 'primary'),
      ...jax.supporting.map((s) => operatorCopyFor(s, 'supporting')),
    ];
    const text = all.map((c) => `${c.conclusion} ${c.detail ?? ''}`).join(' ');
    // Every field, not just the one the component happens to render today.
    expect(text).not.toContain('5 defenders');
    // 3 graduating, 2 of them projected starters, 5 on the cliff across two
    // years — of whom the 2026 rows are the same three. 3+2, 3+5 and 2+5 are
    // all sums this screen must never print.
    for (const forbidden of ['5 defenders', '8 defenders', '7 defenders', '10 defenders']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('gives the eligibility cliff a horizon, not a headcount, under a primary', () => {
    const cliff = jax.supporting.find((s) => s.kind === 'ELIGIBILITY_CLIFF');
    expect(cliff.facts.players).toBe(5);
    const copy = operatorCopyFor(cliff, 'supporting');
    // The number 5 is real and is the cliff's own, but printed beneath "3 in
    // the graduating class" it invites the reader to add or to substitute. No
    // field of the supporting result carries it — not just the one rendered.
    expect(JSON.stringify(copy)).not.toContain('5');
    expect(copy.conclusion).toContain('2027');
    expect(copy.detail).toBeNull();
  });

  it('still gives the cliff its own count when it IS the reason', () => {
    const cliff = FIXTURES.Jacksonville.topReasons[0].supporting
      .find((s) => s.kind === 'ELIGIBILITY_CLIFF');
    const asPrimary = operatorCopyFor(cliff, 'primary');
    // Standalone there is nothing to conflate it with, so withholding the
    // figure would be hiding the finding rather than protecting it.
    expect(asPrimary.conclusion).toContain('5');
  });

  it('does not call the starters a subset of the graduating group', () => {
    const starters = jax.supporting.find((s) => s.kind === 'POSITION_GRADUATION_STARTERS');
    const copy = operatorCopyFor(starters, 'supporting');
    // They are, at Jacksonville — the names overlap — but the API does not say
    // so, and "2 of them" would be this screen asserting a relationship.
    expect(copy.conclusion).not.toMatch(/\bof (them|the)\b/i);
  });
});

describe('pathway copy stays source-faithful', () => {
  const pathway = FIXTURES.Jacksonville.topReasons[1];

  it('does not give a coach claim a position it does not carry', () => {
    expect(pathway.primary.kind).toBe('COACH_ARRIVAL_SAME_COUNTRY');
    expect(pathway.primary.facts.position).toBeNull();
    const copy = operatorCopyFor(pathway.primary, 'primary');
    for (const word of ['defender', 'defenders', 'forward', 'midfield']) {
      expect(copy.conclusion.toLowerCase()).not.toContain(word);
    }
  });

  it('does not merge a region-position support into the coach-country primary', () => {
    const region = pathway.supporting.find((s) => s.kind === 'ARRIVAL_SAME_REGION_POSITION');
    const primary = operatorCopyFor(pathway.primary, 'primary');
    const support = operatorCopyFor(region, 'supporting');
    // "The coach regularly recruits New Zealand defenders" is the claim these
    // two could be melted into, and neither of them makes it.
    expect(primary.conclusion).not.toMatch(/defender/i);
    expect(`${support.conclusion} ${support.detail}`).not.toContain(pathway.primary.facts.coach);
  });

  it('names countries rather than the region key', () => {
    const region = pathway.supporting.find((s) => s.kind === 'ARRIVAL_SAME_REGION_POSITION');
    expect(region.facts.region).toBe('OCEANIA');
    const copy = operatorCopyFor(region, 'primary');
    // A bucket name from the recruiting tables means nothing to an operator,
    // and the countries are checkable against the programme's own roster.
    expect(copy.conclusion).not.toContain('OCEANIA');
    expect(copy.conclusion).toContain(region.facts.countries[0]);
  });
});

describe('fit copy restates the server\'s own direction', () => {
  it('reads momentum from the classification, not from the two percentages', () => {
    const momentum = FIXTURES.Jacksonville.topReasons
      .find((r) => r.primary.kind === 'PROGRAM_MOMENTUM').primary;
    const copy = operatorCopyFor(momentum, 'primary');
    expect(['RISING', 'STRONG']).toContain(momentum.facts.classification);
    expect(copy.conclusion).toBeTruthy();
  });

  it('does not describe a STRONG programme as improving', () => {
    const strong = { kind: 'PROGRAM_MOMENTUM', facts: { classification: 'STRONG', recentWinPct: 0.8, priorWinPct: 0.79 } };
    const copy = operatorCopyFor(strong, 'primary');
    // Comparing the two figures here would be this screen deciding a direction
    // the server classified differently.
    expect(copy.conclusion).not.toMatch(/rising|trend|up/i);
    expect(copy.detail).not.toMatch(/\bup from\b/);
  });

  it('returns null for a momentum classification it has never seen', () => {
    expect(operatorCopyFor({ kind: 'PROGRAM_MOMENTUM', facts: { classification: 'PLUMMETING' } }))
      .toBeNull();
  });

  it('returns null for a postseason round it has never seen', () => {
    expect(operatorCopyFor({ kind: 'POSTSEASON_RESULT', facts: { round: 'play-in' } })).toBeNull();
    expect(operatorCopyFor({ kind: 'POSTSEASON_RESULT', facts: { round: 'champion' } }).conclusion)
      .toMatch(/title/i);
  });

  it('quotes the athlete\'s own words for an academic match', () => {
    const fit = FIXTURES.Jacksonville.topReasons
      .find((r) => r.primary.kind === 'ACADEMIC_FIT').primary;
    const copy = operatorCopyFor(fit, 'primary');
    expect(copy.conclusion).toContain(fit.facts.matchedProgramme);
    expect(copy.detail).toContain(fit.facts.statedByAthlete);
  });
});
