import { describe, it, expect } from 'vitest';
import {
  buildProgrammePatterns, coverageOf, observationsFor, specificityOf,
  countryHistory, countryPositionHistory, regionHistory, regionPositionHistory,
  positionIntake, freshmanMix, coachHistory,
  COVERAGE, COVERAGE_FLOOR, FIELD_COVERAGE_FLOOR, DATA_STATUS, SCOPE,
  SPECIFICITY, POSITION_KEYS, countryDataStatus,
} from './patterns.js';
import { currentCoachScope } from './arrivals.js';
import { canonicalCountry, regionOf, unmappedCountries, REGION_KEYS } from './regions.js';

/**
 * Programme recruiting patterns.
 *
 * The tests that matter here are the ones about what a ZERO means. Every
 * aggregation in patterns.js can count; the thing that can go wrong is a count
 * of nothing being read as a finding when we did not look often enough, or when
 * the column we were counting was never filled in. Both of those produce a
 * confident, wrong sentence about a programme, and both are silent.
 */

const T = ['2022->2023', '2023->2024', '2024->2025', '2025->2026'];

const arrival = (o = {}) => ({
  programme: 'Test',
  sport: 'mens-soccer',
  arrivalSeason: '2026',
  priorSeason: '2025',
  sourceTransition: '2025->2026',
  playerName: 'Sam Smith',
  canonicalPosition: 'DEFENSE',
  country: null,
  isInternational: false,
  entryType: 'FRESHMAN',
  coach: 'Pat Coach',
  coachAttribution: 'ATTRIBUTED',
  priorProgramme: null,
  priorConfidence: 'NONE',
  ...o,
});

/** An international arrival, since country and the flag must move together. */
const intl = (country, o = {}) => arrival({ country, isInternational: true, ...o });

const seasonOf = (t) => t.split('->')[1];
/** Forces an arrival into a given transition, whatever the overrides said. */
const inTransition = (t, o = {}) => ({
  ...arrival(o),
  sourceTransition: t,
  priorSeason: t.split('->')[0],
  arrivalSeason: seasonOf(t),
});

const build = (arrivals, ctx = {}) => buildProgrammePatterns(arrivals, {
  programme: 'Test', sport: 'mens-soccer', comparableTransitions: T, ...ctx,
});

/* ========================================================================== */

describe('A. the coverage floor', () => {
  it('calls three comparable transitions SUFFICIENT', () => {
    const c = coverageOf({ transitions: T.slice(0, 3) });
    expect(c.observedTransitions).toBe(3);
    expect(c.status).toBe(COVERAGE.SUFFICIENT);
    expect(COVERAGE_FLOOR).toBe(3);
  });

  it('calls two INSUFFICIENT', () => {
    expect(coverageOf({ transitions: T.slice(0, 2) }).status).toBe(COVERAGE.INSUFFICIENT);
  });

  it('carries the window as well as what was observed', () => {
    const c = coverageOf({ transitions: T.slice(0, 2), arrivals: 9 });
    expect(c.observedTransitions).toBe(2);
    expect(c.possibleTransitions).toBe(4);
    expect(c.seasons).toEqual(['2023', '2024']);
    expect(c.arrivals).toBe(9);
  });

  /**
   * The floor refuses a description; it never throws data away. A one-intake
   * programme keeps every arrival and every count — what it loses is the right
   * to have those counts read as a tendency.
   */
  it('keeps a low-coverage programme rather than discarding it', () => {
    const p = build([arrival(), arrival({ playerName: 'Alex Jones' })], {
      comparableTransitions: ['2025->2026'],
    });
    expect(p.coverage.status).toBe(COVERAGE.INSUFFICIENT);
    expect(p.arrivals).toBe(2);
    expect(p.positions.positions.DEFENSE.total).toBe(2);
  });
});

