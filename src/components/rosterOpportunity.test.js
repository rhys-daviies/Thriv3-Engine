import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RosterOpportunity from './RosterOpportunity.jsx';
import ProgrammeDecision from './ProgrammeDecision.jsx';
import { rosterCopyFor, ROSTER_COPY_KINDS } from '@/lib/rosterEvidenceCopy';
import { ROSTER_FIXTURES } from '@/lib/__fixtures__/rosterEvidence.js';
import { SECTION_OF, SECTIONS } from '@shared/evidence/operatorEvidence.js';

/**
 * The roster section, against real payloads for six real programmes.
 *
 * The property under most of these is that three overlapping populations stay
 * three. Jacksonville graduates 3 defenders, projects 2 of that position group
 * as starters, and has 5 reaching the end of eligibility across 2026 and 2027
 * — of whom the 2026 rows are the same three people. Every sum of those is a
 * number nobody computed, and each is a plausible-looking sentence.
 */

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const roster = (name) => ROSTER_FIXTURES[name].sections.ROSTER_OPPORTUNITY;
const render = (name) => renderToStaticMarkup(
  createElement(RosterOpportunity, { items: roster(name) }),
);
const item = (name, kind) => roster(name).find((i) => i.kind === kind);

describe('every roster kind can be presented', () => {
  it('covers all seven kinds the section can receive', () => {
    // Read from the section map rather than listed here, so a kind filed into
    // ROSTER_OPPORTUNITY later fails this instead of rendering as a gap.
    const filed = Object.entries(SECTION_OF)
      .filter(([, section]) => section === SECTIONS.ROSTER_OPPORTUNITY)
      .map(([kind]) => kind);
    expect(filed).toHaveLength(7);
    expect(filed.filter((k) => !ROSTER_COPY_KINDS.includes(k))).toEqual([]);
  });

  it('presents every item in every fixture', () => {
    const missing = [];
    for (const name of Object.keys(ROSTER_FIXTURES)) {
      for (const i of roster(name)) if (!rosterCopyFor(i)) missing.push(`${name}/${i.kind}`);
    }
    expect(missing).toEqual([]);
  });

  it('shows an unknown kind rather than dropping it', () => {
    const html = renderToStaticMarkup(createElement(RosterOpportunity, {
      items: [{ kind: 'SOME_FUTURE_ROSTER_KIND', facts: {}, qualification: {} }],
    }));
    expect(text(html)).toContain('No roster wording');
    expect(text(html)).toContain('SOME_FUTURE_ROSTER_KIND');
  });

  it('returns null rather than half a row when a fact is missing', () => {
    expect(rosterCopyFor({ kind: 'POSITION_GRADUATION', facts: {} })).toBeNull();
    expect(rosterCopyFor({ kind: 'NOT_A_KIND', facts: { count: 3 } })).toBeNull();
    expect(rosterCopyFor(null)).toBeNull();
  });
});

describe('Jacksonville keeps three populations apart', () => {
  const html = render('Jacksonville');
  const t = text(html);

  it('states the graduating class as 3', () => {
    expect(item('Jacksonville', 'POSITION_GRADUATION').facts.count).toBe(3);
    expect(t).toContain('3 defenders in the graduating class');
  });

  it('states the projected starters as 2', () => {
    expect(item('Jacksonville', 'POSITION_GRADUATION_STARTERS').facts.starterCount).toBe(2);
    expect(t).toContain('2 projected defenders starting');
  });

  it('never substitutes the cliff aggregate for the graduating class', () => {
    expect(item('Jacksonville', 'ELIGIBILITY_CLIFF').facts.players).toBe(5);
    // The three forbidden sentences, verbatim and in the shapes they would
    // most plausibly take.
    for (const forbidden of ['5 defenders are leaving', '5 graduating defenders',
      '5 defenders in the graduating class', '5 defenders graduating']) {
      expect(t).not.toContain(forbidden);
    }
  });

  it('prints no combined departure total anywhere', () => {
    // 3+2, 3+5, 2+5 and 3+2+5. None of them is a number anybody computed.
    for (const sum of ['5 defenders', '7 defenders', '8 defenders', '10 defenders']) {
      expect(t).not.toContain(sum);
    }
  });

  it('does not claim the starters are a subset of the graduating group', () => {
    // They are, in all 247 real cases where both appear — but the API states
    // no relationship between the two kinds, and asserting one would be this
    // screen inferring it. Both name lists are shown instead.
    //
    // Asserted on the starters row alone. SQUAD_GRADUATION legitimately says
    // "N of them projected starters" about its OWN two facts, which is a
    // relationship the payload does state.
    const copy = rosterCopyFor(item('Jacksonville', 'POSITION_GRADUATION_STARTERS'));
    const line = `${copy.headline} ${copy.detail}`;
    expect(line).not.toMatch(/\b(of (them|those|that group)|among (them|that group))\b/i);
    expect(line).not.toContain('3');
  });

  it('shows both name lists so the overlap is visible without being asserted', () => {
    expect(t).toContain('Nahne Paulsen, Simon Libert, Nassim Akki');
    expect(t).toContain('Nahne Paulsen, Simon Libert');
  });
});

