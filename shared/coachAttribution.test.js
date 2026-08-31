/**
 * The attribution contract.
 *
 * Every fixture here is a real programme's shape, rebuilt rather than read from
 * the working database, and named after the programme that produced it. Those
 * names matter: each one is a case that either broke an earlier draft of this
 * module or is the reason a rule exists.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  coachAttribution, readCoachRow, currentCoachFrom, observedTransitions, timelineStateOf,
  ATTRIBUTION, TIMELINE, UNUSABLE, CURRENT_SEASON,
} from './coachAttribution.js';

const ALL = ['2022', '2023', '2024', '2025'];
/** `seasons` maps a season to a name, a [name, title] pair, or null. */
const rowsFor = (seasons) => Object.entries(seasons).map(([season, v]) => {
  if (v === null) return { season: Number(season), coach_name: null, coach_title: null };
  const [coach_name, coach_title = 'Head Coach', extra = {}] = Array.isArray(v) ? v : [v];
  return { season: Number(season), coach_name, coach_title, confidence: 'High', ...extra };
});
const model = (seasons, { measuredSeasons = ALL } = {}) =>
  coachAttribution({ coachRows: rowsFor(seasons), measuredSeasons });
const attributionOf = (m) => m.measuredSeasons.map((s) => s.attribution);

// ---------------------------------------------------------------------------

describe('reading one coach row', () => {
  it('accepts every head-coach title the staff pages use', () => {
    for (const title of ['Head Coach', 'Head Coach:', "Head Women's Soccer Coach",
      "Head Men's Soccer Coach", 'Head Soccer Coach', "Men's Soccer Head Coach",
      "Women's Soccer Head Coach", "Head Coach, Women's Soccer", 'Interim Head Coach',
      "Head Men’s Soccer Coach", "Head Men's & Women's Soccer Coach",
      'Head Coach/Assistant Athletic Director', "Wicks-Street Head Men's Soccer Coach"]) {
      const r = readCoachRow({ coach_name: 'A Coach', coach_title: title });
      expect(r.usable, title).toBe(true);
    }
  });

  // The whole reason this module does not delegate to `classifyRole`.
  it('refuses a head coach of something other than this team', () => {
    for (const title of ['Head Strength and Conditioning Coach', 'Head Strength Coach',
      'Head Coach, Strength & Conditioning', 'Head Strength & Conditioning Coach',
      'Head Peak Performance Coach', 'Director of Soccer Operations',
      'Assistant Coach & Director of Soccer Operations', 'Director of Soccer']) {
      const r = readCoachRow({ coach_name: 'A Coach', coach_title: title });
      expect(r.usable, title).toBe(false);
      expect(r.reason, title).toBe(UNUSABLE.NOT_A_HEAD_COACH);
    }
  });

  // A dual title is the coach they are, plus the other job they also hold.
  it('keeps a head coach who also runs something else', () => {
    for (const title of ["Head Men's Soccer Coach | Assistant Strength & Conditioning Coach",
      'Director of Soccer Operations/Head Coach',
      "Men's Soccer Head Coach / Coordinator of Soccer Operations",
      'Manager of Soccer Operations / Head Coach']) {
      expect(readCoachRow({ coach_name: 'A Coach', coach_title: title }).usable, title).toBe(true);
    }
  });

  it('refuses an associate head coach', () => {
    for (const title of ['Associate Head Coach', "Associate Head Men's Soccer Coach",
      'Associate Head Coach and Coordinator of Student-Athlete Development',
      'Catarina Macario Associate Head Coach', 'Interim Associate Head Coach']) {
      const r = readCoachRow({ coach_name: 'A Coach', coach_title: title });
      expect(r.usable, title).toBe(false);
      expect(r.reason, title).toBe(UNUSABLE.ASSOCIATE_HEAD);
    }
  });

  // Tampa's row: the heading of a records table, read as a person.
  it('refuses a page label in either column', () => {
    expect(readCoachRow({ coach_name: 'National Championships', coach_title: 'Head Coaching History' }).reason)
      .toBe(UNUSABLE.NOT_A_NAME);
    expect(readCoachRow({ coach_name: 'Phone Number', coach_title: 'Head Coach' }).reason)
      .toBe(UNUSABLE.NOT_A_NAME);
    expect(readCoachRow({ coach_name: 'Business Management', coach_title: 'Head Coach:' }).reason)
      .toBe(UNUSABLE.NOT_A_NAME);
  });

  it('refuses anything that cannot be a person’s name', () => {
    for (const name of ['Solo', '2024 Roster', 'coach@school.edu', '']) {
      expect(readCoachRow({ coach_name: name, coach_title: 'Head Coach' }).usable, name).toBe(false);
    }
  });

  // The distinction `tenureFor` documents: the page said nobody, versus we
  // could not read the page. Opposite claims.
  it('separates a recorded vacancy from an unreadable record', () => {
    expect(readCoachRow({ coach_name: 'TBA', coach_title: 'Head Coach' }).reason).toBe(UNUSABLE.VACANT);
    expect(readCoachRow({ coach_name: 'Vacant' }).reason).toBe(UNUSABLE.VACANT);
    expect(readCoachRow({ coach_name: null, reason: 'vacant-or-tba' }).reason).toBe(UNUSABLE.VACANT);
    expect(readCoachRow({ coach_name: null, reason: 'no-usable-page' }).reason).toBe(UNUSABLE.NO_NAME);
    expect(readCoachRow({ coach_name: null, reason: 'no-head-coach-found' }).reason).toBe(UNUSABLE.NO_NAME);
    expect(readCoachRow(null).reason).toBe(UNUSABLE.NO_ROW);
  });

  it('flags interim and co-head without refusing them', () => {
    const interim = readCoachRow({ coach_name: 'A Coach', coach_title: 'Interim Head Coach' });
    expect(interim.usable).toBe(true);
    expect(interim.interim).toBe(true);
    const co = readCoachRow({ coach_name: 'A Coach', coach_title: 'Co-Head Coach' });
    expect(co.usable).toBe(true);
    expect(co.coHead).toBe(true);
  });
});

