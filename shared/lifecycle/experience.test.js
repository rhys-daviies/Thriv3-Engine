/**
 * Years of study. The line this file holds hardest: who was HERE and who took
 * the MINUTES are separately gated, because a programme whose stats page was
 * never read can still answer the first.
 */
import { describe, it, expect } from 'vitest';
import {
  seasonExperience, programmeExperience, experienceGroup,
  EXPERIENCE_GROUPS, YEAR_FOUR_PLUS, GROUP_LABEL,
} from './experience.js';
import { readableRows } from './readable.js';
import { MEASURED_SEASONS } from './utilisation.js';

const NAMES = 'abcdefghijklmnopqrstuvwxyz'.split('');
const nameFor = (i) => `${NAMES[i % 26]}${NAMES[Math.floor(i / 26) % 26]}`;
const seasonLetter = (s) => NAMES[Number(s) % 26];

const row = (o = {}) => ({
  sport: 'mens-soccer', college_name: 'Alpha', division: 'NCAA D1', season: '2025',
  player_name: 'Someone', class_year_label: 'Jr.', position: 'DEFENSE',
  minutes_played: 600, games_played: 18, games_started: 10, ...o,
});
/** `n` players of one class, on `minutes` each. */
const group = (n, label, minutes, season = '2025', tag = '') => Array.from({ length: n }, (_, i) => row({
  season, class_year_label: label, minutes_played: minutes,
  games_played: minutes > 0 ? 18 : 0,
  player_name: `P ${tag}${seasonLetter(season)} ${label.replace(/\W/g, '')} ${nameFor(i)}`,
}));

describe('the group a row belongs to', () => {
  it('reads every class spelling the roster uses', () => {
    for (const label of ['Fr.', 'Fy.', 'FY', '1st', 'First Year', 'R-Fr.', 'Rf.']) {
      expect(experienceGroup(row({ class_year_label: label })), label).toBe('YEAR_1');
    }
    for (const label of ['So.', 'Sophomore', '2nd', 'Second Year', 'R-So.']) {
      expect(experienceGroup(row({ class_year_label: label })), label).toBe('YEAR_2');
    }
    for (const label of ['Jr.', 'Junior', '3rd', 'Third Year']) {
      expect(experienceGroup(row({ class_year_label: label })), label).toBe('YEAR_3');
    }
    for (const label of ['Sr.', 'Senior', '4th', 'Fourth Year']) {
      expect(experienceGroup(row({ class_year_label: label })), label).toBe('YEAR_4');
    }
    for (const label of ['Gr.', 'Graduate', 'Graduate Student', '5th', 'Fifth Year', '6th']) {
      expect(experienceGroup(row({ class_year_label: label })), label).toBe('GRADUATE');
    }
  });

  it('leaves an unreadable class UNKNOWN and never assigns it', () => {
    for (const label of ['', null, '2027', "'29", 'FC Dallas', 'Real Colorado', 'Solar']) {
      expect(experienceGroup(row({ class_year_label: label })), String(label)).toBe('UNKNOWN');
    }
  });

  // A redshirt is ranked by the class the label names. Whether they redshirted
  // is a different question and is deliberately not a dimension here.
  it('does not make redshirt status a group', () => {
    expect(experienceGroup(row({ class_year_label: 'R-So.' }))).toBe('YEAR_2');
    expect(experienceGroup(row({ class_year_label: 'Redshirt Junior' }))).toBe('YEAR_3');
    expect(EXPERIENCE_GROUPS.join(',')).not.toMatch(/redshirt/i);
  });

  it('labels every group for a reader', () => {
    for (const g of EXPERIENCE_GROUPS) expect(GROUP_LABEL[g], g).toBeTruthy();
  });
});