describe('the eligibility cliff is a timeline, not a headline number', () => {
  const cliff = item('Jacksonville', 'ELIGIBILITY_CLIFF');
  const copy = rosterCopyFor(cliff);
  const t = text(render('Jacksonville'));

  it('spans two years in the fixture', () => {
    expect(cliff.facts.byYear.filter((y) => y.players > 0).map((y) => y.year)).toEqual([2026, 2027]);
  });

  it('leads with the horizon rather than the total', () => {
    expect(copy.headline).toContain('2026');
    expect(copy.headline).toContain('2027');
    // The aggregate does not lead. It counts a population that overlaps the
    // graduating class above it, and "5" beside "3" invites a substitution.
    expect(copy.headline).not.toContain('5');
  });

  it('renders a row per year with its own count and minutes', () => {
    expect(copy.timeline).toEqual([
      { label: '2026', value: '3 defenders · 2,243 projected minutes' },
      { label: '2027', value: '2 defenders · 871 projected minutes' },
    ]);
    expect(t).toContain('2026');
    expect(t).toContain('2,243 projected minutes');
    expect(t).toContain('871 projected minutes');
  });

  it('says the cliff and the graduating class can name the same player', () => {
    expect(t).toContain('the same player can appear in both');
  });

  it('renders a single-year cliff directly, with no timeline', () => {
    const single = rosterCopyFor({
      kind: 'ELIGIBILITY_CLIFF',
      facts: {
        position: 'DEFENSE', players: 1, projectedMinutes: 1042, beforeClassYear: 2027,
        byYear: [{ year: 2026, minutes: 0, players: 0 }, { year: 2027, minutes: 1042, players: 1 }],
      },
    });
    expect(single.timeline).toBeNull();
    expect(single.headline).toBe('1 defender reaching the end of eligibility');
  });

  it('invents no year that has nobody in it', () => {
    // The 2026 row above carries zero players and is dropped. A row reading
    // "2026 — 0 players" is padding, not a finding.
    const withEmpty = rosterCopyFor({
      kind: 'ELIGIBILITY_CLIFF',
      facts: {
        position: 'DEFENSE', players: 4, projectedMinutes: 900, beforeClassYear: 2028,
        byYear: [{ year: 2026, minutes: 0, players: 0 }, { year: 2027, minutes: 500, players: 2 },
          { year: 2028, minutes: 400, players: 2 }],
      },
    });
    expect(withEmpty.timeline.map((r) => r.label)).toEqual(['2027', '2028']);
  });
});

describe('a projected starter is never shown as an observed one', () => {
  it('is the only basis the generators produce', () => {
    expect(item('Jacksonville', 'POSITION_GRADUATION_STARTERS').facts.basis).toBe('projected');
  });

  it('says "projected" in the headline and explains it below', () => {
    const t = text(render('Jacksonville'));
    expect(t).toContain('2 projected defenders starting');
    expect(t).toContain('projected from current minutes, not an observed line-up');
  });

  it('refuses a basis it has never seen rather than implying certainty', () => {
    expect(rosterCopyFor({
      kind: 'POSITION_GRADUATION_STARTERS',
      facts: { position: 'DEFENSE', starterCount: 2, names: ['A'], basis: 'observed' },
    })).toBeNull();
  });
});