describe('the current coach', () => {
  it('is the usable coach attached to the current season', () => {
    const { coach } = currentCoachFrom(rowsFor({ 2025: 'Old Coach', 2026: 'New Coach' }));
    expect(coach.name).toBe('New Coach');
    expect(coach.season).toBe(CURRENT_SEASON);
  });

  it('is null with a reason where the current season names no usable head coach', () => {
    for (const [row, reason] of [
      [{ 2026: null }, UNUSABLE.NO_NAME],
      [{ 2026: 'TBA' }, UNUSABLE.VACANT],
      [{ 2026: ['A Coach', 'Associate Head Coach'] }, UNUSABLE.ASSOCIATE_HEAD],
      [{ 2026: ['A Coach', 'Head Strength and Conditioning Coach'] }, UNUSABLE.NOT_A_HEAD_COACH],
      [{ 2025: 'A Coach' }, UNUSABLE.NO_ROW],
    ]) {
      const out = currentCoachFrom(rowsFor(row));
      expect(out.coach, JSON.stringify(row)).toBeNull();
      expect(out.reason, JSON.stringify(row)).toBe(reason);
    }
  });

  // Marist men's: the strength coach was captured for every season, so an
  // unfiltered model would have said "4 of 4 seasons under the current coach"
  // about a named person who never coached the team.
  it('does not attribute a programme’s history to its strength coach', () => {
    const m = model({
      2022: ['Aaron Suma', 'Head Strength and Conditioning Coach'],
      2023: ['Aaron Suma', 'Head Strength and Conditioning Coach'],
      2024: ['Aaron Suma', 'Head Strength and Conditioning Coach'],
      2025: ['Aaron Suma', 'Head Strength and Conditioning Coach'],
      2026: ['Aaron Suma', 'Head Strength and Conditioning Coach'],
    });
    expect(m.currentCoach).toBeNull();
    expect(m.currentCoachMeasuredSeasons).toBe(0);
    expect(m.timelineState).toBe(TIMELINE.CURRENT_COACH_UNKNOWN);
    expect(attributionOf(m)).toEqual(Array(4).fill(ATTRIBUTION.UNRESOLVED));
    expect(m.evidence.sufficient).toBe(false);
  });
});

