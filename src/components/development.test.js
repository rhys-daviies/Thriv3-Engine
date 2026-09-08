import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Development from './Development.jsx';
import ProgrammeDecision from './ProgrammeDecision.jsx';
import { developmentCopyFor, developmentWindow, DEV_COPY_KINDS, windowCopy, cohortCopy } from '@/lib/developmentEvidenceCopy';
import { DEV_FIXTURES } from '@/lib/__fixtures__/developmentEvidence.js';
import { SECTION_OF, SECTIONS } from '@shared/evidence/operatorEvidence.js';

/**
 * The Development section, against real payloads for ten real programmes.
 *
 * Two properties dominate. The first is NEUTRALITY: all four kinds are neutral
 * measurements, none is a top reason, and the interface must not be the thing
 * that turns "the most-used first-year plays 1,472 minutes" into "a strong
 * development programme". The second is the seasonsUnread tri-state, where
 * `[]`, `["2024"]` and `null` mean three different things and the wrong one
 * would either invent coverage we do not have or warn about a gap that is not
 * there.
 */

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const dev = (name) => DEV_FIXTURES[name].sections.DEVELOPMENT;
const render = (name) => renderToStaticMarkup(createElement(Development, { items: dev(name) }));
const item = (name, kind) => dev(name).find((i) => i.kind === kind);

/** Every word that would make a measurement into a judgement. */
const INTERPRETIVE = [
  /\bstrong\b/i, /\bweak\b/i, /\bgood\b/i, /\bbad\b/i, /\bpoor\b/i, /\bexcellent\b/i,
  /\bfavourable\b/i, /\bfavorable\b/i, /\bunfavourable\b/i, /\battractive\b/i,
  /\bconcerning\b/i, /\bopportunity\b/i, /\brisk\b/i, /\blikely\b/i, /\bunlikely\b/i,
  /\bpromising\b/i, /\bimpressive\b/i, /\bbetter than\b/i, /\bworse than\b/i,
  /\babove average\b/i, /\bbelow average\b/i, /\bwill (get|play|receive)\b/i,
  /\bexpect\b/i, /\bshould (get|play|expect)\b/i,
];

describe('every development kind can be presented', () => {
  it('covers all four kinds filed into this section', () => {
    const filed = Object.entries(SECTION_OF)
      .filter(([, section]) => section === SECTIONS.DEVELOPMENT)
      .map(([kind]) => kind);
    expect(filed).toHaveLength(4);
    expect(filed.filter((k) => !DEV_COPY_KINDS.includes(k))).toEqual([]);
  });

  it('presents every item in every fixture', () => {
    const missing = [];
    for (const name of Object.keys(DEV_FIXTURES)) {
      for (const i of dev(name)) if (!developmentCopyFor(i)) missing.push(`${name}/${i.kind}`);
    }
    expect(missing).toEqual([]);
  });

  it('shows an unknown kind rather than dropping it', () => {
    const html = renderToStaticMarkup(createElement(Development, {
      items: [{ kind: 'SOME_FUTURE_DEV_KIND', facts: {}, qualification: {} }],
    }));
    expect(text(html)).toContain('No development wording');
  });

  it('returns null rather than half a row when a fact is missing', () => {
    expect(developmentCopyFor({ kind: 'PROGRAMME_POOL_BENCHMARK', facts: { band: 'above-p75' } })).toBeNull();
    expect(developmentCopyFor({ kind: 'NOT_A_KIND', facts: {} })).toBeNull();
    expect(developmentCopyFor(null)).toBeNull();
  });
});

