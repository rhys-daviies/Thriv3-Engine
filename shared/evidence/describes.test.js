/**
 * Migration step 9.3 — the `describes` backfill.
 *
 * The point of these tests is not that the field is populated. It is that the
 * window is TRUE: that `seasons` names what was searched, that `n` counts the
 * observations the claim actually rests on, that a cohort appears only where
 * the derivation narrowed, and — most of all — that a season nobody ever held
 * is not filed as a season we tried and failed to read.
 */

import { describe, it, expect } from 'vitest';
import {
  historicalSameCountry, historicalSameRegion, coachContext,
  currentSameCountry, internationalRoster, positionGraduation,
  positionGraduationStarters, conferenceTitle, academicFit,
  buildProgrammeContext,
} from './generate.js';

const stamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

/** A roster row in the shape roster_players holds. */
const row = (o = {}) => ({
  college_name: 'Example', sport: 'mens-soccer', season: '2025',
  player_name: 'A Player', position: 'DEFENSE', minutes_played: 900,
  estimated_graduation_year: 2029, eligibility_end_year: 2028,
  nationality: 'USA', country: null, updated_date: stamp, ...o,
});

const kiwi = {
  name: 'Rhys Davies', position: 'DEFENSE', country: 'New Zealand',
  classYear: 2027, intendedMajor: null,
};

/**
 * Three measured seasons plus a current squad. 2024 is deliberately absent
 * from the fixture rather than empty — the programme has no rows for it at
 * all, which is the case the unread-season rule turns on.
 */
function ctxWith(extra = []) {
  const history = [
    row({ season: '2022', player_name: 'Old Kiwi', country: 'New Zealand', nationality: 'International' }),
    row({ season: '2023', player_name: 'Old Kiwi', country: 'New Zealand', nationality: 'International' }),
    row({ season: '2025', player_name: 'An Aussie', country: 'Australia', nationality: 'International' }),
    ...extra,
  ];
  const squad = [
    row({ season: '2026', player_name: 'Someone Else' }),
    row({ season: '2026', player_name: 'Old Kiwi', country: 'New Zealand', nationality: 'International' }),
  ];
  return buildProgrammeContext({
    college: { name: 'Example', sport: 'mens-soccer' },
    squad, history, rosterUpdatedAt: stamp,
  });
}

describe('HISTORICAL_SAME_COUNTRY window', () => {
  it('names every season searched, not only the seasons with a compatriot', () => {
    const ev = historicalSameCountry(kiwi, ctxWith());
    // The Kiwi appears in 2022, 2023 and 2026. The SEARCH covered 2022, 2023,
    // 2025 and 2026 — and reporting only the hits would describe a narrower
    // look than we actually took.
    expect(ev.describes.seasons).toEqual(['2022', '2023', '2025', '2026']);
    expect(ev.data.seasons).toEqual(['2022', '2023', '2026']);
  });

  it('counts distinct humans, not roster rows', () => {
    // One Kiwi on three rosters is one Kiwi. `n` must agree with the claim.
    const ev = historicalSameCountry(kiwi, ctxWith());
    expect(ev.describes.n).toBe(1);
    expect(ev.describes.n).toBe(ev.data.count);
  });

  it('records the country as the population it filtered on', () => {
    const ev = historicalSameCountry(kiwi, ctxWith());
    expect(ev.describes.cohort).toEqual({ country: 'New Zealand' });
  });

  it('does not treat a season the programme never had as unread', () => {
    // 2024 is missing from the fixture entirely. Nothing read it and failed;
    // we simply have no rows. It must appear in neither list.
    const ev = historicalSameCountry(kiwi, ctxWith());
    expect(ev.describes.seasons).not.toContain('2024');
    expect(ev.describes.seasonsUnread).toEqual([]);
  });

  it('sorts and de-duplicates seasons deterministically', () => {
    const a = historicalSameCountry(kiwi, ctxWith());
    const b = historicalSameCountry(kiwi, ctxWith());
    expect(a.describes.seasons).toEqual(b.describes.seasons);
    expect(a.describes.seasons).toEqual([...a.describes.seasons].sort());
  });
});

describe('HISTORICAL_SAME_REGION window', () => {
  it('records the region and the country excluded from it', () => {
    // The athlete's own compatriots are handed to HISTORICAL_SAME_COUNTRY, so
    // the population here is "the region, minus New Zealand". A cohort naming
    // only the region would describe a set this kind never counted.
    const ev = historicalSameRegion(kiwi, ctxWith());
    expect(ev.describes.cohort).toEqual({ region: 'OCEANIA', excludingCountry: 'New Zealand' });
    expect(ev.describes.n).toBe(1); // the Australian, not the Kiwi
  });
});