describe('season attribution', () => {
  // The example the specification gives, verbatim.
  it('never interpolates across an unresolved season', () => {
    const m = model({ 2022: 'Coach A', 2023: 'Coach A', 2024: null, 2025: 'Coach B', 2026: 'Coach B' });
    expect(attributionOf(m)).toEqual([ATTRIBUTION.PREVIOUS, ATTRIBUTION.PREVIOUS,
      ATTRIBUTION.UNRESOLVED, ATTRIBUTION.CURRENT]);
    expect(m.measuredSeasons[2].coachName).toBeNull();
    expect(m.incompleteCoachSeasons).toEqual(['2024']);
  });

  // Ohio State men's. The same name either side of a gap is two observations.
  it('does not close a gap between two spells of one name', () => {
    const m = model({ 2022: 'Brian Maisonneuve', 2023: 'Brian Maisonneuve', 2024: null,
      2025: 'Brian Maisonneuve', 2026: 'Brian Maisonneuve' });
    expect(attributionOf(m)).toEqual([ATTRIBUTION.CURRENT, ATTRIBUTION.CURRENT,
      ATTRIBUTION.UNRESOLVED, ATTRIBUTION.CURRENT]);
    expect(m.currentCoachMeasuredSeasons).toBe(3);
    expect(m.historicalMeasuredSeasons).toBe(4);
    expect(m.transitionCount).toBe(0);
    // A gap is not a departure and not a return.
    expect(m.predecessor).toBeNull();
  });

  it('matches a coach across punctuation, case and accents', () => {
    const m = model({ 2022: 'José Álvarez', 2023: 'Jose Alvarez', 2024: 'JOSE ALVAREZ',
      2025: 'J. Alvarez', 2026: 'Jose Alvarez' });
    expect(attributionOf(m)).toEqual(Array(4).fill(ATTRIBUTION.CURRENT));
    expect(m.timelineState).toBe(TIMELINE.SAME_COACH_ALL_HISTORY);
  });

  it('matches a surname-first spelling to the same person', () => {
    const m = model({ 2022: 'Mauzy-Fleming, Meghan', 2025: 'Meghan Mauzy-Fleming',
      2026: 'Meghan Mauzy-Fleming' }, { measuredSeasons: ['2022', '2025'] });
    expect(attributionOf(m)).toEqual([ATTRIBUTION.CURRENT, ATTRIBUTION.CURRENT]);
  });

  it('does not merge two different coaches who share a surname', () => {
    const m = model({ 2022: 'Alan Smith', 2025: 'Brenda Smith', 2026: 'Brenda Smith' },
      { measuredSeasons: ['2022', '2025'] });
    expect(attributionOf(m)).toEqual([ATTRIBUTION.PREVIOUS, ATTRIBUTION.CURRENT]);
  });
});

describe('the denominator', () => {
  // The point of handing the seasons in.
  it('counts only the seasons the report measured', () => {
    const rows = rowsFor({ 2022: 'Old Coach', 2023: 'Old Coach', 2024: 'New Coach', 2025: 'New Coach', 2026: 'New Coach' });
    const all = coachAttribution({ coachRows: rows, measuredSeasons: ALL });
    expect(`${all.currentCoachMeasuredSeasons} of ${all.historicalMeasuredSeasons}`).toBe('2 of 4');
    // 2023 unreadable: the denominator is three, not four.
    const three = coachAttribution({ coachRows: rows, measuredSeasons: ['2022', '2024', '2025'] });
    expect(`${three.currentCoachMeasuredSeasons} of ${three.historicalMeasuredSeasons}`).toBe('2 of 3');
    expect(three.measuredSeasons.map((s) => s.season)).toEqual(['2022', '2024', '2025']);
  });

  it('never counts the current season as measured history', () => {
    const m = coachAttribution({
      coachRows: rowsFor({ 2025: 'New Coach', 2026: 'New Coach' }),
      measuredSeasons: ['2025', '2026'],
    });
    expect(m.measuredSeasons.map((s) => s.season)).toEqual(['2025']);
    expect(m.historicalMeasuredSeasons).toBe(1);
  });

  it('states a share only where there is a denominator', () => {
    expect(model({ 2026: 'A Coach' }, { measuredSeasons: [] }).currentCoachShare).toBeNull();
    expect(model({ 2025: 'A Coach', 2026: 'A Coach' }, { measuredSeasons: ['2025'] }).currentCoachShare).toBe(1);
  });

  // No threshold, no label — the raw fact and nothing else.
  it('exposes no representativeness category', () => {
    const m = model({ 2022: 'Old Coach', 2023: 'Old Coach', 2024: 'Old Coach', 2025: 'New Coach', 2026: 'New Coach' });
    const json = JSON.stringify(m).toUpperCase();
    for (const banned of ['REPRESENTATIVE', 'HIGHLY', 'PARTLY', 'MOSTLY', 'STRONG', 'WEAK', 'GOOD', 'POOR']) {
      expect(json, banned).not.toContain(banned);
    }
  });
});