describe('B. what a zero is allowed to mean', () => {
  const nz = () => build([
    inTransition('2022->2023', { playerName: 'A One' }),
    inTransition('2023->2024', { playerName: 'B Two' }),
    inTransition('2024->2025', { playerName: 'C Three' }),
    inTransition('2025->2026', intl('Australia', { playerName: 'D Four' })),
  ]);

  it('reports a zero across complete coverage as an observation', () => {
    const p = nz();
    const o = p.countries.countries['New Zealand'];
    expect(o).toBeUndefined();                       // nothing was found...
    const rel = observationsFor({ country: 'New Zealand', canonicalPosition: 'DEFENSE' }, p);
    expect(rel.sameCountry.total).toBe(0);           // ...but the cut still answers
    expect(rel.sameCountry.coverage.status).toBe(COVERAGE.SUFFICIENT);
    expect(p.countries.absence.reportable).toBe(true);
  });

  /**
   * The distinction the whole phase turns on. Same zero, different coverage,
   * and only one of them is data.
   */
  it('refuses the same zero across incomplete coverage', () => {
    const p = build([inTransition('2025->2026', intl('Australia'))], {
      comparableTransitions: ['2025->2026'],
    });
    const rel = observationsFor({ country: 'New Zealand', canonicalPosition: 'DEFENSE' }, p);
    expect(rel.sameCountry.total).toBe(0);
    expect(rel.sameCountry.coverage.status).toBe(COVERAGE.INSUFFICIENT);
    expect(p.countries.absence.reportable).toBe(false);
    expect(p.countries.absence.reasons.join(' ')).toMatch(/1 comparable transition/);
  });

  /**
   * A programme that records no nationalities at all shows the same zero as one
   * that records them scrupulously and has never signed an international. Those
   * are opposite facts and the gate is the only thing that separates them.
   */
  it('refuses a country zero where the programme records no nationalities', () => {
    const p = build(T.map((t) => inTransition(t)));
    expect(p.countries.international.total).toBe(0);
    expect(p.coverage.status).toBe(COVERAGE.SUFFICIENT);
    expect(p.countries.absence.reportable).toBe(false);
    expect(p.countries.absence.reasons.join(' ')).toMatch(/no international arrivals at all/);
  });

  /**
   * Five men's programmes have four transitions and a position on nobody. Their
   * history reads "0 defenders in 4 intakes", which is a parser failure wearing
   * the shape of a finding.
   */
  it('refuses a position zero where the position column is empty', () => {
    const p = build(T.map((t) => inTransition(t, { canonicalPosition: 'UNKNOWN' })));
    expect(p.positions.positions.DEFENSE.total).toBe(0);
    expect(p.positions.absence.reportable).toBe(false);
    expect(p.positions.absence.reasons.join(' ')).toMatch(/position is recorded on 0%/);
    // and the gate travels with the individual position, not just the group
    expect(p.positions.positions.DEFENSE.absence.reportable).toBe(false);
  });

  it('allows a position zero once the column is populated above the floor', () => {
    const p = build(T.map((t) => inTransition(t, { canonicalPosition: 'MIDFIELD' })));
    expect(p.positions.knownShare).toBe(1);
    expect(p.positions.positions.DEFENSE.total).toBe(0);
    expect(p.positions.absence.reportable).toBe(true);
    expect(FIELD_COVERAGE_FLOOR).toBe(0.8);
  });
});