describe('COACH_CONTEXT window — the one source that knows the difference', () => {
  const coachRows = (rows) => buildProgrammeContext({
    college: { name: 'Example', sport: 'mens-soccer' },
    squad: [row({ season: '2026' })], history: [], coachRows: rows, rosterUpdatedAt: stamp,
  });

  it('separates seasons read-and-unusable from seasons never held', () => {
    const ev = coachContext(kiwi, coachRows([
      { season: 2022, coach_name: null, coach_title: null, reason: 'no-usable-page' },
      { season: 2023, coach_name: null, coach_title: null, reason: 'no-usable-page' },
      { season: 2024, coach_name: 'Chad Riley', coach_title: 'Head Coach', reason: null },
      { season: 2025, coach_name: 'Chad Riley', coach_title: 'Head Coach', reason: null },
    ]));
    expect(ev.describes.seasons).toEqual(['2024', '2025']);
    expect(ev.describes.seasonsUnread).toEqual(['2022', '2023']);
    // This is the Notre Dame case: the window stops at 2024 because two pages
    // could not be read, not because the coach arrived then.
    expect(ev.data.windowBounded).toBe(true);
  });

  it('does not file a vacant season as unread — a vacancy is an observation', () => {
    const ev = coachContext(kiwi, coachRows([
      { season: 2022, coach_name: null, coach_title: null, reason: 'vacant-or-tba' },
      { season: 2023, coach_name: 'New Boss', coach_title: 'Head Coach', reason: null },
      { season: 2024, coach_name: 'New Boss', coach_title: 'Head Coach', reason: null },
    ]));
    expect(ev.describes.seasonsUnread).toEqual([]);
    expect(ev.describes.seasons).toEqual(['2023', '2024']);
  });

  it('counts n as the seasons observed for this coach, matching the claim', () => {
    const ev = coachContext(kiwi, coachRows([
      { season: 2023, coach_name: 'New Boss', coach_title: 'Head Coach', reason: null },
      { season: 2024, coach_name: 'New Boss', coach_title: 'Head Coach', reason: null },
      { season: 2025, coach_name: 'New Boss', coach_title: 'Head Coach', reason: null },
    ]));
    expect(ev.describes.n).toBe(3);
    expect(ev.describes.n).toBe(ev.data.seasonsObserved);
    expect(ev.describes.cohort).toEqual({ coach: 'New Boss' });
  });
});

describe('kinds that must NOT carry a window', () => {
  it('leaves a present-tense roster fact without one', () => {
    // "You have a Kiwi on the roster" is true of a moment, not a span. A
    // window would invite a reader to hear a rate.
    expect(currentSameCountry(kiwi, ctxWith()).describes).toBeNull();
    expect(internationalRoster(kiwi, ctxWith()).describes).toBeNull();
  });

  it('leaves departures and projections without one', () => {
    const ctx = buildProgrammeContext({
      college: { name: 'Example', sport: 'mens-soccer' },
      squad: [row({ season: '2026' })], history: [], rosterUpdatedAt: stamp,
      match: {
        roster_season: '2026', graduating_at_position: 2,
        graduating_names_at_position: ['A', 'B'],
        graduating_starters_at_position: 1, graduating_starter_names_at_position: ['A'],
      },
    });
    expect(positionGraduation(kiwi, ctx).describes).toBeNull();
    expect(positionGraduationStarters(kiwi, ctx).describes).toBeNull();
  });

  it('leaves static facts without one', () => {
    const ctx = buildProgrammeContext({
      college: {
        name: 'Example', sport: 'mens-soccer',
        conference: 'ASUN', conference_champion_2025: 1, conference_champion_name: 'ASUN',
        notable_majors: ['Kinesiology'],
      },
      squad: [row({ season: '2026' })], history: [], rosterUpdatedAt: stamp,
    });
    expect(conferenceTitle(kiwi, ctx).describes).toBeNull();
    const withMajor = academicFit({ ...kiwi, intendedMajor: 'kinesiology' }, ctx);
    expect(withMajor.describes).toBeNull();
  });
});

describe('nothing is invented', () => {
  it('omits the window entirely when no season can be named', () => {
    // A programme whose rows carry no season at all. The honest answer is no
    // window, not an empty one — and defineEvidence would throw on an empty
    // one, which would delete a claim the programme is entitled to make.
    const ctx = buildProgrammeContext({
      college: { name: 'Example', sport: 'mens-soccer' },
      history: [
        row({ season: null, player_name: 'Old Kiwi', country: 'New Zealand', nationality: 'International' }),
      ],
      squad: [row({ season: null, player_name: 'Old Kiwi', country: 'New Zealand', nationality: 'International' })],
      rosterUpdatedAt: stamp,
    });
    const ev = historicalSameCountry(kiwi, ctx);
    // The evidence still exists; only the window is absent.
    expect(ev).not.toBeNull();
    expect(ev.describes).toBeNull();
  });

  it('leaves n null rather than guessing when the count is not an integer', () => {
    const ev = historicalSameCountry(kiwi, ctxWith());
    expect(Number.isInteger(ev.describes.n)).toBe(true);
  });
});