describe('observed transitions', () => {
  it('counts a change only between adjacent resolved seasons', () => {
    expect(model({ 2022: 'A Coach', 2023: 'A Coach', 2024: 'B Coach', 2025: 'B Coach', 2026: 'B Coach' })
      .transitionCount).toBe(1);
  });

  it('counts nothing across a gap, in either direction', () => {
    // A -> unresolved -> B is not an observed change.
    expect(model({ 2022: 'A Coach', 2023: null, 2024: 'B Coach', 2025: 'B Coach', 2026: 'B Coach' })
      .transitionCount).toBe(0);
    // A -> unresolved -> A is not a change either.
    expect(model({ 2022: 'A Coach', 2023: null, 2024: 'A Coach', 2025: 'A Coach', 2026: 'A Coach' })
      .transitionCount).toBe(0);
  });

  /**
   * The deliberate under-count. The change from A to B happened at 2024, and
   * with 2023 unreadable the two measured seasons either side of it are not
   * adjacent — so nothing observed inside the measured window places the
   * change, and nothing is counted. The attribution still reads correctly: two
   * seasons previous, one current.
   */
  it('counts nothing across a season the report could not measure', () => {
    const rows = rowsFor({ 2022: 'A Coach', 2023: 'A Coach', 2024: 'B Coach', 2025: 'B Coach', 2026: 'B Coach' });
    const m = coachAttribution({ coachRows: rows, measuredSeasons: ['2022', '2024', '2025'] });
    expect(m.transitionCount).toBe(0);
    expect(m.currentCoachMeasuredSeasons).toBe(2);
    expect(m.previousCoachMeasuredSeasons).toBe(1);
    // Measured across all four, the same rows do place it.
    expect(coachAttribution({ coachRows: rows, measuredSeasons: ALL }).transitionCount).toBe(1);
  });

  // Lake Forest men's: Andrews, Dean, Andrews, Andrews.
  it('counts a return as two changes, not one spell', () => {
    const m = model({ 2022: 'Dan Andrews', 2023: 'Tim Dean', 2024: 'Dan Andrews',
      2025: 'Dan Andrews', 2026: 'Dan Andrews' });
    expect(m.transitionCount).toBe(2);
    expect(m.timelineState).toBe(TIMELINE.MULTIPLE_CHANGES);
  });

  it('is a pure function of the season list', () => {
    expect(observedTransitions([])).toEqual([]);
    expect(observedTransitions([{ season: '2022', coachName: 'A Coach' }])).toEqual([]);
  });
});