describe('C. country history', () => {
  const p = () => build([
    inTransition('2022->2023', intl('New Zealand', { playerName: 'A One' })),
    inTransition('2023->2024', intl('New Zealand', { playerName: 'B Two', canonicalPosition: 'FORWARD' })),
    inTransition('2024->2025', intl('Spain', { playerName: 'C Three' })),
    inTransition('2025->2026', arrival({ playerName: 'D Four' })),
  ]);

  it('counts arrivals, seasons, positions and the coach subset per country', () => {
    const o = p().countries.countries['New Zealand'];
    expect(o.total).toBe(2);
    expect(o.seasons).toEqual(['2023', '2024']);
    expect(o.positions).toEqual({ DEFENSE: 1, FORWARD: 1 });
    expect(o.coachAttributed).toBe(2);
    expect(o.transitionsWithArrival).toBe(2);
    expect(o.coverage.observedTransitions).toBe(4);
  });

  it('leaves domestic arrivals out of every country cut', () => {
    const h = p().countries;
    expect(h.distinctCountries).toBe(2);
    expect(h.international.total).toBe(3);
    expect(h.internationalShare).toBeCloseTo(0.75);
    expect(Object.keys(h.countries)).not.toContain('United States');
  });

  it('zero-fills each observation across the observed transitions', () => {
    const o = p().countries.countries['New Zealand'];
    expect(o.byTransition).toEqual({
      '2022->2023': 1, '2023->2024': 1, '2024->2025': 0, '2025->2026': 0,
    });
  });
});

describe('D. country x position', () => {
  const p = () => build([
    inTransition('2022->2023', intl('New Zealand', { playerName: 'A One' })),
    inTransition('2024->2025', intl('New Zealand', { playerName: 'B Two' })),
    inTransition('2025->2026', intl('New Zealand', { playerName: 'C Three', canonicalPosition: 'FORWARD' })),
  ]);

  it('keys on the pair and names the players behind it', () => {
    const o = p().countryPositions.pairs['New Zealand||DEFENSE'];
    expect(o.total).toBe(2);
    expect(o.named.map((n) => n.playerName)).toEqual(['A One', 'B Two']);
    expect(o.seasons).toEqual(['2023', '2025']);
    expect(o.transitionsWithArrival).toBe(2);
    expect(o.specificity).toBe(SPECIFICITY.COUNTRY_POSITION);
  });

  it('does not let one position borrow another position\'s count', () => {
    expect(p().countryPositions.pairs['New Zealand||FORWARD'].total).toBe(1);
    expect(p().countryPositions.pairs['New Zealand||MIDFIELD']).toBeUndefined();
  });
});

describe('E. region and region x position', () => {
  const p = () => build([
    inTransition('2022->2023', intl('New Zealand', { playerName: 'A One' })),
    inTransition('2023->2024', intl('Australia', { playerName: 'B Two' })),
    inTransition('2024->2025', intl('Spain', { playerName: 'C Three', canonicalPosition: 'MIDFIELD' })),
  ]);

  it('gathers countries into their region', () => {
    const o = p().regions.regions.OCEANIA;
    expect(o.total).toBe(2);
    expect(Object.keys(o.countries).sort()).toEqual(['Australia', 'New Zealand']);
    expect(o.transitionsWithArrival).toBe(2);
    expect(p().regions.regions.EUROPE.total).toBe(1);
  });

  it('crosses region with position', () => {
    const o = p().regionPositions.pairs['OCEANIA||DEFENSE'];
    expect(o.total).toBe(2);
    expect(o.specificity).toBe(SPECIFICITY.REGION_POSITION);
    expect(p().regionPositions.pairs['EUROPE||MIDFIELD'].total).toBe(1);
  });
});