describe('one season', () => {
  // Twelve first years sharing a tenth of the minutes, and eight fourth years
  // taking most of them: the shape the whole model exists to show.
  const season = [
    ...group(12, 'Fr.', 100),
    ...group(8, 'So.', 400),
    ...group(6, 'Jr.', 900),
    ...group(6, 'Sr.', 1200),
    ...group(2, 'Gr.', 800),
  ];

  it('gives roster share and minute share separately', () => {
    const s = seasonExperience(season, { season: '2025' });
    expect(s.compositionReadable).toBe(true);
    expect(s.loadReadable).toBe(true);
    const by = new Map(s.groups.map((g) => [g.group, g]));
    expect(by.get('YEAR_1').rosterPlayers).toBe(12);
    expect(by.get('YEAR_1').rosterShare).toBeCloseTo(12 / 34, 10);
    const total = 12 * 100 + 8 * 400 + 6 * 900 + 6 * 1200 + 2 * 800;
    expect(by.get('YEAR_1').minuteShare).toBeCloseTo(1200 / total, 10);
    expect(by.get('YEAR_4').minuteShare).toBeCloseTo(7200 / total, 10);
    // The finding: a third of the roster taking a twelfth of the minutes.
    expect(by.get('YEAR_1').rosterShare).toBeGreaterThan(by.get('YEAR_1').minuteShare * 3);
  });

  it('counts the rotation and the starters inside each group', () => {
    const by = new Map(seasonExperience(season, { season: '2025' }).groups.map((g) => [g.group, g]));
    expect(by.get('YEAR_1').playersWith200Plus).toBe(0);
    expect(by.get('YEAR_2').playersWith200Plus).toBe(8);
    expect(by.get('YEAR_2').playersWith600Plus).toBe(0);
    expect(by.get('YEAR_3').playersWith600Plus).toBe(6);
    expect(by.get('GRADUATE').playersWith600Plus).toBe(2);
  });

  it('keeps an unreadable class in its own group', () => {
    const s = seasonExperience([...season, ...group(3, 'FC Dallas', 500)], { season: '2025' });
    const unknown = s.groups.find((g) => g.group === 'UNKNOWN');
    expect(unknown.rosterPlayers).toBe(3);
    expect(unknown.minuteShare).toBeGreaterThan(0);
    expect(s.classShare).toBeCloseTo(34 / 37, 10);
  });

  it('refuses the whole season when its class labels cannot be read', () => {
    const s = seasonExperience(group(20, 'FC Dallas', 700), { season: '2025' });
    expect(s.compositionReadable).toBe(false);
    expect(s.loadReadable).toBe(false);
    expect(s.reason).toMatch(/class labels/);
  });

  // The distinction the module exists for. Albertus Magnus can answer the
  // first question and not the second.
  it('reads the roster by year of study where the minutes are unreadable', () => {
    const fabricated = readableRows([
      ...group(12, 'Fr.', 0), ...group(8, 'So.', 0), ...group(6, 'Jr.', 0), ...group(6, 'Sr.', 0),
    ].map((r) => ({ ...r, minutes_played: 0, games_played: 0 })));
    const s = seasonExperience(fabricated, { season: '2025' });
    expect(s.compositionReadable).toBe(true);
    expect(s.loadReadable).toBe(false);
    expect(s.reason).toMatch(/by year of study, but too few of its minutes/);
    const by = new Map(s.groups.map((g) => [g.group, g]));
    expect(by.get('YEAR_1').rosterShare).toBeCloseTo(12 / 32, 10);
    expect(by.get('YEAR_1').minuteShare).toBeNull();
    expect(by.get('YEAR_1').playersWith600Plus).toBeNull();
  });
});