describe('the timeline state', () => {
  const state = (seasons, opts) => model(seasons, opts).timelineState;

  it('reads a whole window under one coach', () => {
    expect(state({ 2022: 'Ada Coach', 2023: 'Ada Coach', 2024: 'Ada Coach', 2025: 'Ada Coach', 2026: 'Ada Coach' }))
      .toBe(TIMELINE.SAME_COACH_ALL_HISTORY);
  });

  it('reads a change inside the window', () => {
    expect(state({ 2022: 'Ada Coach', 2023: 'Ada Coach', 2024: 'Ben Coach', 2025: 'Ben Coach', 2026: 'Ben Coach' }))
      .toBe(TIMELINE.COACH_CHANGE_WITHIN_WINDOW);
  });

  it('reads a current coach with no measured season', () => {
    expect(state({ 2022: 'Ada Coach', 2023: 'Ada Coach', 2024: 'Ada Coach', 2025: 'Ada Coach', 2026: 'Ben Coach' }))
      .toBe(TIMELINE.CURRENT_COACH_NO_MEASURED_SEASON);
  });

  it('reads an unknown current coach ahead of everything else', () => {
    expect(state({ 2022: 'Ada Coach', 2023: 'Ada Coach', 2024: 'Ada Coach', 2025: 'Ada Coach', 2026: null }))
      .toBe(TIMELINE.CURRENT_COACH_UNKNOWN);
  });

  /**
   * Mercyhurst men's, and the reason the priority is ordered as it is: two of
   * four seasons are unresolved, and "incomplete" is true of a different
   * programme and useless here. One known season is the fact a reader needs.
   */
  it('does not let an incomplete record erase one known season', () => {
    const m = model({ 2022: 'Ryan Osborne', 2023: null, 2024: null,
      2025: 'Austin Solomon', 2026: 'Austin Solomon' });
    expect(m.timelineState).toBe(TIMELINE.CURRENT_COACH_ONE_SEASON);
    expect(m.currentCoachMeasuredSeasons).toBe(1);
    expect(m.incompleteCoachSeasons).toEqual(['2023', '2024']);
  });

  it('falls to an incomplete record only where nothing better can be said', () => {
    const m = model({ 2022: null, 2023: null, 2024: 'A Coach', 2025: 'A Coach', 2026: 'A Coach' });
    expect(m.timelineState).toBe(TIMELINE.COACH_RECORD_INCOMPLETE);
    expect(m.facts.attributed).toBe(2);
    expect(m.facts.unresolved).toBe(2);
    expect(m.facts.previous).toBe(0);
  });

  // The whole reason the facts travel with the enum.
  it('carries every fact the label had to drop', () => {
    const m = model({ 2022: 'Ada Coach', 2023: 'Ada Coach', 2024: null, 2025: 'Ada Coach', 2026: 'Ada Coach' });
    expect(m.timelineState).toBe(TIMELINE.COACH_RECORD_INCOMPLETE);
    expect(m.facts).toMatchObject({
      currentCoachKnown: true, measured: 4, attributed: 3, previous: 0, unresolved: 1, transitions: 0,
    });
  });

  it('derives the state from the facts and nothing else', () => {
    expect(timelineStateOf({ currentCoachKnown: false, measured: 4, attributed: 0, previous: 0, unresolved: 4, transitions: 0 }))
      .toBe(TIMELINE.CURRENT_COACH_UNKNOWN);
    expect(timelineStateOf({ currentCoachKnown: true, measured: 4, attributed: 4, previous: 0, unresolved: 0, transitions: 0 }))
      .toBe(TIMELINE.SAME_COACH_ALL_HISTORY);
  });
});

describe('the coach on file for earlier seasons', () => {
  // Hofstra men's.
  it('names one coach where every earlier season carries that name', () => {
    const m = model({ 2022: 'Richard Nuttall', 2023: 'Richard Nuttall', 2024: 'Richard Nuttall',
      2025: 'Richard Nuttall', 2026: 'Stephen Roche' });
    expect(m.predecessor).toEqual({ name: 'Richard Nuttall', seasons: ['2022', '2023', '2024', '2025'] });
    expect(m.predecessorIsSingleNamedCoach).toBe(true);
  });

  // Michigan men's: nothing may be invented.
  it('names nobody where no earlier season resolves', () => {
    const m = model({ 2022: null, 2023: null, 2024: null, 2025: null, 2026: 'Chaka Daley' });
    expect(m.predecessor).toBeNull();
    expect(m.predecessorIsSingleNamedCoach).toBe(false);
    expect(m.currentCoachMeasuredSeasons).toBe(0);
    expect(m.timelineState).toBe(TIMELINE.CURRENT_COACH_NO_MEASURED_SEASON);
  });

  // Drexel men's: two earlier names, so no single one may be named.
  it('names nobody where more than one earlier coach is on file', () => {
    const m = model({ 2022: 'Michael Marchiano', 2023: 'Mark Fetrow',
      2024: 'David Castellanos', 2025: 'David Castellanos', 2026: 'David Castellanos' });
    expect(m.predecessor).toBeNull();
    // ...and the season-level timeline is retained.
    expect(m.measuredSeasons.map((s) => s.coachName))
      .toEqual(['Michael Marchiano', 'Mark Fetrow', 'David Castellanos', 'David Castellanos']);
  });

  it('names nobody where the only earlier seasons are unresolved', () => {
    expect(model({ 2022: null, 2023: 'A Coach', 2024: 'A Coach', 2025: 'A Coach', 2026: 'A Coach' })
      .predecessor).toBeNull();
  });
});