describe('F. region normalisation and unmapped countries', () => {
  it('normalises the aliases the roster data actually contains', () => {
    expect(canonicalCountry('Korea, Republic of')).toBe('South Korea');
    expect(canonicalCountry('Russian Federation')).toBe('Russia');
    expect(canonicalCountry('Türkiye')).toBe('Turkey');
    expect(canonicalCountry('Viet Nam')).toBe('Vietnam');
    expect(canonicalCountry("Cote d'Ivoire")).toBe("Côte d'Ivoire");
    expect(canonicalCountry('  United   Kingdom ')).toBe('United Kingdom');
  });

  it('files an alias in the same region as its canonical spelling', () => {
    expect(regionOf('Korea, Republic of')).toBe('ASIA');
    expect(regionOf('South Korea')).toBe('ASIA');
    expect(regionOf('Türkiye')).toBe(regionOf('Turkey'));
    expect(regionOf("Cote d'Ivoire")).toBe('AFRICA');
  });

  it('keeps the transcontinental decisions the taxonomy documents', () => {
    expect(regionOf('Turkey')).toBe('EUROPE');
    expect(regionOf('Russia')).toBe('EUROPE');
    expect(regionOf('Cyprus')).toBe('EUROPE');
    expect(regionOf('Israel')).toBe('MIDDLE_EAST');
    expect(regionOf('Egypt')).toBe('AFRICA');
    // Split along the CONCACAF Caribbean zone, not the coastline.
    expect(regionOf('Guyana')).toBe('CARIBBEAN');
    expect(regionOf('Belize')).toBe('LATIN_AMERICA');
    expect(regionOf('Ireland')).toBe('UK_IRELAND');
  });

  /**
   * A country we have not placed must return null rather than an OTHER bucket.
   * The hierarchy is SAME COUNTRY -> SAME REGION -> INTERNATIONAL, and a
   * catch-all would let the middle rung fire on two countries whose only
   * relationship is that neither was in the map.
   */
  it('leaves an unrecognised country unplaced, loudly', () => {
    expect(regionOf('Freedonia')).toBeNull();
    const p = build([inTransition('2022->2023', intl('Freedonia'))]);
    expect(p.regions.unplacedInternational).toBe(1);
    expect(p.regions.unplacedCountries).toEqual(['Freedonia']);
    expect(Object.keys(p.regions.regions)).toHaveLength(0);
    // and it is still counted as a country and as an international
    expect(p.countries.countries.Freedonia.total).toBe(1);
  });

  it('reports unmapped values so the map cannot go stale unnoticed', () => {
    const out = unmappedCountries(['Spain', 'Freedonia', 'Freedonia', 'Japan']);
    expect(out.get('Freedonia')).toBe(2);
    expect(out.has('Spain')).toBe(false);
  });

  it('keeps OCEANIA a superset of the frozen evidence map', () => {
    expect(REGION_KEYS).toContain('OCEANIA');
    expect(regionOf('New Zealand')).toBe('OCEANIA');
    expect(regionOf('Australia')).toBe('OCEANIA');
  });
});

describe('G. position intake', () => {
  const p = () => build([
    inTransition('2022->2023', { canonicalPosition: 'DEFENSE', playerName: 'A One' }),
    inTransition('2023->2024', { canonicalPosition: 'DEFENSE', playerName: 'B Two' }),
    inTransition('2023->2024', { canonicalPosition: 'DEFENSE', playerName: 'C Three' }),
    inTransition('2025->2026', { canonicalPosition: 'GOALKEEPER', playerName: 'D Four' }),
  ]);

  it('reports every canonical position, including the ones with nobody in them', () => {
    const out = p().positions.positions;
    expect(Object.keys(out).sort()).toEqual([...POSITION_KEYS].sort());
    expect(out.MIDFIELD.total).toBe(0);
    expect(out.FORWARD.total).toBe(0);
  });

  it('counts by transition, not by season alone', () => {
    const d = p().positions.positions.DEFENSE;
    expect(d.total).toBe(3);
    expect(d.byTransition).toEqual({
      '2022->2023': 1, '2023->2024': 2, '2024->2025': 0, '2025->2026': 0,
    });
    expect(d.transitionsWithArrival).toBe(2);
    expect(d.meanPerTransition).toBeCloseTo(0.75);
    expect(d.mostRecentSeason).toBe('2024');
  });

  /**
   * Position integrity. The roster parser already collapses CB, RB, CDM and the
   * rest onto four keys; nothing in the aggregation may reintroduce a
   * sub-position, because a coach reading "they take centre-backs" would be
   * reading a category this system has never once observed.
   */
  it('never invents a position beyond the four and UNKNOWN', () => {
    const out = build([
      inTransition('2022->2023', { canonicalPosition: 'DEFENSE' }),
      inTransition('2023->2024', { canonicalPosition: 'UNKNOWN' }),
    ]).positions.positions;
    expect(Object.keys(out)).toEqual(expect.arrayContaining(POSITION_KEYS));
    expect(Object.keys(out)).toHaveLength(POSITION_KEYS.length);
    expect(POSITION_KEYS).toEqual(['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD', 'UNKNOWN']);
  });
});

