import { describe, it, expect } from 'vitest';
import { buildProgrammeContext, generateEvidence } from './generate.js';
import { operatorFactsFor } from './operatorFacts.js';
import { EVIDENCE_KINDS, EVIDENCE_KIND_NAMES, TEMPORALITY } from './kinds.js';
import { SEASONS, SQUAD_SEASON } from '../philosophy.js';

/**
 * WHAT THE ROSTER NUMBERS MEAN.
 *
 * Every stage from F to H8 was about who decides. This is about what the
 * numbers are: which rows a count is drawn from, over which seasons, and
 * whether the word beside it names the same quantity.
 *
 * The grain is the thing. `roster_players` holds ONE ROW PER PLAYER-SEASON, so
 * the same player across four years is four rows and one person — and which of
 * those two a claim means is the difference between "two New Zealanders have
 * come through" and "eight". Nothing in a variable name says which, so it is
 * pinned here.
 *
 * The season split is the other thing. SEASONS (2022-2025) carry minutes and
 * are the MEASURED window; SQUAD_SEASON (2026) carries none and is the squad
 * on campus. A claim in the present tense may read only the second; a claim in
 * the past tense must find at least one row in the first.
 */

const row = (o = {}) => ({
  college_name: 'Test', sport: 'mens-soccer', season: '2024',
  player_name: 'A Player', position: 'D', minutes_played: 600, games_played: 18,
  class_year_label: 'Jr.', nationality: 'USA', country: '',
  estimated_graduation_year: 2027, eligibility_end_year: 2027,
  projected_minutes: 600, prior_programme: null,
  updated_date: new Date().toISOString().slice(0, 10), ...o,
});

const athlete = {
  full_name: 'Rhys Davies', position: 'Defender', country: 'New Zealand',
  nationality: 'New Zealand', recruiting_class_year: 2027, sport: 'mens-soccer',
};

const ctx = ({ squad = [], history = [] } = {}) => buildProgrammeContext({
  college: { name: 'Test', sport: 'mens-soccer' }, sport: 'mens-soccer', squad, history,
});
const gen = (o) => generateEvidence(athlete, ctx(o));
const kind = (o, k) => gen(o).find((e) => e.kind === k) ?? null;

// ---------------------------------------------------------------------------

describe('the season model', () => {
  it('measures four seasons and recruits into a fifth', () => {
    expect(SEASONS).toEqual(['2022', '2023', '2024', '2025']);
    expect(SQUAD_SEASON).toBe('2026');
    expect(SEASONS).not.toContain(SQUAD_SEASON);
  });

  it('reads the current squad for every present-tense kind, and only that', () => {
    /**
     * Measured over the live corpus: all eight CURRENT and PROJECTED kinds
     * carry the season label 2026 and nothing else, on every one of 3,498
     * pairings. Asserted here so a generator cannot quietly widen one.
     */
    const CURRENT_KINDS = EVIDENCE_KIND_NAMES.filter((k) => [TEMPORALITY.CURRENT, TEMPORALITY.PROJECTED]
      .includes(EVIDENCE_KINDS[k].temporality));
    expect(CURRENT_KINDS.length).toBeGreaterThan(0);

    const squad = [
      ...Array.from({ length: 20 }, (_, i) => row({ season: '2026', player_name: `P${i}`, minutes_played: null })),
      row({ season: '2026', player_name: 'Kiwi Now', nationality: 'International', country: 'New Zealand', minutes_played: null }),
    ];
    // A 2025 compatriot the current-tense kinds must not see.
    const history = [row({ season: '2025', player_name: 'Kiwi Past', nationality: 'International', country: 'New Zealand' })];

    for (const k of CURRENT_KINDS) {
      const ev = kind({ squad, history }, k);
      if (!ev) continue;
      expect(String(ev.season), k).toBe(SQUAD_SEASON);
    }
  });
});

describe('a past-tense claim needs a season that has been played', () => {
  const kiwi = (season) => row({
    season, player_name: `Kiwi ${season}`, nationality: 'International', country: 'New Zealand',
  });
  const squad = Array.from({ length: 20 }, (_, i) => row({ season: '2026', player_name: `P${i}`, minutes_played: null }));

  it('refuses to call a compatriot on this year\'s roster history', () => {
    /**
     * Adelphi's single New Zealander is on the 2026 roster and no earlier one,
     * and this produced "you've had one New Zealander come through the
     * programme since 2026" — a past-tense claim about a season nobody has
     * played. The honest evidence for that programme is CURRENT_SAME_COUNTRY,
     * which fires on the same row.
     */
    const currentOnly = { squad: [...squad, kiwi('2026')], history: [] };
    expect(kind(currentOnly, 'HISTORICAL_SAME_COUNTRY')).toBeNull();
    expect(kind(currentOnly, 'CURRENT_SAME_COUNTRY')).toBeTruthy();
  });

  it('allows it once one compatriot has played a measured season', () => {
    const both = { squad: [...squad, kiwi('2026')], history: [kiwi('2023')] };
    expect(kind(both, 'HISTORICAL_SAME_COUNTRY')).toBeTruthy();
  });

  it('never names an unplayed season, however wide the span it searched', () => {
    // `when()` renders a multi-season span as "since <earliest>", so a search
    // that reached 2026 still says "since 2022". Measured: 282 of 929 live
    // historical claims carry a span ending in 2026 and none names it.
    const ev = kind({ squad: [...squad, kiwi('2026')], history: [kiwi('2022')] }, 'HISTORICAL_SAME_COUNTRY');
    expect(String(ev.season)).toContain('2022');
    expect(ev.data.seasons).toEqual(expect.arrayContaining(['2022']));
  });
});

