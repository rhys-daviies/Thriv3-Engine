/**
 * How loudly the report says whose seasons these are.
 *
 * The counts come from `coachAttribution`, which has its own suite. What is
 * asserted here is the prominence, the wording and the two things that must
 * never appear: an employment claim, and a categorical label for a coach.
 */
import { describe, it, expect } from 'vitest';
import { coachAttribution } from '../coachAttribution.js';
import { coachContextFor, coachTimelineFor, PROMINENCE } from './coachContext.js';

const ALL = ['2022', '2023', '2024', '2025'];
const rowsFor = (seasons) => Object.entries(seasons).map(([season, v]) => {
  if (v === null) return { season: Number(season), coach_name: null, coach_title: null };
  const [coach_name, coach_title = 'Head Coach', reason = null] = Array.isArray(v) ? v : [v];
  return { season: Number(season), coach_name, coach_title, reason, confidence: 'High' };
});
const ctxFor = (seasons, { measuredSeasons = ALL, division = 'NCAA D1' } = {}) => coachContextFor(
  coachAttribution({ coachRows: rowsFor(seasons), measuredSeasons }), { division },
);

describe('prominence', () => {
  it('is quiet where every measured season is the current coach’s', () => {
    const c = ctxFor({ 2022: 'John Kerr', 2023: 'John Kerr', 2024: 'John Kerr', 2025: 'John Kerr', 2026: 'John Kerr' });
    expect(c.prominence).toBe(PROMINENCE.QUIET);
    expect(c.subline).toBe('all 4 measured seasons in this report');
    expect(c.chip).toBe('CURRENT COACH HISTORY');
  });

  it('is visible where some but not all are', () => {
    const c = ctxFor({ 2022: 'Greg Dalby', 2023: 'Greg Dalby', 2024: 'Jarred Brookins', 2025: 'Jarred Brookins', 2026: 'Jarred Brookins' });
    expect(c.prominence).toBe(PROMINENCE.VISIBLE);
    expect(c.subline).toBe('2 of the 4 measured seasons in this report');
    // Two names either side of an observed boundary: a change, and it says so.
    expect(c.chip).toBe('COACHING CHANGE IN WINDOW');
  });

  /**
   * PHASE 11D — an unread season is not a coaching change.
   *
   * Metro State Denver's window is Nick Kirchhof, a season nobody could read,
   * and Nick Kirchhof. The card said COACHING CHANGE IN WINDOW over a strip
   * whose only other cell is blank — the same claim-without-evidence the
   * verdict was making, in the opposite direction.
   */
  it('calls a short record incomplete rather than a change', () => {
    const c = ctxFor({ 2022: 'Nick Kirchhof', 2023: null, 2024: 'Nick Kirchhof', 2025: 'Nick Kirchhof', 2026: 'Nick Kirchhof' });
    expect(c.prominence).toBe(PROMINENCE.VISIBLE);
    expect(c.chip).toBe('COACH RECORD INCOMPLETE');
    expect(c.previous).toBe(0);
    expect(c.unresolved).toBe(1);
  });

  // Mercyhurst men's.
  it('is prominent at one measured season', () => {
    const c = ctxFor({ 2022: 'Ryan Osborne', 2023: null, 2024: null, 2025: 'Austin Solomon', 2026: 'Austin Solomon' });
    expect(c.prominence).toBe(PROMINENCE.PROMINENT);
    expect(c.chip).toBe('ONE MEASURED SEASON');
    expect(c.banner).toBe('Only 1 of the 4 measured seasons in this report was under Austin Solomon.');
    expect(c.sentence).toContain('remain useful as programme history');
    expect(c.sentence).toContain('Ryan Osborne is the named coach on file for the 2022 measured season');
  });

  // Hofstra men's.
  it('is prominent at none, and can name the coach on file for the earlier seasons', () => {
    const c = ctxFor({ 2022: 'Richard Nuttall', 2023: 'Richard Nuttall', 2024: 'Richard Nuttall', 2025: 'Richard Nuttall', 2026: 'Stephen Roche' });
    expect(c.prominence).toBe(PROMINENCE.PROMINENT);
    expect(c.chip).toBe('NO MEASURED SEASON');
    expect(c.banner).toBe('None of the 4 measured seasons in this report were under Stephen Roche.');
    expect(c.sentence).toContain('Richard Nuttall is the named coach on file for all 4 measured seasons');
  });

  // Michigan men's: nothing may be invented.
  it('names nobody where the earlier seasons are unresolved', () => {
    const c = ctxFor({ 2022: null, 2023: null, 2024: null, 2025: null, 2026: 'Chaka Daley' });
    expect(c.prominence).toBe(PROMINENCE.PROMINENT);
    expect(c.predecessor).toBeNull();
    expect(c.sentence).toContain('predates the current coaching context');
    expect(c.sentence).not.toMatch(/named coach on file/);
  });

  // Marist men's: the strength coach.
  it('refuses where the current coach could not be established', () => {
    const c = ctxFor({ 2022: ['Aaron Suma', 'Head Strength and Conditioning Coach'],
      2026: ['Aaron Suma', 'Head Strength and Conditioning Coach'] });
    expect(c.prominence).toBe(PROMINENCE.REFUSAL);
    expect(c.available).toBe(false);
    expect(c.headline).toBe('Could not establish');
    expect(c.sentence).toContain('could not be established from the coach record on file');
    expect(c.sentence).toContain('remains measurable');
    // The refused name appears nowhere.
    expect(JSON.stringify(c)).not.toContain('Aaron Suma');
  });

  it('says the post is recorded vacant only where it is', () => {
    const vacant = ctxFor({ 2022: 'A Coach', 2026: 'TBA' });
    expect(vacant.subline).toMatch(/vacant or to be announced/);
    const unread = ctxFor({ 2022: 'A Coach', 2026: [null, null, 'no-usable-page'] });
    expect(unread.subline).not.toMatch(/vacant/);
    expect(unread.subline).toMatch(/could not be read/);
  });

  // NAIA, NJCAA, USCAA: no coach table at all.
  it('says nothing where no coach record is held at this level', () => {
    const c = ctxFor({}, { division: 'NAIA', measuredSeasons: ['2025'] });
    expect(c.prominence).toBe(PROMINENCE.ABSENT);
    expect(c.structural).toBe(true);
    // The card is a fixed panel and needs a value; it gets a small unavailable
    // state rather than a refusal, and no sentence anywhere.
    expect(c.chip).toBe('NOT ON FILE');
    expect(c.subline).toBe('no coaching record is held at this level');
    expect(c.sentence).toBeNull();
    expect(c.banner).toBeUndefined();
  });

  // Boston College men's.
  it('qualifies an interim and never calls it a regime', () => {
    const c = ctxFor({ 2022: 'Bob Thompson', 2023: 'Bob Thompson', 2024: 'Bob Thompson',
      2025: 'Bob Thompson', 2026: ["Francesco D'Agostino", 'Interim Head Coach'] });
    expect(c.prominence).toBe(PROMINENCE.PROMINENT);
    expect(c.chip).toBe('INTERIM HEAD COACH');
    expect(c.interim).toBe(true);
    expect(c.banner).toBe("The 2026 coach record identifies Francesco D'Agostino as interim head coach.");
    expect(c.sentence).toMatch(/identifies .* as interim head coach/);
  });

  // Butler women's.
  it('states the co-head limitation rather than hiding it', () => {
    const c = ctxFor({ 2022: ['Tari St. John', 'Co-Head Coach'], 2023: ['Tari St. John', 'Co-Head Coach'],
      2024: ['Tari St. John', 'Co-Head Coach'], 2025: ['Tari St. John', 'Co-Head Coach'],
      2026: ['Tari St. John', 'Co-Head Coach'] });
    expect(c.coHead).toBe(true);
    expect(c.coHeadNote).toMatch(/one coach for each programme-season/);
    expect(c.prominence).toBe(PROMINENCE.QUIET);
  });

  it('shows a name but no count where no season could be measured', () => {
    const c = ctxFor({ 2026: 'A Coach' }, { measuredSeasons: [] });
    expect(c.prominence).toBe(PROMINENCE.QUIET);
    expect(c.headline).toBe('A Coach');
    expect(c.subline).toMatch(/no measured season/);
    expect(c.sentence).toBeNull();
  });

  it('reads a one-season window in the singular', () => {
    const c = ctxFor({ 2025: 'A Coach', 2026: 'A Coach' }, { measuredSeasons: ['2025'] });
    expect(c.prominence).toBe(PROMINENCE.QUIET);
    expect(c.subline).toBe('the single measured season in this report');
    expect(c.sentence).toBe('The single measured season in this report was under A Coach, the coach on file for 2026.');
  });
});

