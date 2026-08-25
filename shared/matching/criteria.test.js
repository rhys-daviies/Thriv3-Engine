import { describe, it, expect } from 'vitest';
import {
  athleticFit,
  rosterOpportunity,
  academicFit,
  affordability,
  athleticAidFraction,
  programQuality,
  geography,
  GRAD_YEAR_NULL_TOLERANCE,
} from './criteria.js';
import { NEUTRAL_PRIOR, AFFORDABILITY_FLOOR } from './constants.js';

const inRange = (r) => r.score >= 0 && r.score <= 1 && Number.isFinite(r.score);

describe('athleticFit', () => {
  it('peaks when the athlete is marginally above the program level', () => {
    const at = athleticFit({ athleteLevel: 64, programLevel: 60 }).score;
    expect(at).toBeGreaterThan(athleticFit({ athleteLevel: 60, programLevel: 60 }).score);
    expect(at).toBeGreaterThan(athleticFit({ athleteLevel: 70, programLevel: 60 }).score);
    expect(at).toBeCloseTo(1, 5);
  });

  it('is asymmetric: being under a program hurts more than being over it', () => {
    const under = athleticFit({ athleteLevel: 40, programLevel: 64 }).score;
    const over = athleticFit({ athleteLevel: 88, programLevel: 64 }).score;
    expect(under).toBeLessThan(over);
  });

  it('labels reach, target and safety from the signed gap', () => {
    expect(athleticFit({ athleteLevel: 40, programLevel: 60 }).label).toBe('reach');
    expect(athleticFit({ athleteLevel: 62, programLevel: 60 }).label).toBe('target');
    expect(athleticFit({ athleteLevel: 85, programLevel: 60 }).label).toBe('safety');
  });

  it('falls back to the prior when either side is unknown', () => {
    expect(athleticFit({ athleteLevel: null, programLevel: 60 })).toMatchObject({ score: NEUTRAL_PRIOR, confidence: 'assumed' });
    expect(athleticFit({ athleteLevel: 60, programLevel: undefined })).toMatchObject({ score: NEUTRAL_PRIOR, confidence: 'assumed' });
  });

  it('never returns NaN for unparseable input', () => {
    expect(inRange(athleticFit({ athleteLevel: 'abc', programLevel: 60 }))).toBe(true);
  });
});

describe('rosterOpportunity', () => {
  const base = { position: 'MIDFIELD', rosterRowsForSchool: 28, rowsMissingGradYear: 0 };

  it('treats an unscraped school as unknown, not as zero opportunity', () => {
    const r = rosterOpportunity({ position: 'MIDFIELD', rosterRowsForSchool: 0 });
    expect(r).toMatchObject({ score: NEUTRAL_PRIOR, confidence: 'assumed' });
  });

  it('scores a school with roster data but no departures as a measured zero', () => {
    const r = rosterOpportunity({ ...base, graduatingStarters: 0, graduatingSquad: 0 });
    expect(r.score).toBe(0);
    expect(r.confidence).toBe('measured');
  });

  it('caps opportunity at 1 however many players graduate', () => {
    const three = rosterOpportunity({ ...base, graduatingStarters: 3, graduatingSquad: 0 });
    const many = rosterOpportunity({ ...base, graduatingStarters: 9, graduatingSquad: 6 });
    expect(three.score).toBe(1);
    expect(many.score).toBe(1);
  });

  it('normalises against position need, so one goalkeeper is worth more than one midfielder', () => {
    const gk = rosterOpportunity({ ...base, position: 'GOALKEEPER', graduatingStarters: 1 });
    const mf = rosterOpportunity({ ...base, position: 'MIDFIELD', graduatingStarters: 1 });
    expect(gk.score).toBeGreaterThan(mf.score);
  });

  it('weights a graduating starter above a graduating squad player', () => {
    const starter = rosterOpportunity({ ...base, graduatingStarters: 1, graduatingSquad: 0 });
    const squad = rosterOpportunity({ ...base, graduatingStarters: 0, graduatingSquad: 1 });
    expect(starter.score).toBeGreaterThan(squad.score);
  });

  it('blends toward the prior when too many class years are unlabelled', () => {
    const trusted = rosterOpportunity({ ...base, graduatingStarters: 0, graduatingSquad: 0 });
    const dark = rosterOpportunity({ ...base, rowsMissingGradYear: 20, graduatingStarters: 0, graduatingSquad: 0 });
    expect(trusted.score).toBe(0);
    expect(dark.score).toBeGreaterThan(0);
    expect(dark.confidence).toBe('partial');
    expect(dark.detail.missingGradYearShare).toBeGreaterThan(GRAD_YEAR_NULL_TOLERANCE);
  });

  it('uses a default need for an unrecognised position', () => {
    expect(inRange(rosterOpportunity({ ...base, position: 'SWEEPER', graduatingStarters: 1 }))).toBe(true);
  });
});