describe('interim and co-head', () => {
  // Boston College men's.
  it('marks an interim current coach and demands the qualifier', () => {
    const m = model({ 2022: 'Bob Thompson', 2023: 'Bob Thompson', 2024: 'Bob Thompson',
      2025: 'Bob Thompson', 2026: ["Francesco D'Agostino", 'Interim Head Coach'] });
    expect(m.currentCoach.interim).toBe(true);
    expect(m.facts.interim).toBe(true);
    expect(m.requiresInterimQualifier).toBe(true);
    expect(m.evidence.reasons.join(' ')).toMatch(/recorded as interim/);
  });

  it('does not demand the qualifier where the current coach is not interim', () => {
    expect(model({ 2025: 'A Coach', 2026: 'A Coach' }, { measuredSeasons: ['2025'] })
      .requiresInterimQualifier).toBe(false);
  });

  // Butler women's. The schema cannot hold the second name; the model says so.
  it('flags a co-head arrangement and states the schema limit', () => {
    const m = model({ 2022: ['Tari St. John', 'Co-Head Coach'], 2023: ['Tari St. John', 'Co-Head Coach'],
      2024: ['Tari St. John', 'Co-Head Coach'], 2025: ['Tari St. John', 'Co-Head Coach'],
      2026: ['Tari St. John', 'Co-Head Coach'] });
    expect(m.facts.coHead).toBe(true);
    expect(m.evidence.reasons.join(' ')).toMatch(/one row per season cannot fully represent/);
    // Still attributed: the named co-head did coach those seasons.
    expect(m.currentCoachMeasuredSeasons).toBe(4);
  });
});