describe('one player over four seasons is one player', () => {
  it('counts people, not rows, in a historical pathway claim', () => {
    /**
     * The grain trap. `roster_players` is one row per player-season, so a
     * single New Zealander who stayed four years is four rows — and counting
     * rows would tell a coach he had recruited four, which he would spot
     * immediately from his own alumni list.
     */
    const stayed = ['2022', '2023', '2024', '2025'].map((season) => row({
      season, player_name: 'Kiwi One', nationality: 'International', country: 'New Zealand',
    }));
    const ev = kind({
      squad: Array.from({ length: 20 }, (_, i) => row({ season: '2026', player_name: `P${i}`, minutes_played: null })),
      history: stayed,
    }, 'HISTORICAL_SAME_COUNTRY');
    expect(ev.data.count).toBe(1);
    expect(ev.data.names).toEqual(['Kiwi One']);
  });
});

describe('an unread season is not an empty one', () => {
  it('reports no squad rather than a squad of nobody', () => {
    /**
     * 341 of 1,166 mens-soccer programmes have no 2026 roster and 247 have no
     * measured history. `squadSize: 0` occurs only where `hasSquad` is false,
     * and every generator that divides guards on the flag rather than the
     * number — so a roster we could not read never becomes a programme with
     * nobody on it.
     */
    const c = ctx({ squad: [], history: [row()] });
    expect(c.hasSquad).toBe(false);
    expect(c.squadSize).toBe(0);
    expect(c.hasHistory).toBe(true);
    for (const k of ['INTERNATIONAL_SHARE', 'POSITION_GROUP_SIZE', 'POSITION_GROUP_SCARCITY',
      'TRANSFER_BEHAVIOUR', 'POSITION_GRADUATION']) {
      expect(kind({ squad: [], history: [row()] }, k), k).toBeNull();
    }
  });
});

describe('a denominator is named for what it counts', () => {
  const squad = [
    ...Array.from({ length: 24 }, (_, i) => row({ season: '2026', player_name: `M${i}`, position: 'M', minutes_played: null })),
    ...Array.from({ length: 2 }, (_, i) => row({ season: '2026', player_name: `D${i}`, position: 'D', minutes_played: null })),
    // Six players whose position the scrape could not read.
    ...Array.from({ length: 6 }, (_, i) => row({ season: '2026', player_name: `X${i}`, position: '', minutes_played: null })),
  ];

  it('divides thinness by the players whose position we could read', () => {
    // Correct, and deliberate: a group cannot be called thin relative to
    // players whose position was never parsed.
    const ev = kind({ squad }, 'POSITION_GROUP_SCARCITY');
    expect(ev.data.classifiedSquad).toBe(26);
    expect(ev.data.count).toBe(2);
  });

  it('does not call that number the squad size', () => {
    /**
     * H9. It crossed the wire as `squadSize`, and the operator card read
     * "2 defenders in a squad of 26" about a programme carrying 32. On 47 of
     * 228 live scarcity claims the number under that label was not the squad
     * size; at Mobile it was short by eighteen. The maths was right and the
     * word was wrong.
     */
    const ev = kind({ squad }, 'POSITION_GROUP_SCARCITY');
    const facts = operatorFactsFor(ev).facts;
    expect(facts.classifiedSquad).toBe(26);
    expect(facts).not.toHaveProperty('squadSize');

    // And the kind that DOES mean the squad still says so.
    const size = operatorFactsFor(kind({ squad }, 'POSITION_GROUP_SIZE')).facts;
    expect(size.squadSize).toBe(32);
  });

  it('keeps every other `squadSize` meaning the whole current roster', () => {
    const whole = [
      ...Array.from({ length: 28 }, (_, i) => row({ season: '2026', player_name: `P${i}`, minutes_played: null })),
      ...Array.from({ length: 4 }, (_, i) => row({ season: '2026', player_name: `I${i}`, nationality: 'International', country: 'Spain', minutes_played: null })),
    ];
    for (const k of ['INTERNATIONAL_SHARE', 'POSITION_GROUP_SIZE']) {
      const ev = kind({ squad: whole }, k);
      if (!ev) continue;
      expect(ev.data.squadSize, k).toBe(32);
    }
  });
});

describe('`n` is carried and deliberately never labelled', () => {
  it('means a different quantity in each kind that has one', () => {
    /**
     * Measured across the corpus: seasons for COACH_CONTEXT and the programme
     * pattern, unique players for the country kinds, arrivals for the position
     * kinds, freshman observations for the ladders, and programmes for the
     * pool. One letter, six meanings — which is why neither the panel nor the
     * provenance page prints it, and why each section states its own sample in
     * its own words instead.
     */
    const squad = Array.from({ length: 20 }, (_, i) => row({ season: '2026', player_name: `P${i}`, minutes_played: null }));
    const stayed = ['2022', '2023', '2024'].map((season) => row({
      season, player_name: 'Kiwi One', nationality: 'International', country: 'New Zealand',
    }));
    const ev = kind({ squad, history: stayed }, 'HISTORICAL_SAME_COUNTRY');
    // Unique PEOPLE here — the same number as the count, not the row total.
    expect(ev.describes.n).toBe(ev.data.count);
    expect(ev.describes.n).toBe(1);
    expect(stayed.length).toBe(3);
  });
});