describe('academicFit', () => {
  it('does not read academic importance at all — that is a weight, not a filter', () => {
    // Same school, same athlete: the sub-score cannot vary with importance
    // because importance is not one of its inputs.
    const args = { academicRating: 8, schoolSatAvg: 1300, athleteSat: 1300 };
    expect(academicFit({ ...args }).score).toBe(academicFit({ ...args, academicImportance: 1 }).score);
  });

  it('rewards a stronger school when the athlete is comfortably admissible', () => {
    const strong = academicFit({ academicRating: 9, schoolSatAvg: 1200, athleteSat: 1400 });
    const weak = academicFit({ academicRating: 4, schoolSatAvg: 1000, athleteSat: 1400 });
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it('discounts a school the athlete is unlikely to get into', () => {
    const likely = academicFit({ academicRating: 9.5, schoolSatAvg: 1500, athleteSat: 1520 });
    const stretch = academicFit({ academicRating: 9.5, schoolSatAvg: 1500, athleteSat: 1050 });
    expect(stretch.score).toBeLessThan(likely.score);
    expect(stretch.label).toBe('stretch');
  });

  it('never zeroes a reach school entirely', () => {
    const stretch = academicFit({ academicRating: 10, schoolSatAvg: 1550, athleteSat: 900 });
    expect(stretch.score).toBeGreaterThan(0);
  });

  it('converts ACT to SAT when only ACT is given', () => {
    const act = academicFit({ academicRating: 8, schoolSatAvg: 1300, athleteAct: 30 });
    expect(act.detail.basis).toBe('sat');
    expect(act.confidence).toBe('measured');
  });

  it('falls back to GPA when no test score is present', () => {
    const r = academicFit({ academicRating: 8, schoolSatAvg: 1300, athleteGpa: 3.9 });
    expect(r.detail.basis).toBe('gpa');
    expect(r.confidence).toBe('partial');
  });

  // Not "assume they get in and rank by school quality" — that ranks an
  // athlete toward stronger academics on no evidence they can get in or that
  // they care, and it measured 3.2 points of median percentile worse across
  // 600 real placements. No input, so the prior, like every other criterion.
  it('scores at the prior when the athlete supplied no academic profile', () => {
    const r = academicFit({ academicRating: 8, schoolSatAvg: 1300 });
    expect(r.score).toBe(NEUTRAL_PRIOR);
    expect(r.confidence).toBe('assumed');
  });

  it('does not let school quality discriminate without an athlete profile', () => {
    const strong = academicFit({ academicRating: 9.8, schoolSatAvg: 1500 });
    const weak = academicFit({ academicRating: 2.1, schoolSatAvg: 900 });
    expect(strong.score).toBe(weak.score);
  });

  it('turns back on as soon as a GPA or a test score is entered', () => {
    const strong = academicFit({ academicRating: 9.8, schoolSatAvg: 1200, athleteSat: 1400 });
    const weak = academicFit({ academicRating: 2.1, schoolSatAvg: 900, athleteSat: 1400 });
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(academicFit({ academicRating: 8, athleteGpa: 3.9 }).confidence).toBe('partial');
  });

  it('falls back to the prior when the school is unrated', () => {
    expect(academicFit({ academicRating: null, athleteSat: 1300 })).toMatchObject({ score: NEUTRAL_PRIOR, confidence: 'assumed' });
  });
});

describe('affordability', () => {
  it('scores a school inside the budget at full marks', () => {
    const r = affordability({ budgetRange: '$15k-$30k/yr', netPrice: 20000, division: 'NCAA D3', sport: 'mens-soccer' });
    expect(r.score).toBe(1);
    expect(r.label).toBe('within budget');
  });

  it('subtracts athletic aid before comparing against the budget', () => {
    const d3 = affordability({ budgetRange: 'Under $15k/yr', netPrice: 20000, division: 'NCAA D3', sport: 'mens-soccer' });
    const d1 = affordability({ budgetRange: 'Under $15k/yr', netPrice: 20000, division: 'NCAA D1', sport: 'womens-soccer' });
    expect(d1.score).toBeGreaterThan(d3.score);
    expect(d1.detail.estimatedCost).toBeLessThan(d3.detail.estimatedCost);
  });

  it('decays rather than cliffs when the school is over budget', () => {
    const slight = affordability({ budgetRange: 'Under $15k/yr', netPrice: 17000, division: 'NCAA D3', sport: 'mens-soccer' });
    const heavy = affordability({ budgetRange: 'Under $15k/yr', netPrice: 40000, division: 'NCAA D3', sport: 'mens-soccer' });
    expect(slight.score).toBeGreaterThan(heavy.score);
  });

  // Budget is a guideline. The school a family cannot afford today is exactly
  // the school a scholarship exists to reach, so cost tilts the ranking and
  // never removes anything.
  it('never scores a school at zero however far past the budget it is', () => {
    const absurd = affordability({ budgetRange: 'Under $15k/yr', netPrice: 90000, division: 'NCAA D3', sport: 'mens-soccer' });
    expect(absurd.score).toBeGreaterThan(0);
    expect(absurd.score).toBeCloseTo(AFFORDABILITY_FLOOR, 2);
  });

  it('scores the same school better for an athlete who would be its standout', () => {
    // Priced high enough that both still fall short, or the score saturates
    // at 1 for each and the comparison says nothing.
    const base = { budgetRange: 'Under $15k/yr', netPrice: 90000, division: 'NCAA D1', sport: 'mens-soccer' };
    const marginal = affordability({ ...base, athleteLevel: 70, programLevel: 70 });
    const standout = affordability({ ...base, athleteLevel: 70, programLevel: 45 });
    expect(standout.score).toBeGreaterThan(marginal.score);
    expect(standout.detail.expectedAwardFraction).toBeGreaterThan(marginal.detail.expectedAwardFraction);
    expect(standout.detail.awardBasis).toBe('priority signing');
    expect(standout.detail.gapToBudget).toBeLessThan(marginal.detail.gapToBudget);
  });

  it('saturates at full marks once the expected award closes the gap', () => {
    const base = { budgetRange: '$15k-$30k/yr', netPrice: 30000, division: 'NCAA D1', sport: 'mens-soccer' };
    expect(affordability({ ...base, athleteLevel: 70, programLevel: 45 }).score).toBe(1);
    expect(affordability({ ...base, athleteLevel: 70, programLevel: 70 }).score).toBe(1);
  });

  it('quotes what a priority signing could get, not the squad average', () => {
    const r = affordability({ budgetRange: '$15k-$30k/yr', netPrice: 30000, division: 'NCAA D1', sport: 'womens-soccer', athleteLevel: 80, programLevel: 50 });
    expect(r.detail.expectedAwardFraction).toBe(0.9);
    expect(r.detail.netPriceIsAverage).toBe(true);
  });

  it('treats "$50k+/yr" as no ceiling', () => {
    expect(affordability({ budgetRange: '$50k+/yr', netPrice: 82000, division: 'NCAA D1', sport: 'mens-soccer' }).score).toBe(1);
  });

  it('says plainly that a full scholarship is impossible where no athletic aid exists', () => {
    const r = affordability({ budgetRange: 'Need Full Scholarship', netPrice: 34000, division: 'NCAA D3', sport: 'mens-soccer' });
    expect(r.detail.expectedAwardFraction).toBe(0);
    expect(r.detail.caveat).toMatch(/no athletic scholarships/i);
    // Still ranked above nothing — D3 meets need through institutional aid,
    // which the net price already reflects.
    expect(r.score).toBeGreaterThan(0);
    const cheaper = affordability({ budgetRange: 'Need Full Scholarship', netPrice: 6000, division: 'NCAA D3', sport: 'mens-soccer' });
    expect(cheaper.score).toBeGreaterThan(r.score);
  });

  it('caveats a full-scholarship request even where athletic aid does exist', () => {
    const r = affordability({ budgetRange: 'Need Full Scholarship', netPrice: 30000, division: 'NCAA D1', sport: 'womens-soccer' });
    expect(r.detail.caveat).toMatch(/equivalency/i);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(1);
  });

  it('falls back to the prior when no budget was stated', () => {
    expect(affordability({ netPrice: 20000, division: 'NCAA D1', sport: 'mens-soccer' })).toMatchObject({ confidence: 'assumed' });
  });

  it('falls back to the prior when the school has no net price', () => {
    expect(affordability({ budgetRange: '$15k-$30k/yr', division: 'NCAA D1', sport: 'mens-soccer' })).toMatchObject({ confidence: 'assumed' });
  });
});

describe('athleticAidFraction', () => {
  it('is zero for D3 and for the Ivy League regardless of division', () => {
    expect(athleticAidFraction({ division: 'NCAA D3', sport: 'mens-soccer' })).toBe(0);
    expect(athleticAidFraction({ division: 'NCAA D1', sport: 'mens-soccer', conference: 'Ivy League' })).toBe(0);
  });

  it('is higher for women than men at D1, matching the equivalency limits', () => {
    expect(athleticAidFraction({ division: 'NCAA D1', sport: 'womens-soccer' }))
      .toBeGreaterThan(athleticAidFraction({ division: 'NCAA D1', sport: 'mens-soccer' }));
  });

  it('is zero for a division we hold no rule for', () => {
    expect(athleticAidFraction({ division: 'NCCAA', sport: 'mens-soccer' })).toBe(0);
  });
});

describe('programQuality', () => {
  it('rewards level and, separately, an improving trajectory', () => {
    const rising = programQuality({ percentile: 0.6, recentWinPct: 0.7, priorWinPct: 0.4 });
    const falling = programQuality({ percentile: 0.6, recentWinPct: 0.4, priorWinPct: 0.7 });
    expect(rising.score).toBeGreaterThan(falling.score);
    expect(rising.detail.trajectory).toBe('rising');
    expect(falling.detail.trajectory).toBe('falling');
  });

  it('scores on level alone when no record is available', () => {
    const r = programQuality({ percentile: 0.8 });
    expect(r.score).toBe(0.8);
    expect(r.confidence).toBe('partial');
  });

  it('falls back to the prior with no percentile', () => {
    expect(programQuality({ percentile: null })).toMatchObject({ score: NEUTRAL_PRIOR, confidence: 'assumed' });
  });
});

describe('geography', () => {
  it('prefers closer schools', () => {
    const near = geography({ athleteState: 'CA', schoolState: 'OR', distanceMiles: 200 });
    const far = geography({ athleteState: 'CA', schoolState: 'ME', distanceMiles: 2600 });
    expect(near.score).toBeGreaterThan(far.score);
  });

  it('never writes off a distant school entirely', () => {
    expect(geography({ athleteState: 'CA', schoolState: 'ME', distanceMiles: 3000 }).score).toBeGreaterThanOrEqual(0.25);
  });

  it('lifts an in-state school above what mileage alone would give', () => {
    const r = geography({ athleteState: 'TX', schoolState: 'TX', distanceMiles: 600 });
    expect(r.score).toBeGreaterThanOrEqual(0.9);
    expect(r.label).toBe('in state');
  });

  it('still recognises in-state when coordinates are missing', () => {
    const r = geography({ athleteState: 'TX', schoolState: 'TX' });
    expect(r.confidence).toBe('partial');
    expect(r.score).toBe(0.9);
  });

  it('falls back to the prior with neither distance nor a state match', () => {
    expect(geography({ athleteState: 'TX', schoolState: 'OH' })).toMatchObject({ confidence: 'assumed' });
  });
});

describe('rosterOpportunity without an arrival year', () => {
  it('falls back to the prior everywhere rather than scoring a measured zero', () => {
    const r = rosterOpportunity({
      position: 'MIDFIELD', rosterRowsForSchool: 28, rowsMissingGradYear: 0,
      graduatingStarters: 0, graduatingSquad: 0, classYearKnown: false,
    });
    expect(r).toMatchObject({ score: NEUTRAL_PRIOR, confidence: 'assumed' });
  });

  // The failure this guards: with no class year every scraped school scored 0
  // while unscraped ones kept 0.5, so the programmes we knew least about
  // ranked highest.
  it('does not rank an unscraped school above a scraped one', () => {
    const scraped = rosterOpportunity({ position: 'MIDFIELD', rosterRowsForSchool: 28, classYearKnown: false });
    const unscraped = rosterOpportunity({ position: 'MIDFIELD', rosterRowsForSchool: 0, classYearKnown: false });
    expect(scraped.score).toBe(unscraped.score);
  });
});

describe('geography for an international athlete', () => {
  const school = { origin: 'International', athleteCountry: 'United Kingdom', rosterRows: 28 };

  it('ignores distance entirely — everywhere is far from home', () => {
    const near = geography({ ...school, internationalRows: 8, sameCountryRows: 2, distanceMiles: 50 });
    const far = geography({ ...school, internationalRows: 8, sameCountryRows: 2, distanceMiles: 4000 });
    expect(near.score).toBe(far.score);
  });

  it('prefers a program that already carries international players', () => {
    const none = geography({ ...school, internationalRows: 0, sameCountryRows: 0 });
    const many = geography({ ...school, internationalRows: 14, sameCountryRows: 0 });
    expect(many.score).toBeGreaterThan(none.score);
    expect(none.label).toBe('no internationals');
  });

  it('adds a bonus for players from the athlete\'s own country', () => {
    const strangers = geography({ ...school, internationalRows: 8, sameCountryRows: 0 });
    const compatriots = geography({ ...school, internationalRows: 8, sameCountryRows: 4 });
    expect(compatriots.score).toBeGreaterThan(strangers.score);
    expect(compatriots.label).toBe('countrymen on roster');
    expect(compatriots.detail.playersFromCountry).toBe(4);
  });

  it('weights the community signal above the country bonus', () => {
    // Compatriots alone cannot outrank a program that routinely signs abroad.
    const oneCompatriotElsewhere = geography({ ...school, internationalRows: 1, sameCountryRows: 1 });
    const manyInternationalsNoCompatriots = geography({ ...school, internationalRows: 17, sameCountryRows: 0 });
    expect(manyInternationalsNoCompatriots.score).toBeGreaterThan(oneCompatriotElsewhere.score);
  });

  it('never writes off a program with no internationals', () => {
    expect(geography({ ...school, internationalRows: 0, sameCountryRows: 0 }).score).toBeGreaterThan(0);
  });

  it('scores on community alone when no country was given', () => {
    const r = geography({ origin: 'International', rosterRows: 28, internationalRows: 8, sameCountryRows: 0 });
    expect(r.confidence).toBe('partial');
    // Not diluted by a certain-zero country half.
    expect(r.score).toBeGreaterThan(geography({ ...school, internationalRows: 8, sameCountryRows: 0 }).score);
  });

  it('falls back to the prior for a program we have no roster for', () => {
    expect(geography({ ...school, rosterRows: 0 })).toMatchObject({ confidence: 'assumed' });
  });

  it('still measures distance for a domestic athlete', () => {
    const r = geography({ origin: 'USA', athleteState: 'OH', schoolState: 'OH', distanceMiles: 40 });
    expect(r.label).toBe('in state');
  });
});

describe('academicFit when only the school side is missing', () => {
  // The inversion this closes: a school rated 1.4/10 with no SAT average of
  // its own fell back to the prior and scored 0.5 — better than it deserves,
  // and better than a weak school with complete data. Missing data was
  // protecting bad schools, exactly as an unscraped roster once outranked a
  // scraped one.
  it('still uses the school rating when the school has no SAT average', () => {
    const weak = academicFit({ academicRating: 1.4, athleteSat: 1440 });
    const strong = academicFit({ academicRating: 9.5, athleteSat: 1440 });
    expect(weak.score).toBeLessThan(0.25);
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(weak.confidence).toBe('partial');
    expect(weak.detail.basis).toBe('school-unknown');
  });

  it('does not let a missing school average score above a measured weak one', () => {
    const noSchoolData = academicFit({ academicRating: 1.4, athleteSat: 1440 });
    const measured = academicFit({ academicRating: 1.4, schoolSatAvg: 900, athleteSat: 1440 });
    expect(noSchoolData.score).toBeLessThanOrEqual(measured.score + 0.2);
    expect(noSchoolData.score).toBeLessThan(NEUTRAL_PRIOR);
  });

  it('leaves admissibility neutral rather than guessing it', () => {
    expect(academicFit({ academicRating: 7, athleteSat: 1440 }).detail.admissibility).toBe(1);
  });

  // Still distinct from knowing nothing at all, which stays at the prior.
  it('is not the same as an athlete with no profile', () => {
    expect(academicFit({ academicRating: 1.4 }).score).toBe(NEUTRAL_PRIOR);
    expect(academicFit({ academicRating: 1.4, athleteSat: 1440 }).score).toBeLessThan(NEUTRAL_PRIOR);
  });
});