describe('H. freshman / experienced mix', () => {
  const p = () => build([
    inTransition('2022->2023', { entryType: 'FRESHMAN', playerName: 'A One' }),
    inTransition('2022->2023', { entryType: 'EXPERIENCED', playerName: 'B Two' }),
    inTransition('2023->2024', { entryType: 'FRESHMAN', playerName: 'C Three' }),
    inTransition('2024->2025', { entryType: 'UNKNOWN', playerName: 'D Four' }),
  ]);

  it('counts, proportions and breaks down by season', () => {
    const m = p().entryMix;
    expect(m.counts).toMatchObject({ FRESHMAN: 2, EXPERIENCED: 1, UNKNOWN: 1 });
    expect(m.proportions.FRESHMAN).toBeCloseTo(0.5);
    expect(m.bySeason['2023']).toMatchObject({ FRESHMAN: 1, EXPERIENCED: 1, total: 2 });
    expect(m.bySeason['2026']).toMatchObject({ total: 0 });
  });

  it('breaks down by position too', () => {
    expect(p().entryMix.byPosition.DEFENSE).toMatchObject({ FRESHMAN: 2, EXPERIENCED: 1, total: 4 });
  });

  /**
   * EXPERIENCED is a class-label observation, never a transfer count. Where the
   * player came from is a separate confidence with a separate answer, and it is
   * usually NONE.
   */
  it('says nothing about where an experienced arrival came from', () => {
    const m = p().entryMix;
    expect(m).not.toHaveProperty('transfers');
    expect(m).not.toHaveProperty('portal');
  });
});

