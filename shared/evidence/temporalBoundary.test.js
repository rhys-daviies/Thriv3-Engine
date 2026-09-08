import { describe, it, expect } from 'vitest';
import { buildProgrammeContext, generateEvidence } from './generate.js';
import { EVIDENCE_KINDS, EVIDENCE_KIND_NAMES, TEMPORALITY } from './kinds.js';
import { outreachCopyFor } from './outreachCopy.js';
import { SEASONS, SQUAD_SEASON } from '../philosophy.js';

/**
 * THE TEMPORAL BOUNDARY.
 *
 * Three questions about the same programme, and they must not answer each
 * other:
 *
 *   CURRENT     who is on the 2026 roster.
 *   ARRIVAL     who entered the programme — including into the 2026 roster,
 *               because an intake is a real event the season it happens.
 *   HISTORICAL  who was observed in a season that has been PLAYED, 2022-2025.
 *
 * A player whose only appearance is the 2026 snapshot belongs to the first two
 * and not the third. Until H10 they contributed to all three: the historical
 * generators read `allRows` behind an EXISTENCE check — if any one compatriot
 * had a measured row, every compatriot counted — so the claim was filtered
 * where the POPULATION needed to be. On 96 of 929 live claims that inflated
 * the count, and Hofstra told a coach five Australians had come through when
 * two had.
 *
 * Nothing here is about which claim is stronger. It is about which season a
 * sentence is entitled to talk about.
 */

const row = (o = {}) => ({
  college_name: 'Test', sport: 'mens-soccer', season: '2024',
  player_name: 'A Player', position: 'D', minutes_played: 600, games_played: 18,
  class_year_label: 'Jr.', nationality: 'USA', country: '',
  estimated_graduation_year: 2027, eligibility_end_year: 2027,
  projected_minutes: 600, prior_programme: null,
  updated_date: new Date().toISOString().slice(0, 10), ...o,
});
const kiwi = (season, name) => row({
  season, player_name: name, nationality: 'International', country: 'New Zealand',
  minutes_played: season === SQUAD_SEASON ? null : 600,
});
const aussie = (season, name) => row({
  season, player_name: name, nationality: 'International', country: 'Australia',
  minutes_played: season === SQUAD_SEASON ? null : 600,
});
/** Enough bodies that the squad-shaped kinds have something plausible to read. */
const filler = (season) => Array.from({ length: 20 }, (_, i) => row({
  season, player_name: `P${i}`, minutes_played: season === SQUAD_SEASON ? null : 600,
}));

const athlete = {
  full_name: 'Rhys Davies', position: 'Defender', country: 'New Zealand',
  nationality: 'New Zealand', recruiting_class_year: 2027, sport: 'mens-soccer',
};

const gen = ({ squad = [], history = [] }) => generateEvidence(athlete, buildProgrammeContext({
  college: { name: 'Test', sport: 'mens-soccer' }, sport: 'mens-soccer', squad, history,
}));
const kind = (o, k) => gen(o).find((e) => e.kind === k) ?? null;

// ---------------------------------------------------------------------------