describe('scarcity, depth and group size are independent measurements', () => {
  const t = text(render('St. Thomas'));

  it('renders scarcity as the share, from its own facts', () => {
    const f = item('St. Thomas', 'POSITION_GROUP_SCARCITY').facts;
    // The server's own share, not a division performed here.
    expect(t).toContain(`${f.count} defenders — ${Math.round(f.share * 100)}% of the squad`);
  });

  it('prints only one squad total, from the kind that owns it', () => {
    // Both kinds carry a field called `squadSize` and they disagree at 47 of
    // 228 real programmes — Eastern Oregon reports 23 against 32, because one
    // counts players whose position parsed and the other counts every roster
    // row. Two "squad of N" lines a line apart would read as a bug. Built from
    // Eastern Oregon's real figures, since St. Thomas happens to agree.
    const html = renderToStaticMarkup(createElement(RosterOpportunity, {
      items: [
        { kind: 'POSITION_GROUP_SCARCITY', qualification: {},
          facts: { position: 'DEFENSE', count: 1, squadSize: 23, share: 0.04 } },
        { kind: 'POSITION_GROUP_SIZE', qualification: {},
          facts: { position: 'DEFENSE', count: 1, squadSize: 32 } },
      ],
    }));
    const rendered = text(html);
    expect(rendered).toContain('In a squad of 32.');
    expect(rendered).not.toContain('squad of 23');
    // The scarcity denominator still reaches the operator, as the share it
    // exists to express.
    expect(rendered).toContain('4% of the squad');
  });

  it('renders returning depth from its own facts', () => {
    const f = item('St. Thomas', 'RETURNING_POSITION_DEPTH').facts;
    expect(t).toContain(`${f.returning} of ${f.groupSize} defenders returning`);
  });

  it('renders group size from its own facts', () => {
    const f = item('St. Thomas', 'POSITION_GROUP_SIZE').facts;
    expect(t).toContain(`${f.count} defenders on the current roster`);
  });

  it('combines none of them into a new figure', () => {
    // "only N spots available" and a turnover percentage are the two
    // temptations here, and both need arithmetic the backend never did.
    expect(t).not.toMatch(/spots? (available|open)/i);
    // A turnover RATE, not the word — the section intro uses "turnover"
    // descriptively, which states no figure.
    expect(t).not.toMatch(/\d+(\.\d+)?%\s*(roster\s*)?turnover|turnover rate/i);
  });

  it('renders no number that did not come from the payload', () => {
    // Stronger than forbidding particular sums, and the reason this section
    // exists to be trusted: every figure on screen has to trace to a fact the
    // server sent. A subtraction, a share computed here, or a total nobody
    // asked for would all show up as a number with no source.
    for (const name of Object.keys(ROSTER_FIXTURES)) {
      const items = roster(name);
      if (!items.length) continue;

      const allowed = new Set();
      const collect = (node) => {
        if (typeof node === 'number') {
          allowed.add(String(node));
          // A share the server computed, formatted as a percentage. Rounding
          // a given value is presentation; dividing two counts would not be.
          if (node > 0 && node < 1) allowed.add(String(Math.round(node * 100)));
        } else if (Array.isArray(node)) node.forEach(collect);
        else if (node && typeof node === 'object') Object.values(node).forEach(collect);
      };
      items.forEach((i) => collect(i.facts));
      // The season on the qualification line is also a real value.
      items.forEach((i) => { if (i.qualification?.season) allowed.add(String(i.qualification.season)); });

      const rendered = text(renderToStaticMarkup(createElement(RosterOpportunity, { items })));
      const numbers = (rendered.replace(/,/g, '').match(/\d+/g) ?? []);
      const unsourced = [...new Set(numbers)].filter((v) => !allowed.has(v));
      expect(unsourced, `${name} rendered numbers with no source`).toEqual([]);
    }
  });

  it('counts players with no eligibility on file neither way', () => {
    const copy = rosterCopyFor({
      kind: 'RETURNING_POSITION_DEPTH',
      facts: {
        position: 'DEFENSE', returning: 3, groupSize: 6, beforeClassYear: 2027,
        unknownEligibility: 2,
      },
    });
    expect(copy.detail).toContain('2 more with no eligibility on file');
  });

  it('says nothing about unknown eligibility when there is none', () => {
    expect(rosterCopyFor(item('St. Thomas', 'RETURNING_POSITION_DEPTH')).detail)
      .not.toContain('no eligibility on file');
  });
});

describe('squad-wide graduation stays subordinate', () => {
  const html = render('Jacksonville');
  const t = text(html);

  it('is the only roster kind whose facts name no position', () => {
    for (const i of roster('Jacksonville')) {
      const expected = i.kind === 'SQUAD_GRADUATION' ? 'programme' : 'position';
      expect(rosterCopyFor(i).scope).toBe(expected);
    }
  });

  it('sits under its own heading, below the position evidence', () => {
    expect(t).toContain('Across the whole squad');
    expect(t.indexOf('Across the whole squad'))
      .toBeGreaterThan(t.indexOf('3 defenders in the graduating class'));
  });

  it('never competes with the position group for the same words', () => {
    const f = item('Jacksonville', 'SQUAD_GRADUATION').facts;
    expect(t).toContain(`${f.total} players graduating squad-wide`);
    // It is not described as defenders, and its total is not offered as a
    // position figure.
    expect(t).not.toContain(`${f.total} defenders in the graduating class`);
  });
});