describe('nothing here is turned into a judgement', () => {
  it('uses no interpretive language on any fixture', () => {
    for (const name of Object.keys(DEV_FIXTURES)) {
      const t = text(render(name));
      for (const pattern of INTERPRETIVE) {
        expect(t, `${name} matched ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('carries no polarity or reason ranking', () => {
    // All four are NEUTRAL and none is a top reason. The section must not
    // number them or read as reasons five through eight.
    for (const name of Object.keys(DEV_FIXTURES)) {
      for (const i of dev(name)) expect(i.polarity).toBe('NEUTRAL');
    }
    const html = render('Duke');
    // The measurements themselves are an unordered list. Ordered lists appear
    // only inside ladders, where the rank IS the data — one per laddered item.
    const laddered = dev('Duke').filter((i) => developmentCopyFor(i).ladder).length;
    expect((html.match(/<ol/g) ?? [])).toHaveLength(laddered);
    expect(html).toContain('<ul class');
    expect(text(html)).not.toMatch(/reason/i);
  });

  it('adds no badge, tag or colour that means good or bad', () => {
    const html = render('Duke');
    for (const cls of ['text-emerald', 'bg-emerald', 'text-red', 'bg-red', 'text-green',
      'bg-green', 'amber-500/15', 'text-primary']) {
      expect(html).not.toContain(cls);
    }
  });
});

describe('the classifier speaks in its own words', () => {
  const pattern = item('Carleton (Ryan)', 'PROGRAMME_DEVELOPMENT_PATTERN');

  it('renders verdictNote and never verdictKey', () => {
    expect(pattern.facts.verdictKey).toBe('steady');
    const copy = developmentCopyFor(pattern);
    expect(copy.headline).toBe(pattern.facts.verdictNote);
    // The key is analytical vocabulary; the fact extractor's own note forbids
    // printing it as a sentence.
    expect(text(render('Carleton (Ryan)'))).not.toContain('steady');
  });

  it('refuses the item rather than inventing a sentence when the note is absent', () => {
    expect(developmentCopyFor({
      kind: 'PROGRAMME_DEVELOPMENT_PATTERN',
      facts: { verdictKey: 'regime-change', verdictNote: null, seasonsObserved: 4, players: 20 },
    })).toBeNull();
  });

  it('renders a non-steady verdict just as plainly', () => {
    const other = item('Duke', 'PROGRAMME_DEVELOPMENT_PATTERN');
    expect(other.facts.verdictKey).not.toBe('steady');
    expect(text(render('Duke'))).toContain(other.facts.verdictNote);
  });

  it('does not render the classifier\'s own thresholds', () => {
    // `spread` and `step` are the standard deviation and swing the classifier
    // compared against its constants. Without those constants they are noise,
    // and the note already says what they produced.
    expect(pattern.facts.spread).toEqual(expect.any(Number));
    const t = text(render('Carleton (Ryan)'));
    expect(t).not.toContain(String(pattern.facts.spread));
    expect(t).not.toContain(String(pattern.facts.step));
  });

  it('shows the three mean shares the pattern was read off', () => {
    const t = text(render('Carleton (Ryan)'));
    const shares = pattern.facts.minuteShares;
    expect(t).toContain(`${Math.round(shares.freshman)}%`);
    expect(t).toContain('First-years');
    expect(t).toContain('Returning players');
  });
});

describe('the first-year ladder is history, not a forecast', () => {
  const ladder = item('Carleton (Ryan)', 'FRESHMAN_MINUTES_LADDER');
  const copy = developmentCopyFor(ladder);
  const t = text(render('Carleton (Ryan)'));

  it('renders a row per rank with the median and the observed range', () => {
    expect(copy.ladder).toHaveLength(ladder.facts.ladder.length);
    const first = ladder.facts.ladder[0];
    expect(t).toContain(`${first.median.toLocaleString('en-GB')} min`);
    expect(t).toContain(`${first.low.toLocaleString('en-GB')}–${first.high.toLocaleString('en-GB')}`);
  });

  it('reports the medians the server computed and derives none', () => {
    expect(copy.detail).toContain(`median intake of ${ladder.facts.medianIntake}`);
    expect(copy.detail).toContain(`${ladder.facts.medianPlayed} played`);
  });

  it('states impact seasons as a count, not a rate', () => {
    expect(copy.detail).toContain(
      `${ladder.facts.seasonsWithAnImpactFreshman} of those seasons had a first-year`,
    );
    expect(copy.detail).not.toMatch(/%|per season|each year/);
  });

  it('promises no minutes to this athlete', () => {
    // Asserted on the measurement's own copy rather than the whole section:
    // the section intro deliberately says these are "not predictions about
    // what this athlete would get", which is the disclaimer, not a claim.
    const line = `${copy.headline} ${copy.detail}`;
    for (const claim of [/you would/i, /this athlete would/i, /can expect/i, /would play/i,
      /is likely to/i, /projected to/i]) {
      expect(line).not.toMatch(claim);
    }
    for (const row of copy.ladder) expect(JSON.stringify(row)).not.toMatch(/expect|likely|would/i);
  });
});

describe('the cohort ladder describes the population it actually used', () => {
  it('describes a cohort cut to position only', () => {
    const cohort = item('Carleton (Ryan)', 'ATHLETE_COHORT_LADDER');
    expect(cohort.qualification.window.cohort).toEqual({ position: 'DEFENSE', origin: null });
    const copy = developmentCopyFor(cohort);
    expect(copy.headline).toBe('First-year defenders');
    // Origin is null in the applied cohort, so no origin words appear.
    expect(copy.headline).not.toMatch(/international|domestic/i);
  });

  it('describes a cohort cut to origin only', () => {
    const cohort = item('Duke', 'ATHLETE_COHORT_LADDER');
    expect(cohort.qualification.window.cohort.position).toBeNull();
    const copy = developmentCopyFor(cohort);
    expect(copy.headline).toContain('international');
    // Position is null, so no position words appear — not even the athlete's.
    for (const word of ['defender', 'defenders', 'forward', 'midfield']) {
      expect(copy.headline.toLowerCase()).not.toContain(word);
    }
  });

  it('describes a cohort that kept both axes', () => {
    const cohort = item('Oregon State', 'ATHLETE_COHORT_LADDER');
    expect(cohort.qualification.window.cohort).toEqual({ position: 'DEFENSE', origin: 'international' });
    expect(developmentCopyFor(cohort).headline).toBe('First-year defenders · international');
  });

  it('never describes the cohort that was asked for but not applied', () => {
    // Carleton asked for DEFENSE + international and applied DEFENSE alone.
    // 1,539 of 1,719 real cohort ladders were relaxed, so describing `asked`
    // would misdescribe the population in the majority of cases.
    const cohort = item('Carleton (Ryan)', 'ATHLETE_COHORT_LADDER');
    expect(cohort.facts.asked).toEqual({ position: 'DEFENSE', origin: 'international' });
    expect(cohort.facts.relaxed).toBe('DEFENSE');
    expect(developmentCopyFor(cohort).headline).not.toContain('international');
  });

  it('says why the narrower cut was not used, in the backend\'s own words', () => {
    const cohort = item('Carleton (Ryan)', 'ATHLETE_COHORT_LADDER');
    expect(developmentCopyFor(cohort).detail).toContain(cohort.facts.refused);
  });

  it('falls back to all first-years when the cohort names no axis', () => {
    expect(cohortCopy({ position: null, origin: null })).toBe('All first-year players');
    expect(cohortCopy(null)).toBeNull();
  });

  it('reports the sample size without calling it sufficient', () => {
    const cohort = item('Carleton (Ryan)', 'ATHLETE_COHORT_LADDER');
    const copy = developmentCopyFor(cohort);
    expect(copy.detail).toContain(`Based on ${cohort.facts.players} first-year players`);
    const t = text(render('Carleton (Ryan)'));
    // The n>=6 floor is enforced upstream and is not this screen's business.
    for (const claim of [/enough/i, /sufficient/i, /reliable/i, /significant/i, /small sample/i]) {
      expect(t).not.toMatch(claim);
    }
  });
});

describe('the three unread-season states stay three', () => {
  it('says nothing when the window was checked and nothing was missing', () => {
    const cohort = item('Oregon State', 'ATHLETE_COHORT_LADDER');
    expect(cohort.qualification.window.seasonsUnread).toEqual([]);
    expect(developmentWindow(cohort).coverage).toBeNull();
    // And no "0 unread seasons", which would be a sentence about nothing.
    expect(text(render('Oregon State'))).not.toMatch(/0 unread|no unread|coverage/i);
  });

  it('names the seasons when specific ones were unreadable', () => {
    const cohort = item('Lincoln (MO)', 'ATHLETE_COHORT_LADDER');
    expect(cohort.qualification.window.seasonsUnread).toEqual(['2022', '2023']);
    expect(developmentWindow(cohort).coverage).toBe('2022 and 2023 were not readable.');
    expect(text(render('Lincoln (MO)'))).toContain('2022 and 2023 were not readable');
  });

  it('says coverage is unknown when the payload cannot state it', () => {
    const cohort = item('Duke', 'ATHLETE_COHORT_LADDER');
    expect(cohort.qualification.window.seasonsUnread).toBeNull();
    expect(developmentWindow(cohort).coverage).toBe('Season coverage for this cohort is unknown.');
    // Never "0 unread seasons" — null is unknown, not zero, and 1,539 of
    // 1,719 real cohort ladders are in this state.
    expect(text(render('Duke'))).not.toMatch(/0 unread|none unread/i);
  });

  it('gives a single unreadable season the singular', () => {
    expect(windowCopy({ seasons: ['2022', '2023'], seasonsUnread: ['2023'], n: 4 }).coverage)
      .toBe('2023 was not readable.');
  });
});

describe('a window with a gap in it says so', () => {
  it('lists non-contiguous seasons rather than spanning them', () => {
    const portland = dev('Portland').find((i) => i.qualification.window?.seasons?.length === 3);
    expect(portland.qualification.window.seasons).toEqual(['2022', '2023', '2025']);
    // 302 real windows have a hole. "2022–2025" would claim a season that was
    // never read.
    expect(developmentWindow(portland).measured).toBe('Measured across 2022, 2023, 2025');
    expect(text(render('Portland'))).not.toContain('2022–2025');
  });

  it('spans a run of consecutive seasons', () => {
    expect(windowCopy({ seasons: ['2022', '2023', '2024', '2025'], seasonsUnread: [], n: 8 }).measured)
      .toBe('Measured across 2022–2025');
  });

  it('handles a single measured season', () => {
    expect(windowCopy({ seasons: ['2025'], seasonsUnread: [], n: 3 }).measured).toBe('Measured in 2025');
  });
});

describe('the pool benchmark shows a band and never a percentile', () => {
  const bands = {
    'above-p75': 'Duke',
    'at-or-below-p25': 'SMU',
    'p25-to-median': 'Stanford',
    'median-to-p75': 'Wake Forest',
  };

  for (const [band, name] of Object.entries(bands)) {
    it(`renders ${band} in plain words`, () => {
      const bench = item(name, 'PROGRAMME_POOL_BENCHMARK');
      expect(bench.facts.band).toBe(band);
      const copy = developmentCopyFor(bench);
      expect(copy.headline).toMatch(/percentile|median/);
      expect(copy.band).toBe(band);
      expect(text(render(name))).toContain(copy.headline);
    });
  }

  it('invents no percentile when the payload carries none', () => {
    const bench = item('Duke', 'PROGRAMME_POOL_BENCHMARK');
    // Null on all 1,878 real benchmark items. An estimate from the band would
    // be a figure nobody computed.
    expect(bench.qualification.comparison.percentile).toBeNull();
    const t = text(render('Duke'));
    // The only ordinals on screen are the pool's own quartile boundaries,
    // which are what the band is defined against. No percentile is ever
    // attributed to this programme.
    const ordinals = [...new Set(t.match(/\d{1,2}(st|nd|rd|th) percentile/g) ?? [])];
    expect(ordinals.sort()).toEqual(['75th percentile']);
    expect(t).not.toMatch(/approximately|roughly|estimated|around the/i);
    expect(t).not.toMatch(/(sits|ranks|is) (at|in) the \d+/i);
  });

  it('shows the pool quartiles the server sent', () => {
    const bench = item('Duke', 'PROGRAMME_POOL_BENCHMARK');
    const p = bench.facts.pool;
    expect(developmentCopyFor(bench).detail)
      .toContain(`${p.p25.toLocaleString('en-GB')}, ${p.median.toLocaleString('en-GB')}`);
  });

  it('marks the band position without colouring it', () => {
    const html = render('Duke');
    // Four equal ticks, one filled. No gradient, no width that implies
    // magnitude, and the same neutral treatment for the bottom band.
    expect(html).toContain('bg-foreground/70');
    expect(render('SMU')).toContain('bg-foreground/70');
    for (const colour of ['emerald', 'red-', 'green-', 'rose-']) {
      expect(html).not.toContain(colour);
    }
  });

  it('says the same thing about the lowest band as the highest', () => {
    // Both are measurements. Neither is described as a problem or a strength.
    const low = text(render('SMU'));
    for (const pattern of INTERPRETIVE) expect(low).not.toMatch(pattern);
  });
});

describe('an empty section is a gap, not a finding', () => {
  const html = render('Clemson');

  it('has no development evidence in the fixture', () => {
    expect(dev('Clemson')).toEqual([]);
  });

  it('says what is missing without judging the programme', () => {
    expect(text(html)).toContain('No development-history evidence on file');
    // "No development-history evidence on file" is a statement about our
    // records; the forbidden sentences are statements about the programme.
    for (const claim of [/does not develop/i, /develops no/i, /never plays/i,
      /no development (record|track|pathway)/i]) {
      expect(text(html)).not.toMatch(claim);
    }
  });

  it('still shows the section, as the other two sections do', () => {
    // The heading stays so the operator can see the section was looked at;
    // the framing paragraph does not, because it explains how to read rows
    // and there are none.
    expect(text(html)).toContain('Development');
    expect(text(html)).not.toContain('How first-year players have been used here');
  });
});

describe('the order is the server\'s', () => {
  it('renders each group in the order it arrived', () => {
    const t = text(render('Duke'));
    for (const scope of ['athlete', 'programme']) {
      const at = dev('Duke')
        .filter((i) => (developmentCopyFor(i).scope === 'programme') === (scope === 'programme'))
        .map((i) => t.indexOf(developmentCopyFor(i).headline));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    }
  });

  it('does not re-rank a list handed to it in another order', () => {
    const reversed = [...dev('Duke')].reverse();
    const t = text(renderToStaticMarkup(createElement(Development, { items: reversed })));
    const order = reversed
      .filter((i) => developmentCopyFor(i).scope === 'programme')
      .map((i) => t.indexOf(developmentCopyFor(i).headline));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('the section sits beneath the others and changes none of them', () => {
  const full = renderToStaticMarkup(
    createElement(ProgrammeDecision, { model: DEV_FIXTURES['Carleton (Ryan)'] }),
  );
  const t = text(full);

  it('renders after Recruitment Pathway', () => {
    expect(t.indexOf('How first-year players have been used here'))
      .toBeGreaterThan(t.indexOf('Recruiting history and roster make-up'));
  });

  it('renders after Roster Opportunity', () => {
    expect(t.indexOf('How first-year players have been used here'))
      .toBeGreaterThan(t.indexOf('Current roster structure'));
  });

  it('is visible without anything being opened', () => {
    // The MEASUREMENTS are open by default; only the provenance behind each
    // one is collapsed, and every provenance panel starts hidden.
    expect(full).not.toContain('<details');
    expect(t).toContain(item('Carleton (Ryan)', 'PROGRAMME_DEVELOPMENT_PATTERN').facts.verdictNote);
    expect(t).toContain('Every first-year, ranked by minutes');
    for (const state of full.match(/aria-expanded="[a-z]+"/g) ?? []) {
      expect(state).toBe('aria-expanded="false"');
    }
  });

  it('appears for a programme with no positive reasons at all', () => {
    // Carleton is the case this section exists for: nothing rose to a reason,
    // and there are still four measurements worth reading.
    expect(DEV_FIXTURES['Carleton (Ryan)'].summary.reasonCount).toBe(0);
    expect(t).toContain('No positive reasons identified');
    expect(t).toContain('First-year defenders');
  });

  it('leaves the roster and pathway sections untouched', () => {
    // Carleton has no roster evidence, so that section shows its heading and
    // its empty line; the pathway section has rows and shows its framing.
    expect(t).toContain('Roster opportunity');
    expect(t).toContain('No roster evidence on file');
    expect(t).toContain('Recruiting history and roster make-up');
  });

  it('renders no raw JSON, validation rules or backend vocabulary', () => {
    expect(full).not.toContain('{"');
    expect(full).not.toContain('[object Object]');
    for (const leak of ['ATHLETE_COHORT_LADDER', 'PROGRAMME_POOL_BENCHMARK', 'verdictKey',
      'minConfidence', 'requiresWindow', 'requiresComparison', 'shareOfSquadMinutes',
      'ladder-rank-1-median-minutes', 'dedupeGroup', 'seasonsUnread']) {
      expect(t).not.toContain(leak);
    }
  });
});