describe('I. current-coach history', () => {
  const scope = (attributable) => ({ coach: 'Pat Coach', attributableTransitions: attributable });

  const rows = [
    inTransition('2022->2023', { coachAttribution: 'INHERITED', playerName: 'Old One' }),
    inTransition('2023->2024', { playerName: 'A One' }),
    inTransition('2024->2025', { playerName: 'B Two' }),
    inTransition('2025->2026', intl('New Zealand', { playerName: 'C Three' })),
  ].map((r) => ({ ...r, coachAttribution: r.coachAttribution ?? 'ATTRIBUTED' }));

  it('uses only ATTRIBUTED arrivals inside the coach\'s own transitions', () => {
    const p = build(rows, { currentCoach: scope(T.slice(1)) });
    expect(p.coach.attributableArrivals).toBe(3);
    expect(p.coach.attributableTransitions).toBe(3);
    expect(p.coach.coverage.status).toBe(COVERAGE.SUFFICIENT);
    expect(p.coach.earliestSupportedSeason).toBe('2024');
    expect(p.coach.latestSupportedSeason).toBe('2026');
  });

  /** A coach's first roster is their predecessor's recruiting. */
  it('excludes an INHERITED intake and says how many it excluded', () => {
    const p = build(rows, { currentCoach: scope(T.slice(1)) });
    expect(p.coach.excluded.inherited).toBe(1);
    expect(p.coach.positions.positions.DEFENSE.total).toBe(3);
    expect(p.coach.entryMix.total).toBe(3);
    expect(p.coach.countries.countries['New Zealand'].total).toBe(1);
  });

  it('excludes an UNKNOWN attribution outright', () => {
    const p = build(
      rows.map((r) => ({ ...r, coachAttribution: 'UNKNOWN' })),
      { currentCoach: scope(T) },
    );
    expect(p.coach.attributableArrivals).toBe(0);
    expect(p.coach.excluded.unknown).toBe(4);
  });

  it('excludes an ATTRIBUTED arrival that belongs to the previous coach', () => {
    const p = build(rows, { currentCoach: scope(['2025->2026']) });
    expect(p.coach.attributableArrivals).toBe(1);
    expect(p.coach.excluded.otherCoach).toBe(2);
  });

  /**
   * The floor applies to each scope separately. A programme with four
   * transitions and a coach appointed last summer has a describable programme
   * history and no describable coach history — collapsing the two would put the
   * predecessor's recruiting in the new coach's mouth.
   */
  it('applies the floor to the coach independently of the programme', () => {
    const p = build(rows, { currentCoach: scope(['2025->2026']) });
    expect(p.coverage.status).toBe(COVERAGE.SUFFICIENT);
    expect(p.coach.coverage.status).toBe(COVERAGE.INSUFFICIENT);
  });

  it('reports nothing supportable where no coach is on file', () => {
    const p = build(rows, { currentCoach: null });
    expect(p.coach.coach).toBeNull();
    expect(p.coach.attributableTransitions).toBe(0);
    expect(p.coach.coverage.status).toBe(COVERAGE.INSUFFICIENT);
    expect(p.coach.earliestSupportedSeason).toBeNull();
  });

  /**
   * The denominator comes from the tenure, not from the rows. A quiet year in
   * which the coach signed nobody must still count against them, or "an
   * international in every transition" is measured against a denominator the
   * observation chose for itself.
   */
  it('counts a transition the coach recruited nobody in', () => {
    const p = build(
      [inTransition('2025->2026', { playerName: 'A One' })],
      { currentCoach: scope(['2023->2024', '2024->2025', '2025->2026']) },
    );
    expect(p.coach.attributableTransitions).toBe(3);
    expect(p.coach.positions.positions.DEFENSE.transitionsWithArrival).toBe(1);
    expect(p.coach.positions.positions.DEFENSE.byTransition).toEqual({
      '2023->2024': 0, '2024->2025': 0, '2025->2026': 1,
    });
  });

  it('derives that scope from the tenure rather than from arrivals', () => {
    const coachRows = [
      { season: 2022, coach_name: 'Old Boss' },
      { season: 2023, coach_name: 'Pat Coach' },
      { season: 2024, coach_name: 'Pat Coach' },
      { season: 2025, coach_name: 'Pat Coach' },
      { season: 2026, coach_name: 'Pat Coach' },
    ];
    const s = currentCoachScope({ coachRows, comparableTransitions: T });
    expect(s.coach).toBe('Pat Coach');
    expect(s.inheritedTransitions).toEqual(['2022->2023']);
    expect(s.attributableTransitions).toEqual(['2023->2024', '2024->2025', '2025->2026']);
  });
});