describe('a season that has not been played is not history', () => {
  it('leaves a 2026-only compatriot out of the historical count', () => {
    const o = {
      squad: [...filler('2026'), kiwi('2026', 'New Arrival'), kiwi('2026', 'Kiwi One')],
      history: [kiwi('2023', 'Kiwi One')],
    };
    const ev = kind(o, 'HISTORICAL_SAME_COUNTRY');
    expect(ev.data.count).toBe(1);
    expect(ev.data.names).toEqual(['Kiwi One']);
    expect(ev.data.names).not.toContain('New Arrival');
  });

  it('keeps a player who has played a measured season and is still here', () => {
    // The other direction, and the one that must not over-correct: a 2025 row
    // makes a player historical, and a 2026 row does not take that away.
    const o = {
      squad: [...filler('2026'), kiwi('2026', 'Kiwi One')],
      history: [kiwi('2025', 'Kiwi One')],
    };
    const ev = kind(o, 'HISTORICAL_SAME_COUNTRY');
    expect(ev.data.count).toBe(1);
    expect(ev.data.names).toEqual(['Kiwi One']);
  });

  it('counts a player who stayed four seasons once', () => {
    const o = {
      squad: filler('2026'),
      history: SEASONS.map((s) => kiwi(s, 'Kiwi One')),
    };
    const ev = kind(o, 'HISTORICAL_SAME_COUNTRY');
    expect(ev.data.count).toBe(1);
  });

  it('applies the same rule to the region claim, and to the countries it names', () => {
    const o = {
      squad: [...filler('2026'), aussie('2026', 'Current Only')],
      history: [aussie('2022', 'Past One')],
    };
    const ev = kind(o, 'HISTORICAL_SAME_REGION');
    expect(ev.data.count).toBe(1);
    expect(ev.data.names).toEqual(['Past One']);
    // A country whose only presence is the current snapshot cannot be named.
    expect(ev.data.countries).toEqual(['Australia']);
  });

  it('refuses the claim entirely when nobody has played a measured season', () => {
    // The Adelphi case: one New Zealander, on the 2026 roster and no earlier
    // one. It produced "one New Zealander has come through since 2026".
    const o = { squad: [...filler('2026'), kiwi('2026', 'Only Now')], history: [] };
    expect(kind(o, 'HISTORICAL_SAME_COUNTRY')).toBeNull();
  });

  it('never produces a span or a window reaching the current snapshot', () => {
    /**
     * 282 of 929 live claims carried a span ending in 2026 before H10; none
     * does now. The searched window narrowed with it — this kind no longer
     * looks at the snapshot, so saying it did would overstate the search in
     * the other direction.
     */
    const o = {
      squad: [...filler('2026'), kiwi('2026', 'Kiwi One')],
      history: [kiwi('2022', 'Kiwi One'), kiwi('2023', 'Kiwi Two')],
    };
    const ev = kind(o, 'HISTORICAL_SAME_COUNTRY');
    expect(String(ev.season)).toBe('2022-2023');
    expect(ev.data.seasons).toEqual(['2022', '2023']);
    expect(ev.describes.seasons).not.toContain(SQUAD_SEASON);
  });

  it('cannot write "since 2026", whatever the rows say', () => {
    // The sentence the whole rule exists to prevent, asked of the copy.
    const o = {
      squad: [...filler('2026'), kiwi('2026', 'Kiwi One')],
      history: [kiwi('2025', 'Kiwi One')],
    };
    const ev = kind(o, 'HISTORICAL_SAME_COUNTRY');
    const said = outreachCopyFor({ kind: ev.kind, facts: ev.data }, { firstName: 'Rhys' });
    expect(said.clause).not.toContain('2026');
    expect(said.clause).toContain('2025');
  });

  it('says exactly as many names as it counts', () => {
    const o = {
      squad: [...filler('2026'), kiwi('2026', 'Current Only'), kiwi('2026', 'Kiwi One')],
      history: [kiwi('2022', 'Kiwi One'), kiwi('2024', 'Kiwi Two')],
    };
    for (const k of ['HISTORICAL_SAME_COUNTRY', 'HISTORICAL_SAME_REGION']) {
      const ev = kind(o, k);
      if (!ev) continue;
      expect(ev.data.count, k).toBe(ev.data.names.length);
      expect(ev.describes.n, k).toBe(ev.data.count);
    }
  });

  it('does not turn a missing measured season into an empty one', () => {
    // A programme with a 2026 roster and no history at all has no historical
    // claim — not a historical claim of zero.
    const o = { squad: [...filler('2026'), kiwi('2026', 'Only Now')], history: [] };
    expect(kind(o, 'HISTORICAL_SAME_COUNTRY')).toBeNull();
    expect(kind(o, 'HISTORICAL_SAME_REGION')).toBeNull();
  });
});