describe('what this model may not claim', () => {
  /**
   * It has no cross-programme surface at all, which is the protection.
   *
   * `sameCoach` would say the San Francisco men's Chris Brown and the South
   * Florida women's Chris Brown are one person — they are not, and Phase 11A
   * found them to be the only genuine identity conflict in 2,286 names. The
   * model cannot make that mistake because it is only ever handed one
   * programme's rows and never compares two.
   */
  it('makes no claim spanning two programmes', () => {
    const usf = model({ 2022: 'Chris Brown', 2023: 'Chris Brown', 2024: 'Chris Brown',
      2025: 'Chris Brown', 2026: 'Chris Brown' });
    const southFlorida = model({ 2024: 'Chris Brown', 2025: 'Chris Brown', 2026: 'Chris Brown' },
      { measuredSeasons: ['2024', '2025'] });
    expect(usf.historicalMeasuredSeasons).toBe(4);
    expect(southFlorida.historicalMeasuredSeasons).toBe(2);
    // Nothing on either model refers to another programme.
    for (const m of [usf, southFlorida]) {
      const keys = JSON.stringify(m).toLowerCase();
      for (const banned of ['school', 'college', 'programme', 'institution', 'otherprogramme']) {
        expect(keys, banned).not.toContain(`"${banned}`);
      }
    }
  });

  /**
   * Two programmes at one institution — "Albright" men's and "Albright
   * College" women's are the same college — are two independent models. No
   * institution key is needed, because no claim crosses a programme.
   */
  it('treats one institution’s two teams as two independent records', () => {
    const mens = model({ 2022: 'Pat Stanco', 2023: 'Pat Stanco', 2024: 'Pat Stanco',
      2025: 'Pat Stanco', 2026: 'Pat Stanco' });
    const womens = model({ 2022: 'Pat Stanco', 2023: 'Shamus Matthews-Brady', 2024: null,
      2025: 'Shamus Matthews-Brady', 2026: 'Shamus Matthews-Brady' });
    expect(mens.timelineState).toBe(TIMELINE.SAME_COACH_ALL_HISTORY);
    expect(womens.currentCoachMeasuredSeasons).toBe(2);
    expect(womens.predecessor).toEqual({ name: 'Pat Stanco', seasons: ['2022'] });
  });

  /**
   * The consortium case: Claremont McKenna, Harvey Mudd and Scripps field one
   * side under one coach. Each is its own model and each is correct; nothing
   * in this module would multiply them into three programmes for that coach.
   */
  it('says nothing about a coach appearing at several colleges of one team', () => {
    for (const m of [1, 2, 3].map(() => model({ 2023: 'David Nolan', 2024: 'David Nolan',
      2025: 'David Nolan', 2026: 'David Nolan' }, { measuredSeasons: ['2023', '2024', '2025'] }))) {
      expect(m.currentCoachMeasuredSeasons).toBe(3);
      expect(m.timelineState).toBe(TIMELINE.SAME_COACH_ALL_HISTORY);
    }
  });

  /**
   * The vocabulary guard. Every string this module can emit, plus its own
   * source, is checked against the language that would assert employment order
   * or causation. The forbidden words appear in this repository only here, in
   * the test that rejects them.
   */
  it('emits no employment or causal language', () => {
    const strings = [
      ...Object.values(UNUSABLE), ...Object.values(ATTRIBUTION), ...Object.values(TIMELINE),
      ...[
        model({ 2022: 'Ada Coach', 2023: null, 2024: 'Ben Coach', 2025: 'Ben Coach', 2026: 'Ben Coach' }),
        model({ 2026: null }),
        model({ 2026: ['A Coach', 'Interim Head Coach'] }),
        model({ 2022: ['Ada Coach', 'Co-Head Coach'], 2026: ['Ada Coach', 'Co-Head Coach'] }),
      ].flatMap((m) => [m.currentCoachReason, ...m.evidence.reasons, m.timelineState]),
    ].filter(Boolean).join(' | ').toLowerCase();
    for (const banned of ['hired', 'was fired', ' left ', 'replaced', 'succeeded', 'departed',
      'prefers', 'develops', 'caused', 'because the coach', "coach's record", 'former coach',
      'took over', 'stepped down']) {
      expect(strings, banned).not.toContain(banned);
    }
  });

  it('keeps that language out of the module itself', () => {
    const src = fs.readFileSync(new URL('./coachAttribution.js', import.meta.url), 'utf8').toLowerCase();
    for (const banned of ['hired', 'replaced', 'succeeded', 'prefers', 'develops',
      "coach's record", 'former coach', 'took over', 'stepped down']) {
      expect(src, banned).not.toContain(banned);
    }
  });
});

describe('degenerate input', () => {
  it('returns a model with no denominator rather than throwing', () => {
    const m = coachAttribution();
    expect(m.currentCoach).toBeNull();
    expect(m.historicalMeasuredSeasons).toBe(0);
    expect(m.currentCoachShare).toBeNull();
    expect(m.timelineState).toBe(TIMELINE.CURRENT_COACH_UNKNOWN);
    expect(m.evidence.sufficient).toBe(false);
  });

  it('ignores rows whose season cannot be read', () => {
    const m = coachAttribution({
      coachRows: [{ season: 'not a year', coach_name: 'A Coach' }, ...rowsFor({ 2026: 'A Coach' })],
      measuredSeasons: ['2025'],
    });
    expect(m.currentCoach.name).toBe('A Coach');
    expect(m.measuredSeasons[0].attribution).toBe(ATTRIBUTION.UNRESOLVED);
  });

  it('deduplicates and orders the measured seasons it is handed', () => {
    const m = coachAttribution({
      coachRows: rowsFor({ 2026: 'A Coach' }),
      measuredSeasons: ['2025', '2022', '2025'],
    });
    expect(m.measuredSeasons.map((s) => s.season)).toEqual(['2022', '2025']);
  });
});