describe('the season strip', () => {
  // Ohio State men's: a gap between two spells of one name.
  it('shows the seasons and never fills a gap', () => {
    const t = coachTimelineFor(ctxFor({ 2022: 'Brian Maisonneuve', 2024: null,
      2025: 'Brian Maisonneuve', 2026: 'Brian Maisonneuve' }, { measuredSeasons: ['2022', '2024', '2025'] }));
    expect(t.cells.map((c) => `${c.season}:${c.label}`))
      .toEqual(['2022:Maisonneuve', '2024:unresolved', '2025:Maisonneuve', '2026:Maisonneuve']);
    expect(t.unresolved).toBe(1);
    expect(t.caption).toContain('1 unresolved');
  });

  it('ends on the season a recruit would join', () => {
    const t = coachTimelineFor(ctxFor({ 2022: 'Greg Dalby', 2023: 'Greg Dalby',
      2024: 'Jarred Brookins', 2025: 'Jarred Brookins', 2026: 'Jarred Brookins' }));
    expect(t.cells[t.cells.length - 1]).toMatchObject({ season: '2026', isCurrentSeason: true });
    expect(t.caption).toBe('Greg Dalby 2022–2023  ·  Jarred Brookins 2024–2026');
  });

  it('is not drawn where one name covers every season', () => {
    expect(coachTimelineFor(ctxFor({ 2022: 'John Kerr', 2023: 'John Kerr', 2024: 'John Kerr',
      2025: 'John Kerr', 2026: 'John Kerr' }))).toBeNull();
  });

  it('is not drawn where no season resolves at all', () => {
    expect(coachTimelineFor(ctxFor({ 2026: ['Aaron Suma', 'Head Strength Coach'] }))).toBeNull();
  });

  it('uses names rather than CURRENT and PREVIOUS', () => {
    const t = coachTimelineFor(ctxFor({ 2022: 'Greg Dalby', 2023: 'Greg Dalby',
      2024: 'Jarred Brookins', 2025: 'Jarred Brookins', 2026: 'Jarred Brookins' }));
    const json = JSON.stringify(t);
    expect(json).not.toContain('CURRENT_COACH');
    expect(json).not.toContain('PREVIOUS');
  });

  it('marks a recorded vacancy apart from an unreadable season', () => {
    const t = coachTimelineFor(ctxFor({ 2022: 'A Coach', 2023: 'TBA', 2024: [null, null, 'no-usable-page'],
      2025: 'B Coach', 2026: 'B Coach' }));
    const by = Object.fromEntries(t.cells.map((c) => [c.season, c]));
    expect(by['2023'].vacant).toBe(true);
    expect(by['2024'].vacant).toBe(false);
    expect(t.caption).toContain('1 unresolved');
    expect(t.caption).toContain('1 recorded vacant');
  });
});