describe('the order is the server\'s', () => {
  it('renders position items in the order they arrived', () => {
    const t = text(render('Jacksonville'));
    const positions = roster('Jacksonville')
      .filter((i) => rosterCopyFor(i).scope === 'position')
      .map((i) => t.indexOf(rosterCopyFor(i).headline));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('does not re-rank a list handed to it in another order', () => {
    // Reversing the input reverses the output within each scope, so nothing
    // here is sorting — the only split is position versus programme-wide,
    // which is read off the facts.
    const reversed = [...roster('Jacksonville')].reverse();
    const t = text(renderToStaticMarkup(createElement(RosterOpportunity, { items: reversed })));
    const order = reversed
      .filter((i) => rosterCopyFor(i).scope === 'position')
      .map((i) => t.indexOf(rosterCopyFor(i).headline));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('an empty section is a gap, not a finding', () => {
  const html = render('Notre Dame');

  it('has no roster evidence in the fixture', () => {
    expect(roster('Notre Dame')).toEqual([]);
  });

  it('says what is missing without implying there is no opportunity', () => {
    expect(text(html)).toContain('No roster evidence on file');
    expect(text(html)).not.toMatch(/no roster opportunity/i);
    expect(text(html)).not.toMatch(/no opening/i);
  });

  it('still shows the section, so the operator can see it was looked at', () => {
    expect(text(html)).toContain('Current roster structure');
  });
});

describe('the section sits beneath Top Reasons and adds to them', () => {
  const full = renderToStaticMarkup(
    createElement(ProgrammeDecision, { model: ROSTER_FIXTURES.Jacksonville }),
  );
  const t = text(full);

  it('renders after the ranked reasons', () => {
    // Anchored on the section's own intro, not its heading: "Roster
    // opportunity" is also the class tag on every OPENING reason above, so
    // the heading alone cannot say which of the two was found.
    const section = t.indexOf('Current roster structure');
    expect(section).toBeGreaterThan(t.indexOf('reasons identified'));
    expect(section).toBeGreaterThan(t.indexOf('Recruitment pathway'));
    expect(section).toBeGreaterThan(t.indexOf('Results are trending upwards'));
  });

  it('keeps evidence that is also a top reason', () => {
    // Intentional. The reason is the decision; the section is the inspection,
    // and removing the repeat would make the section a lie about what we hold.
    const first = t.indexOf('3 defenders in the graduating class');
    const second = t.indexOf('3 defenders in the graduating class', first + 1);
    expect(second).toBeGreaterThan(first);
  });

  it('adds detail the summary line does not carry', () => {
    // The Top Reason states the count. The section adds the names, the years,
    // the minutes and the basis — otherwise the repetition would be noise.
    expect(t).toContain('2,243 projected minutes');
    expect(t).toContain('projected from current minutes');
    expect(t).toContain('2026 roster');
  });

  it('appears in the quiet states too', () => {
    const quiet = renderToStaticMarkup(
      createElement(ProgrammeDecision, { model: ROSTER_FIXTURES.Clemson }),
    );
    // "Nothing rose to a reason" and "we hold nothing about the roster" are
    // different statements, and an operator needs to see which applies.
    expect(text(quiet)).toContain('Current roster structure');
    expect(text(quiet)).toContain('defenders on the current roster');
  });

  it('renders no raw JSON or backend vocabulary', () => {
    expect(full).not.toContain('{"');
    expect(full).not.toContain('[object Object]');
    for (const leak of ['POSITION_GRADUATION', 'ELIGIBILITY_CLIFF', 'SQUAD_GRADUATION',
      'minConfidence', 'requiresWindow', 'requiresComparison', 'dedupeGroup', 'FACT', 'SIGNAL']) {
      expect(t).not.toContain(leak);
    }
  });
});

describe('qualification stays thin', () => {
  it('names the season the roster claim describes', () => {
    expect(text(render('Jacksonville'))).toContain('2026 roster');
  });

  it('shows no freshness line while the reading is current', () => {
    // Every roster item in the database reads CURRENT today, so this renders
    // nothing on real data. It exists so a stale roster announces itself.
    expect(text(render('Jacksonville'))).not.toMatch(/stale|out of date/i);
  });

  it('says so when a reading is not current', () => {
    const stale = JSON.parse(JSON.stringify(item('Jacksonville', 'POSITION_GRADUATION')));
    stale.qualification.freshness = { state: 'STALE', ageDays: 400, reason: 'roster last read in 2025' };
    const html = renderToStaticMarkup(createElement(RosterOpportunity, { items: [stale] }));
    expect(text(html)).toContain('roster last read in 2025');
  });
});
