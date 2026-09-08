import { describe, it, expect } from 'vitest';
import {
  arrivalsFor, buildPriorIndex, sameHuman, entryTypeOf, reconcileWithinSeason,
  IDENTITY_METHOD,
  ARRIVAL_CONFIDENCE, PRIOR_CONFIDENCE, COACH_ATTRIBUTION, ENTRY_TYPE,
} from './arrivals.js';
import { regionOf, REGION_KEYS } from './regions.js';
import { POSITIONS } from '../positions.js';

/**
 * The recruiting-arrival foundation.
 *
 * Almost every test here is about what the model REFUSES to say. An arrival is
 * the absence of a name from an earlier roster, and absence is the easiest
 * thing in this system to over-read: a missing roster, a middle name, a common
 * surname and a new coach each produce a confident, wrong answer if the gate
 * is not there.
 */

const row = (o = {}) => ({
  id: `r${Math.random().toString(36).slice(2, 8)}`,
  college_name: 'Example University',
  sport: 'mens-soccer',
  season: '2026',
  player_name: 'A Player',
  position: 'D',
  class_year_label: 'Fr.',
  nationality: 'USA',
  country: '',
  ...o,
});

const coach = (season, coach_name, o = {}) => ({
  school: 'Example University', sport: 'mens-soccer', season, coach_name, reason: '', ...o,
});

// ---------------------------------------------------------------------------
// A / B / C — the gate
// ---------------------------------------------------------------------------

describe('A. prior season on file and the player absent from it', () => {
  it('is a DIRECT arrival', () => {
    const { arrivals, coverage } = arrivalsFor([
      row({ season: '2025', player_name: 'Old Hand' }),
      row({ season: '2026', player_name: 'Old Hand' }),
      row({ season: '2026', player_name: 'New Face' }),
    ]);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].playerName).toBe('New Face');
    expect(arrivals[0].arrivalConfidence).toBe(ARRIVAL_CONFIDENCE.DIRECT);
    expect(arrivals[0].sourceTransition).toBe('2025->2026');
    expect(coverage.comparableTransitions).toEqual(['2025->2026']);
  });
});

describe('B. prior programme-season missing', () => {
  /**
   * The 22.7% hole: 195 men's programmes have a 2025 roster and no 2024 one.
   * Reading absence as arrival there invents a whole recruiting class.
   */
  it('is UNKNOWN, never DIRECT', () => {
    const { arrivals, unknown, coverage } = arrivalsFor([
      row({ season: '2025', player_name: 'Anyone' }),
      row({ season: '2025', player_name: 'Someone Else' }),
    ]);
    expect(arrivals).toHaveLength(0);
    expect(unknown).toHaveLength(2);
    for (const u of unknown) {
      expect(u.arrivalConfidence).toBe(ARRIVAL_CONFIDENCE.UNKNOWN);
      expect(u.reason).toMatch(/no 2024 roster on file/);
    }
    expect(coverage.comparableCount).toBe(0);
  });

  it('offers no third answer between DIRECT and UNKNOWN', () => {
    // Inference here means guessing from missing data, which is the failure
    // the gate exists to prevent. There is deliberately no INFERRED value.
    expect(Object.values(ARRIVAL_CONFIDENCE).sort()).toEqual(['DIRECT', 'UNKNOWN']);
  });

  it('still reports arrivals for the transitions it CAN compare', () => {
    // A programme missing 2024 can still be read across 2025->2026.
    const { arrivals, coverage } = arrivalsFor([
      row({ season: '2025', player_name: 'Returner' }),
      row({ season: '2026', player_name: 'Returner' }),
      row({ season: '2026', player_name: 'Newcomer' }),
    ]);
    expect(coverage.comparableCount).toBe(1);
    expect(arrivals.map((a) => a.playerName)).toEqual(['Newcomer']);
  });
});