describe('J. sport gating', () => {
  it('licenses men\'s country data and withholds women\'s', () => {
    expect(countryDataStatus('mens-soccer').status).toBe(DATA_STATUS.LICENSED);
    expect(countryDataStatus('womens-soccer').status).toBe(DATA_STATUS.UNVALIDATED);
  });

  it('says what would have to be checked before women\'s could be licensed', () => {
    const s = countryDataStatus('womens-soccer');
    expect(s.validationNeeded.length).toBeGreaterThan(0);
    expect(s.reason).toMatch(/9\.7%/);
  });

  /**
   * Country is populated on 100% of rows flagged International in BOTH sports.
   * The gate exists because that statistic is not the question — 9.7% of
   * women's arrivals carry the flag at all, against 29.1% of men's, and roster
   * data cannot separate under-recording from a smaller international share.
   */
  it('stamps the status onto every country and region cut, not just the sport', () => {
    const w = build([inTransition('2022->2023', intl('New Zealand'))], { sport: 'womens-soccer' });
    expect(w.dataStatus.status).toBe(DATA_STATUS.UNVALIDATED);
    expect(w.countries.countries['New Zealand'].dataStatus.status).toBe(DATA_STATUS.UNVALIDATED);
    expect(w.regions.regions.OCEANIA.dataStatus.status).toBe(DATA_STATUS.UNVALIDATED);
    expect(w.countryPositions.pairs['New Zealand||DEFENSE'].dataStatus.status)
      .toBe(DATA_STATUS.UNVALIDATED);
  });

  it('blocks a women\'s country absence even at full transition coverage', () => {
    const w = build(T.map((t) => inTransition(t, intl('Spain'))), { sport: 'womens-soccer' });
    expect(w.coverage.status).toBe(COVERAGE.SUFFICIENT);
    expect(w.countries.absence.reportable).toBe(false);
    expect(w.countries.absence.reasons.join(' ')).toMatch(/UNVALIDATED/);
  });

  it('leaves position and entry-mix cuts ungated by sport', () => {
    const w = build(T.map((t) => inTransition(t)), { sport: 'womens-soccer' });
    expect(w.positions.absence.reportable).toBe(true);
    expect(w.entryMix.absence.reportable).toBe(true);
  });
});

describe('K. the player-relative query', () => {
  const p = () => build([
    inTransition('2022->2023', intl('New Zealand', { playerName: 'Kiwi Defender' })),
    inTransition('2023->2024', intl('Australia', { playerName: 'Aussie Keeper', canonicalPosition: 'GOALKEEPER' })),
    inTransition('2024->2025', intl('Spain', { playerName: 'Spanish Mid', canonicalPosition: 'MIDFIELD' })),
    inTransition('2025->2026', { playerName: 'Local Lad' }),
  ], { currentCoach: { coach: 'Pat Coach', attributableTransitions: T.slice(1) } });

  const rhys = { country: 'New Zealand', canonicalPosition: 'DEFENSE', entryType: 'FRESHMAN' };

  it('answers every axis for an international athlete', () => {
    const o = observationsFor(rhys, p());
    expect(o.player).toMatchObject({ country: 'New Zealand', region: 'OCEANIA', canonicalPosition: 'DEFENSE' });
    expect(o.sameCountry.total).toBe(1);
    expect(o.sameCountryPosition.total).toBe(1);
    expect(o.sameRegion.total).toBe(2);
    expect(o.sameRegionPosition.total).toBe(1);
    expect(o.positionHistory.total).toBe(2);
    expect(o.internationalPositionHistory.total).toBe(1);
    expect(o.internationalHistory.total).toBe(3);
    expect(o.entryTypeHistory).toMatchObject({ entryType: 'FRESHMAN', count: 4 });
  });

  /** An applicable cut that found nothing is an observation; an inapplicable one is null. */
  it('separates "nothing found" from "does not apply"', () => {
    const o = observationsFor({ country: 'Japan', canonicalPosition: 'FORWARD' }, p());
    expect(o.sameCountry.total).toBe(0);
    expect(o.sameCountry.coverage.status).toBe(COVERAGE.SUFFICIENT);

    const domestic = observationsFor({ canonicalPosition: 'DEFENSE' }, p());
    expect(domestic.sameCountry).toBeNull();
    expect(domestic.sameRegion).toBeNull();
    expect(domestic.positionHistory.total).toBe(2);
  });

  it('keeps the coach answers on the coach\'s own coverage', () => {
    const o = observationsFor(rhys, p());
    // Kiwi Defender arrived in the transition the coach inherited.
    expect(o.coachSameCountry.total).toBe(0);
    expect(o.coachSameCountry.coverage.scope).toBe(SCOPE.COACH);
    expect(o.coachSameCountry.coverage.observedTransitions).toBe(3);
    expect(o.coachSameRegion.total).toBe(1);
  });

  it('returns data and nothing that reads as a claim', () => {
    const o = observationsFor(rhys, p());
    for (const key of ['fit', 'score', 'rank', 'recommendation', 'summary', 'prose']) {
      expect(o).not.toHaveProperty(key);
    }
    expect(typeof o.sameCountry.total).toBe('number');
  });

  it('returns null rather than guessing when there are no patterns', () => {
    expect(observationsFor(rhys, null)).toBeNull();
  });
});