describe('one programme', () => {
  const history = ['2022', '2023', '2024', '2025'].flatMap((s) => [
    ...group(10, 'Fr.', 150, s), ...group(8, 'So.', 500, s),
    ...group(7, 'Jr.', 950, s), ...group(5, 'Sr.', 1300, s),
  ]);

  it('pools player-seasons and offers the median season beside it', () => {
    const e = programmeExperience(history);
    expect(e.compositionAvailable).toBe(true);
    expect(e.loadAvailable).toBe(true);
    expect(e.compositionSeasons).toEqual([...MEASURED_SEASONS]);
    const y1 = e.groups.find((g) => g.group === 'YEAR_1');
    expect(y1.rosterSeasons).toBe(40);
    expect(y1.rosterShare).toBeCloseTo(10 / 30, 10);
    expect(y1.medianSeasonRosterShare).toBeCloseTo(10 / 30, 10);
    const total = 10 * 150 + 8 * 500 + 7 * 950 + 5 * 1300;
    expect(y1.minuteShare).toBeCloseTo(1500 / total, 10);
    expect(y1.medianSeasonMinuteShare).toBeCloseTo(1500 / total, 10);
  });

  it('offers the coarse fourth-year-or-beyond view', () => {
    const e = programmeExperience([...history, ...group(2, 'Gr.', 900, '2025')]);
    const four = e.groups.find((g) => g.group === 'YEAR_4');
    const grad = e.groups.find((g) => g.group === 'GRADUATE');
    expect(YEAR_FOUR_PLUS).toEqual(['YEAR_4', 'GRADUATE']);
    expect(e.yearFourPlus.minuteShare).toBeCloseTo(four.minuteShare + grad.minuteShare, 10);
    expect(e.yearFourPlus.rosterShare).toBeCloseTo(four.rosterShare + grad.rosterShare, 10);
  });

  it('never reads 2026', () => {
    const forward = group(30, 'Fr.', 0, '2026').map((r) => ({ ...r, minutes_played: null, games_played: null }));
    const e = programmeExperience([...history, ...forward]);
    expect(e.compositionSeasons).not.toContain('2026');
    expect(e.loadSeasons).not.toContain('2026');
    expect(e.groups.find((g) => g.group === 'YEAR_1').rosterSeasons).toBe(40);
  });

  it('refuses composition and load separately, with separate reasons', () => {
    const fabricated = readableRows(['2024', '2025'].flatMap((s) => [
      ...group(12, 'Fr.', 0, s), ...group(12, 'Sr.', 0, s),
    ].map((r) => ({ ...r, minutes_played: 0, games_played: 0 }))));
    const e = programmeExperience(fabricated);
    expect(e.compositionAvailable).toBe(true);
    expect(e.loadAvailable).toBe(false);
    expect(e.compositionReason).toBeNull();
    expect(e.loadReason).toMatch(/say who played them/);
    expect(e.groups.find((g) => g.group === 'YEAR_1').rosterShare).toBeCloseTo(0.5, 10);
    expect(e.groups.find((g) => g.group === 'YEAR_1').minuteShare).toBeNull();
    expect(e.measuredMinutes).toBeNull();
  });

  it('suppresses both below two readable seasons', () => {
    const e = programmeExperience(group(12, 'Fr.', 500, '2025').concat(group(12, 'Sr.', 900, '2025')));
    expect(e.compositionAvailable).toBe(false);
    expect(e.loadAvailable).toBe(false);
    expect(e.groups.find((g) => g.group === 'YEAR_1').rosterShare).toBeNull();
    expect(e.seasons.find((s) => s.season === '2025').compositionReadable).toBe(true);
  });
});

describe('one readable season', () => {
  it('offers the season as an observation, not as a programme history', () => {
    const one = [...group(12, 'Fr.', 200, '2025'), ...group(12, 'Sr.', 1200, '2025')];
    const e = programmeExperience(one);
    expect(e.compositionAvailable).toBe(false);
    expect(e.loadAvailable).toBe(false);
    expect(e.singleSeasonObservation.compositionSeason).toBe('2025');
    expect(e.singleSeasonObservation.loadSeason).toBe('2025');
    expect(e.singleSeasonObservation.basis).toMatch(/not a programme history/);
    const y4 = e.singleSeasonObservation.groups.find((g) => g.group === 'YEAR_4');
    expect(y4.minuteShare).toBeCloseTo(1200 / 1400, 10);
  });

  it('offers a composition-only observation where the minutes are unreadable', () => {
    const fabricated = readableRows([...group(12, 'Fr.', 0, '2025'), ...group(12, 'Sr.', 0, '2025')]
      .map((r) => ({ ...r, minutes_played: 0, games_played: 0 })));
    const e = programmeExperience(fabricated);
    expect(e.singleSeasonObservation.compositionSeason).toBe('2025');
    expect(e.singleSeasonObservation.loadSeason).toBeNull();
    expect(e.singleSeasonObservation.groups.find((g) => g.group === 'YEAR_1').rosterShare)
      .toBeCloseTo(0.5, 10);
  });
});