describe('what the wording may not say', () => {
  const everything = () => [
    ctxFor({ 2022: 'A Coach', 2023: 'A Coach', 2024: 'A Coach', 2025: 'A Coach', 2026: 'A Coach' }),
    ctxFor({ 2022: 'A Coach', 2023: 'A Coach', 2024: 'B Coach', 2025: 'B Coach', 2026: 'B Coach' }),
    ctxFor({ 2022: 'A Coach', 2023: null, 2024: null, 2025: 'B Coach', 2026: 'B Coach' }),
    ctxFor({ 2022: 'A Coach', 2023: 'A Coach', 2024: 'A Coach', 2025: 'A Coach', 2026: 'B Coach' }),
    ctxFor({ 2022: null, 2023: null, 2024: null, 2025: null, 2026: 'B Coach' }),
    ctxFor({ 2026: null }),
    ctxFor({ 2026: 'TBA' }),
    ctxFor({ 2026: ['A Coach', 'Interim Head Coach'] }),
    ctxFor({ 2026: ['A Coach', 'Co-Head Coach'] }),
    ctxFor({}, { division: 'NAIA' }),
  ].map((c) => [c.chip, c.headline, c.subline, c.sentence, c.banner, c.coHeadNote, c.reason]
    .filter(Boolean).join(' | ')).join(' || ').toLowerCase();

  it('asserts no employment event', () => {
    const text = everything();
    for (const banned of ['hired', 'appointed', 'was fired', ' left ', 'replaced', 'succeeded',
      'departed', 'took over', 'stepped down', 'tenure', 'served for', 'new coach']) {
      expect(text, banned).not.toContain(banned);
    }
  });

  it('asserts nothing causal and nothing about preference', () => {
    const text = everything();
    for (const banned of ['prefers', 'develops', 'caused', 'because the coach', "coach's record",
      'this history belongs to']) {
      expect(text, banned).not.toContain(banned);
    }
  });

  it('introduces no categorical label for a coach', () => {
    const text = everything();
    for (const banned of ['representative', 'unrepresentative', 'stable', 'unstable',
      ' good ', ' bad ', ' high ', ' medium ', ' low ']) {
      expect(text, banned).not.toContain(banned);
    }
  });

  it('never calls the earlier seasons irrelevant', () => {
    const text = everything();
    for (const banned of ['irrelevant', 'no longer relevant', 'disregard', 'ignore']) {
      expect(text, banned).not.toContain(banned);
    }
  });

  it('says "was under", not "belongs to"', () => {
    const c = ctxFor({ 2022: 'A Coach', 2023: 'A Coach', 2024: 'A Coach', 2025: 'A Coach', 2026: 'B Coach' });
    expect(c.sentence).toMatch(/were under/);
    expect(c.sentence).not.toMatch(/belongs to/);
  });
});

describe('degenerate input', () => {
  it('is absent rather than throwing where there is no attribution', () => {
    const c = coachContextFor(null);
    expect(c.prominence).toBe(PROMINENCE.ABSENT);
    expect(c.available).toBe(false);
    expect(coachTimelineFor(c)).toBeNull();
    expect(coachTimelineFor(null)).toBeNull();
  });
});