describe('L. specificity metadata', () => {
  it('names the axes an observation was cut on', () => {
    expect(specificityOf({})).toBe(SPECIFICITY.GENERAL);
    expect(specificityOf({ position: 'DEFENSE' })).toBe(SPECIFICITY.POSITION);
    expect(specificityOf({ region: 'OCEANIA' })).toBe(SPECIFICITY.REGION);
    expect(specificityOf({ country: 'New Zealand' })).toBe(SPECIFICITY.COUNTRY);
    expect(specificityOf({ region: 'OCEANIA', position: 'DEFENSE' })).toBe(SPECIFICITY.REGION_POSITION);
    expect(specificityOf({ country: 'New Zealand', position: 'DEFENSE' }))
      .toBe(SPECIFICITY.COUNTRY_POSITION);
    expect(specificityOf({ country: 'New Zealand', position: 'DEFENSE', coach: true }))
      .toBe(SPECIFICITY.COACH_COUNTRY_POSITION);
  });

  it('prefers the country over the region when both are present', () => {
    expect(specificityOf({ country: 'New Zealand', region: 'OCEANIA' })).toBe(SPECIFICITY.COUNTRY);
  });
});

describe('M. the aggregations refuse to interpret', () => {
  const p = () => build(T.map((t) => inTransition(t, intl('New Zealand'))));

  /**
   * The line this phase is not allowed to cross. Every one of these keys would
   * be a claim about intent, and intent is the one thing two roster snapshots
   * cannot see.
   */
  it('exposes no field that characterises a programme', () => {
    const flat = JSON.stringify(p());
    for (const word of ['prefers', 'likes', 'targets', 'needs', 'tendency', 'pipeline', 'consistently']) {
      expect(flat.toLowerCase()).not.toContain(word);
    }
  });

  it('reports observations that a later phase could read, and no reading', () => {
    const o = p().countryPositions.pairs['New Zealand||DEFENSE'];
    expect(o.total).toBe(4);
    expect(o.transitionsWithArrival).toBe(4);
    expect(o.coverage.observedTransitions).toBe(4);
    expect(o.named).toHaveLength(4);
  });
});

describe('N. the aggregations stand alone', () => {
  const rows = [inTransition('2022->2023', intl('New Zealand'))];
  const ctx = { coverage: coverageOf({ transitions: T, arrivals: 1 }) };

  it('each is callable without the assembled programme object', () => {
    expect(countryHistory(rows, ctx).distinctCountries).toBe(1);
    expect(Object.keys(countryPositionHistory(rows, ctx).pairs)).toEqual(['New Zealand||DEFENSE']);
    expect(regionHistory(rows, ctx).regions.OCEANIA.total).toBe(1);
    expect(regionPositionHistory(rows, ctx).pairs['OCEANIA||DEFENSE'].total).toBe(1);
    expect(positionIntake(rows, ctx).positions.DEFENSE.total).toBe(1);
    expect(freshmanMix(rows, ctx).counts.FRESHMAN).toBe(1);
    expect(coachHistory(rows, { ...ctx, currentCoach: null }).attributableArrivals).toBe(0);
  });

  it('handles an empty programme without inventing coverage', () => {
    const p = build([], { comparableTransitions: [] });
    expect(p.arrivals).toBe(0);
    expect(p.coverage.status).toBe(COVERAGE.INSUFFICIENT);
    expect(p.positions.positions.DEFENSE.meanPerTransition).toBeNull();
    expect(p.countries.internationalShare).toBeNull();
  });
});