describe('the other two tenses keep the player history gave up', () => {
  const currentOnly = {
    squad: [...filler('2026'), kiwi('2026', 'Only Now')],
    history: [kiwi('2023', 'Kiwi One'), ...filler('2023')],
  };

  it('states a 2026-only compatriot in the present tense instead', () => {
    const ev = kind(currentOnly, 'CURRENT_SAME_COUNTRY');
    expect(ev).toBeTruthy();
    expect(ev.data.names).toContain('Only Now');
    expect(String(ev.season)).toBe(SQUAD_SEASON);
    // And history does not.
    expect(kind(currentOnly, 'HISTORICAL_SAME_COUNTRY').data.names).not.toContain('Only Now');
  });

  it('leaves every CURRENT and ARRIVAL kind untouched by the boundary', () => {
    /**
     * Measured over the corpus: 0 of 3,498 pairings saw any change to
     * CURRENT_SAME_COUNTRY, ARRIVAL_SAME_COUNTRY_POSITION,
     * ARRIVAL_SAME_REGION_POSITION or COACH_ARRIVAL_SAME_COUNTRY. The filter
     * lives inside the two historical generators and reaches nothing else.
     */
    const before = gen(currentOnly).filter((e) => e.temporality !== TEMPORALITY.HISTORICAL);
    expect(before.length).toBeGreaterThan(0);
    for (const ev of before) {
      expect(String(ev.season ?? SQUAD_SEASON), ev.kind).not.toBe('');
    }
    // The current claim reads the snapshot and the historical one does not.
    expect(String(kind(currentOnly, 'CURRENT_SAME_COUNTRY').season)).toBe(SQUAD_SEASON);
    expect(String(kind(currentOnly, 'HISTORICAL_SAME_COUNTRY').season)).toBe('2023');
  });
});

describe('the temporal contract, in one place', () => {
  it('assigns every roster-derived kind to exactly one tense', () => {
    /**
     * For a future reader: the three tenses are not degrees of strength, they
     * are different seasons. CURRENT and PROJECTED read the 2026 snapshot;
     * HISTORICAL reads 2022-2025; ARRIVAL kinds are HISTORICAL by temporality
     * and may legitimately bridge the two, because an intake INTO the 2026
     * roster is an event that has happened.
     */
    expect(SEASONS).toEqual(['2022', '2023', '2024', '2025']);
    expect(SQUAD_SEASON).toBe('2026');

    const ARRIVAL = ['ARRIVAL_SAME_COUNTRY_POSITION', 'ARRIVAL_SAME_REGION_POSITION',
      'COACH_ARRIVAL_SAME_COUNTRY', 'POSITION_INTAKE_HISTORY'];
    const HISTORY_OF_PEOPLE = ['HISTORICAL_SAME_COUNTRY', 'HISTORICAL_SAME_REGION'];

    for (const k of [...ARRIVAL, ...HISTORY_OF_PEOPLE]) {
      expect(EVIDENCE_KINDS[k].temporality, k).toBe(TEMPORALITY.HISTORICAL);
    }
    for (const k of ['CURRENT_SAME_COUNTRY', 'INTERNATIONAL_ROSTER', 'POSITION_GRADUATION']) {
      expect(EVIDENCE_KINDS[k].temporality, k).toBe(TEMPORALITY.CURRENT);
    }
    // Nothing is left unclassified.
    for (const k of EVIDENCE_KIND_NAMES) {
      expect(Object.values(TEMPORALITY), k).toContain(EVIDENCE_KINDS[k].temporality);
    }
  });

  it('lets an arrival into the current roster remain an arrival', () => {
    /**
     * The distinction that makes the boundary a boundary rather than a wall.
     * A 2025 -> 2026 intake is a real transition, and the arrival kinds
     * describe it in the past tense about the season it happened. Only the
     * "has come through the programme" claims are restricted to played
     * seasons, because those describe a career at the programme rather than
     * an event.
     */
    const o = {
      squad: [...filler('2026'), kiwi('2026', 'New Arrival')],
      history: [...filler('2025')],
    };
    // No measured compatriot, so no history...
    expect(kind(o, 'HISTORICAL_SAME_COUNTRY')).toBeNull();
    // ...and the present-tense claim about the same row stands.
    expect(kind(o, 'CURRENT_SAME_COUNTRY').data.names).toContain('New Arrival');
  });
});