describe('C. the same player in both seasons', () => {
  it('is not an arrival', () => {
    const { arrivals } = arrivalsFor([
      row({ season: '2025', player_name: 'Same Person' }),
      row({ season: '2026', player_name: 'Same Person' }),
    ]);
    expect(arrivals).toHaveLength(0);
  });

  it('is not an arrival across accents or punctuation either', () => {
    // `nameKey` already handles this; asserted so a change to it is caught
    // here rather than as a fabricated recruiting class.
    const { arrivals } = arrivalsFor([
      row({ season: '2025', player_name: "Aidan O'Sullivan" }),
      row({ season: '2026', player_name: 'Aidan OSullivan' }),
    ]);
    expect(arrivals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// D / E — identity reconciliation
// ---------------------------------------------------------------------------

describe('D. middle names added or dropped between seasons', () => {
  it.each([
    ['Jose Corporan', 'Jose Navea Corporan'],
    ['Gerardo Fonte', 'Gerardo Torres Fonte'],
    ['Theo Trindade', 'Theo Cavaleiro Trindade'],
  ])('%s and %s are one person, not an arrival', (a, b) => {
    const { arrivals, coverage } = arrivalsFor([
      row({ season: '2025', player_name: b }),
      row({ season: '2026', player_name: a }),
    ]);
    expect(arrivals).toHaveLength(0);
    expect(coverage.reconciledNames).toBe(1);
  });

  it('reports the reconciliation rather than hiding it', () => {
    const { coverage } = arrivalsFor([
      row({ season: '2025', player_name: 'Jose Navea Corporan' }),
      row({ season: '2026', player_name: 'Jose Corporan' }),
    ]);
    expect(coverage.reconciledNames).toBe(1);
  });
});

describe('E. genuinely different people with similar names', () => {
  /**
   * All four were real same-surname pairs in the audit. Merging two players is
   * worse than missing a reconciliation: it deletes an arrival AND corrupts a
   * departure.
   */
  it.each([
    ['Dylan Brown', 'Daniel Brown'],
    ['Ashton Allen', 'Liam Allen'],
    ['Marco Garcia', 'Gaizka Garcia'],
    ['Andrew Martinez', 'Antonio Martinez'],
  ])('%s and %s stay separate', (a, b) => {
    const { arrivals } = arrivalsFor([
      row({ season: '2025', player_name: b }),
      row({ season: '2026', player_name: a }),
    ]);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].playerName).toBe(a);
  });

  it('refuses a mononym, which is too little to reconcile on', () => {
    expect(sameHuman('Smith', 'John Smith')).toBe(false);
  });

  it('refuses two different middle names of the same length', () => {
    expect(sameHuman('John A Smith', 'John B Smith')).toBe(false);
  });

  it('never turns a returning player into an arrival', () => {
    // Reconciliation runs only on names that did not match exactly, so it can
    // remove a false arrival and can never create one.
    const { arrivals } = arrivalsFor([
      row({ season: '2025', player_name: 'Exact Match' }),
      row({ season: '2026', player_name: 'Exact Match' }),
      row({ season: '2026', player_name: 'Totally Different' }),
    ]);
    expect(arrivals.map((a) => a.playerName)).toEqual(['Totally Different']);
  });
});

// ---------------------------------------------------------------------------
// F / G — attributes
// ---------------------------------------------------------------------------

describe('F. canonical position integrity', () => {
  it.each([
    ['CB', 'DEFENSE'], ['LB', 'DEFENSE'], ['CDM', 'MIDFIELD'],
    ['Winger', 'FORWARD'], ['Striker', 'FORWARD'], ['GK', 'GOALKEEPER'],
  ])('collapses %s to %s', (raw, expected) => {
    const { arrivals } = arrivalsFor([
      row({ season: '2025', player_name: 'Someone' }),
      row({ season: '2026', player_name: 'Fresh', position: raw }),
    ]);
    expect(arrivals[0].canonicalPosition).toBe(expected);
  });

  it('never emits anything outside the canonical set', () => {
    const { arrivals } = arrivalsFor([
      row({ season: '2025', player_name: 'Someone' }),
      row({ season: '2026', player_name: 'Fresh', position: 'Left Wing Back' }),
    ]);
    expect([...POSITIONS, 'UNKNOWN']).toContain(arrivals[0].canonicalPosition);
  });

  it('keeps an unreadable position as UNKNOWN rather than guessing', () => {
    const { arrivals } = arrivalsFor([
      row({ season: '2025', player_name: 'Someone' }),
      row({ season: '2026', player_name: 'Fresh', position: '' }),
    ]);
    expect(arrivals[0].canonicalPosition).toBe('UNKNOWN');
  });
});

describe('G. international country and region', () => {
  const intl = (country) => arrivalsFor([
    row({ season: '2025', player_name: 'Someone' }),
    row({ season: '2026', player_name: 'Fresh', nationality: 'International', country }),
  ]).arrivals[0];

  it('carries the country and marks the player international', () => {
    const a = intl('New Zealand');
    expect(a.country).toBe('New Zealand');
    expect(a.isInternational).toBe(true);
    expect(a.nationalityFlag).toBe('International');
  });

  it('places a country we have mapped into its region', () => {
    expect(intl('New Zealand').region).toBe('OCEANIA');
    expect(intl('Australia').region).toBe('OCEANIA');
  });

  it('places the rest of the world too, since the taxonomy was reconciled', () => {
    expect(intl('Spain').region).toBe('EUROPE');
    expect(intl('Brazil').region).toBe('LATIN_AMERICA');
    expect(intl('Jamaica').region).toBe('CARIBBEAN');
    expect(intl('United Kingdom').region).toBe('UK_IRELAND');
  });

  /**
   * The hierarchy is SAME COUNTRY -> SAME REGION -> INTERNATIONAL, so a
   * country we have not placed must return null rather than a catch-all.
   * Inventing a region would let the middle rung make a claim the data cannot
   * support. Every country in the live data is placed, so the case has to be
   * forced with a value that is not a country at all.
   */
  it('leaves an unmapped country with no region at all', () => {
    expect(intl('Freedonia').region).toBeNull();
    expect(regionOf('Freedonia')).toBeNull();
    expect(REGION_KEYS).toContain('OCEANIA');
  });

  it('gives a domestic player no country and no region', () => {
    const { arrivals } = arrivalsFor([
      row({ season: '2025', player_name: 'Someone' }),
      row({ season: '2026', player_name: 'Fresh', nationality: 'USA', country: '' }),
    ]);
    expect(arrivals[0].country).toBeNull();
    expect(arrivals[0].region).toBeNull();
    expect(arrivals[0].isInternational).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// H / I — entry type
// ---------------------------------------------------------------------------

describe('H. freshman classification', () => {
  it.each(['Fr.', 'Freshman', 'FR', 'Fy.'])('reads %s as FRESHMAN', (label) => {
    expect(entryTypeOf(row({ class_year_label: label }))).toBe(ENTRY_TYPE.FRESHMAN);
  });
});

describe('I. experienced classification', () => {
  it.each(['So.', 'Jr.', 'Sr.', 'Gr.', 'Senior', 'Graduate'])('reads %s as EXPERIENCED', (label) => {
    expect(entryTypeOf(row({ class_year_label: label }))).toBe(ENTRY_TYPE.EXPERIENCED);
  });

  /**
   * A redshirt freshman has been on a campus for a year. Calling them a
   * freshman would put a player with college experience in the intake bucket.
   */
  it('reads a redshirt freshman as EXPERIENCED, not FRESHMAN', () => {
    expect(entryTypeOf(row({ class_year_label: 'R-Fr.' }))).toBe(ENTRY_TYPE.EXPERIENCED);
  });

  it('is UNKNOWN where the label cannot be read', () => {
    for (const label of ['', null, '2029', 'N/A']) {
      expect(entryTypeOf(row({ class_year_label: label })), String(label))
        .toBe(ENTRY_TYPE.UNKNOWN);
    }
  });

  it('never calls an EXPERIENCED player a transfer', () => {
    // The vocabulary has no TRANSFER value: a class label supports "had college
    // years behind them" and nothing about where those years were spent.
    expect(Object.values(ENTRY_TYPE).sort()).toEqual(['EXPERIENCED', 'FRESHMAN', 'UNKNOWN']);
  });
});

// ---------------------------------------------------------------------------
// J — prior programme
// ---------------------------------------------------------------------------

describe('J. prior programme, kept separate from arrival confidence', () => {
  const index = (rows) => buildPriorIndex(rows);

  it('names the origin when exactly one programme carried the name', () => {
    const priorIndex = index([
      row({ season: '2025', college_name: 'Other State', player_name: 'Moved On' }),
    ]);
    const { arrivals } = arrivalsFor([
      row({ season: '2025', player_name: 'Stayer' }),
      row({ season: '2026', player_name: 'Moved On' }),
    ], { priorIndex });
    expect(arrivals[0].priorProgramme).toBe('Other State');
    expect(arrivals[0].priorConfidence).toBe(PRIOR_CONFIDENCE.NAME_MATCH);
  });

  /**
   * 325 men's arrivals are in this state. Picking the first candidate would
   * produce a confident, wrong origin for every one of them.
   */
  it('is AMBIGUOUS when two programmes carried the name, and names neither', () => {
    const priorIndex = index([
      row({ season: '2025', college_name: 'Alpha College', player_name: 'Common Name' }),
      row({ season: '2025', college_name: 'Beta College', player_name: 'Common Name' }),
    ]);
    const { arrivals } = arrivalsFor([
      row({ season: '2025', player_name: 'Stayer' }),
      row({ season: '2026', player_name: 'Common Name' }),
    ], { priorIndex });
    expect(arrivals[0].priorConfidence).toBe(PRIOR_CONFIDENCE.AMBIGUOUS);
    expect(arrivals[0].priorProgramme).toBeNull();
    expect(arrivals[0].priorCandidates).toEqual(['Alpha College', 'Beta College']);
  });

  it('stays a DIRECT arrival even when the origin is ambiguous', () => {
    // The two questions are independent: we are certain the player is new here
    // and cannot say where they came from.
    const priorIndex = index([
      row({ season: '2025', college_name: 'Alpha College', player_name: 'Common Name' }),
      row({ season: '2025', college_name: 'Beta College', player_name: 'Common Name' }),
    ]);
    const { arrivals } = arrivalsFor([
      row({ season: '2025', player_name: 'Stayer' }),
      row({ season: '2026', player_name: 'Common Name' }),
    ], { priorIndex });
    expect(arrivals[0].arrivalConfidence).toBe(ARRIVAL_CONFIDENCE.DIRECT);
  });

  it('is NONE when no programme carried the name', () => {
    const { arrivals } = arrivalsFor([
      row({ season: '2025', player_name: 'Stayer' }),
      row({ season: '2026', player_name: 'Brand New' }),
    ], { priorIndex: index([]) });
    expect(arrivals[0].priorConfidence).toBe(PRIOR_CONFIDENCE.NONE);
  });

  it('does not treat the programme itself as a prior programme', () => {
    const rows = [
      row({ season: '2025', player_name: 'Stayer' }),
      row({ season: '2026', player_name: 'Brand New' }),
    ];
    const { arrivals } = arrivalsFor(rows, { priorIndex: index(rows) });
    expect(arrivals[0].priorProgramme).toBeNull();
  });

  it('reserves OBSERVED for a source that does not exist yet', () => {
    // `roster_players.prior_programme` is itself name-derived, so nothing
    // today may claim OBSERVED. The value exists so a future scraped field has
    // somewhere honest to land.
    const rows = [
      row({ season: '2025', player_name: 'Stayer' }),
      row({ season: '2026', player_name: 'Brand New' }),
    ];
    const { arrivals } = arrivalsFor(rows, { priorIndex: index(rows) });
    expect(arrivals[0].priorConfidence).not.toBe(PRIOR_CONFIDENCE.OBSERVED);
  });
});

// ---------------------------------------------------------------------------
// K / L — coach attribution
// ---------------------------------------------------------------------------

describe('K. a coach\'s first roster is inherited', () => {
  it('is INHERITED, never credited to the incoming coach', () => {
    const { arrivals } = arrivalsFor([
      row({ season: '2025', player_name: 'Stayer' }),
      row({ season: '2026', player_name: 'Fresh' }),
    ], {
      coachRows: [
        coach('2022', 'Old Boss'), coach('2023', 'Old Boss'),
        coach('2024', 'Old Boss'), coach('2025', 'Old Boss'),
        coach('2026', 'New Boss'),
      ],
    });
    expect(arrivals[0].coach).toBe('New Boss');
    expect(arrivals[0].coachAttribution).toBe(COACH_ATTRIBUTION.INHERITED);
  });
});

describe('L. a season inside an established tenure', () => {
  it('is ATTRIBUTED', () => {
    const { arrivals } = arrivalsFor([
      row({ season: '2025', player_name: 'Stayer' }),
      row({ season: '2026', player_name: 'Fresh' }),
    ], {
      coachRows: ['2022', '2023', '2024', '2025', '2026'].map((s) => coach(s, 'Same Boss')),
    });
    expect(arrivals[0].coachAttribution).toBe(COACH_ATTRIBUTION.ATTRIBUTED);
  });

  it('is UNKNOWN with no coach on file', () => {
    const { arrivals } = arrivalsFor([
      row({ season: '2025', player_name: 'Stayer' }),
      row({ season: '2026', player_name: 'Fresh' }),
    ]);
    expect(arrivals[0].coachAttribution).toBe(COACH_ATTRIBUTION.UNKNOWN);
    expect(arrivals[0].coach).toBeNull();
  });

  it('is UNKNOWN for the first season we observed, which has no predecessor', () => {
    // We cannot tell a new appointment from a coach of twenty years, so the
    // earliest season in the window is not attributed either way.
    const { arrivals } = arrivalsFor([
      row({ season: '2022', player_name: 'Stayer' }),
      row({ season: '2023', player_name: 'Fresh' }),
    ], { coachRows: [coach('2023', 'Only Boss')] });
    expect(arrivals[0].coachAttribution).toBe(COACH_ATTRIBUTION.UNKNOWN);
  });
});

// ---------------------------------------------------------------------------
// M — sport agnosticism
// ---------------------------------------------------------------------------

describe('M. women\'s data passes through unchanged', () => {
  const womens = (o = {}) => row({ sport: 'womens-soccer', ...o });

  it('produces arrivals with the same shape', () => {
    const { arrivals } = arrivalsFor([
      womens({ season: '2025', player_name: 'Stayer' }),
      womens({ season: '2026', player_name: 'Fresh' }),
    ]);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].sport).toBe('womens-soccer');
    expect(arrivals[0].arrivalConfidence).toBe(ARRIVAL_CONFIDENCE.DIRECT);
  });

  /**
   * The architecture is sport-agnostic; the CLAIMS are not yet licensed.
   * Women's country coverage is 9.7% of arrivals against 29.1% for men, so a
   * later phase must gate country and region evidence on measured coverage
   * rather than on the field being present.
   */
  it('marks a domestic women\'s arrival with no country to claim from', () => {
    const { arrivals } = arrivalsFor([
      womens({ season: '2025', player_name: 'Stayer' }),
      womens({ season: '2026', player_name: 'Fresh', nationality: 'USA', country: '' }),
    ]);
    expect(arrivals[0].country).toBeNull();
    expect(arrivals[0].region).toBeNull();
    expect(arrivals[0].isInternational).toBe(false);
  });

  it('carries a country only where the roster actually has one', () => {
    const { arrivals } = arrivalsFor([
      womens({ season: '2025', player_name: 'Stayer' }),
      womens({ season: '2026', player_name: 'Fresh', nationality: 'International', country: 'Canada' }),
    ]);
    expect(arrivals[0].country).toBe('Canada');
    expect(arrivals[0].region).toBe('NORTH_AMERICA');
  });
});

// ---------------------------------------------------------------------------
// provenance
// ---------------------------------------------------------------------------

describe('provenance: why do we believe this was an arrival', () => {
  it('records both seasons compared, the transition and the source row', () => {
    const { arrivals } = arrivalsFor([
      row({ season: '2025', player_name: 'Stayer' }),
      row({ season: '2026', player_name: 'Fresh', id: 'roster-row-42' }),
    ]);
    const a = arrivals[0];
    expect(a.arrivalSeason).toBe('2026');
    expect(a.priorSeason).toBe('2025');
    expect(a.sourceTransition).toBe('2025->2026');
    expect(a.rosterRowId).toBe('roster-row-42');
    expect(a.identityMethod).toBe('EXACT');
    expect(a.nameKey).toBe('fresh');
  });

  it('refuses two programmes in one call', () => {
    // Grouping is by season alone, so mixed programmes would read every name
    // as an arrival from the other.
    expect(() => arrivalsFor([
      row({ season: '2026', college_name: 'Alpha' }),
      row({ season: '2026', college_name: 'Beta' }),
    ])).toThrow(/one programme/);
  });
});

/**
 * One roster, one player, two spellings.
 *
 * Thirteen programme-seasons printed the same human twice — every one of them
 * in 2025, which points at a single source — and both rows read as arrivals.
 * The intake was one bigger than it happened, and an evidence kind that states
 * an exact count would have stated it one too high.
 */
describe('N. same-season duplicate humans', () => {
  const at = (season, name, extra = {}) => row({ season, player_name: name, ...extra });

  const arrivalsAt = (rows) => arrivalsFor(rows).arrivals;

  it('counts Magnus Jacobsen once, not twice', () => {
    const arrivals = arrivalsAt([
      at('2024', 'Someone Else'),
      at('2025', 'Magnus Micha Jacobsen', { country: 'Denmark' }),
      at('2025', 'Magnus Jacobsen', { country: 'Denmark' }),
    ]);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].identityMethod).toBe(IDENTITY_METHOD.RECONCILED);
    expect(arrivals[0].reconciledFrom).toEqual(['Magnus Micha Jacobsen']);
  });

  /**
   * The spelling the programme settled on wins. Elon's 2026 roster says
   * "Magnus Jacobsen", so that is the name the 2025 arrival is stored under —
   * keeping the other would leave the same player under two names in two
   * seasons, which is the bug one layer down.
   */
  it('keeps the spelling that appears in more of the programme\'s seasons', () => {
    const arrivals = arrivalsAt([
      at('2024', 'Someone Else'),
      at('2025', 'Magnus Micha Jacobsen'),
      at('2025', 'Magnus Jacobsen'),
      at('2026', 'Magnus Jacobsen'),
    ]);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].playerName).toBe('Magnus Jacobsen');
  });

  it('keeps Merrimack\'s longer spelling, because that is the one that persisted', () => {
    const arrivals = arrivalsAt([
      at('2024', 'Someone Else'),
      at('2025', 'Pedro Baisch'),
      at('2025', 'Pedro Plantz Baisch'),
      at('2026', 'Pedro Plantz Baisch'),
    ]);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].playerName).toBe('Pedro Plantz Baisch');
  });

  it('counts Tim Baerwalde once and prefers the plainer name with nothing to separate them', () => {
    const arrivals = arrivalsAt([
      at('2024', 'Someone Else'),
      at('2025', 'Tim Benjamin Baerwalde', { position: 'GK' }),
      at('2025', 'Tim Baerwalde', { position: 'GK' }),
    ]);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].playerName).toBe('Tim Baerwalde');
    expect(arrivals[0].reconciledFrom).toEqual(['Tim Benjamin Baerwalde']);
  });

  /** LIU printed the player as a midfielder and as a blank. Keeping the blank
   *  would delete a position we actually have. */
  it('keeps the row with more of its fields filled in', () => {
    const arrivals = arrivalsAt([
      at('2024', 'Someone Else'),
      at('2025', 'Francisco fernando Tolaba', { position: '' }),
      at('2025', 'Francisco Tolaba', { position: 'MID', country: 'Argentina' }),
    ]);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].playerName).toBe('Francisco Tolaba');
    expect(arrivals[0].canonicalPosition).toBe('MIDFIELD');
  });

  /**
   * The refusal is the point. Two brothers on one roster differ in their first
   * token, and merging them would delete a real arrival and invent a departure
   * to go with it — a worse error than counting one player twice.
   */
  it('never merges two genuinely different players', () => {
    const arrivals = arrivalsAt([
      at('2024', 'Someone Else'),
      at('2025', 'Dylan Brown'),
      at('2025', 'Daniel Brown'),
    ]);
    expect(arrivals).toHaveLength(2);
    expect(arrivals.every((a) => a.identityMethod === IDENTITY_METHOD.EXACT)).toBe(true);
  });

  it('leaves an ordinary intake EXACT and carries no provenance', () => {
    const arrivals = arrivalsAt([at('2024', 'Someone Else'), at('2025', 'Fresh Face')]);
    expect(arrivals[0].identityMethod).toBe(IDENTITY_METHOD.EXACT);
    expect(arrivals[0].reconciledFrom).toEqual([]);
  });

  it('reports the merges it made so a shrinking count is inspectable', () => {
    const { coverage } = arrivalsFor([
      at('2024', 'Someone Else'),
      at('2025', 'Tim Benjamin Baerwalde'),
      at('2025', 'Tim Baerwalde'),
    ]);
    expect(coverage.sameSeasonMerges).toBe(1);
    expect(coverage.directArrivals).toBe(1);
  });

  it('cannot turn a returning player into an arrival', () => {
    // The merge runs only on rows that already survived the returning check.
    const { arrivals } = arrivalsFor([
      at('2024', 'Tim Baerwalde'),
      at('2025', 'Tim Benjamin Baerwalde'),
      at('2025', 'Tim Baerwalde'),
    ]);
    expect(arrivals).toHaveLength(0);
  });

  it('is callable on its own and returns what it absorbed', () => {
    const a = at('2025', 'Maksim Granic');
    const b = at('2025', 'Maksim Marko Ivan Granic');
    const { kept, absorbed } = reconcileWithinSeason([a, b], new Map());
    expect(kept).toEqual([a]);
    expect(absorbed.get(a)).toEqual([b]);
  });
});
