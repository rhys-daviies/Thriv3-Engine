import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RecruitingSignals from './RecruitingSignals.jsx';
import { recruitingSignalCopyFor, COPY_KINDS } from '@/lib/recruitingSignalsCopy';
import { recruitingSignalsForCollege } from '@/lib/useMatchingSummary';
import { SIGNAL_FIXTURES, TWO_SIGNALS, SCARCITY, ZERO, UNAVAILABLE, UNRESOLVED, CURRENT, HISTORICAL, REGION_TWO_COUNTRIES, COACH_ARRIVAL, COACH_ARRIVAL_SINGLE } from '@/lib/__fixtures__/recruitingSignals.js';
import { LICENSED_KINDS } from '@shared/evidence/matchingSummary.js';

/**
 * The recruiting-signal panel on a match card.
 *
 * This surface's whole risk is that it sits beside a number. Three things
 * follow, and they are what this suite defends:
 *
 *   1. Nothing here may read as the score's cause, or as a score of its own.
 *   2. Every word and digit in a row must be traceable to ONE evidence
 *      object — the moment two rows combine, the card is making a claim
 *      nobody generated and nobody licensed.
 *   3. Zero signals is silence. It is the common case, and an empty state
 *      repeated down a page of twenty cards is noise, not information.
 *
 * The fixtures are real endpoint responses; see the note on the fixture file.
 */

const render = (signals) => renderToStaticMarkup(createElement(RecruitingSignals, { signals }));

const text = (html) => html
  .replace(/<[^>]+>/g, ' ')
  // Entities first: an apostrophe arrives as `&#x27;` and would otherwise
  // leave "27" behind for anything scanning the result for digits.
  .replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&#8211;/g, '–')
  .replace(/\s+/g, ' ').trim();

const rendered = (name) => text(render(recruitingSignalsForCollege(
  { X: SIGNAL_FIXTURES[name] }, 'X',
)));

const SOURCE = [
  readFileSync(new URL('./RecruitingSignals.jsx', import.meta.url), 'utf8'),
  readFileSync(new URL('../lib/recruitingSignalsCopy.js', import.meta.url), 'utf8'),
].join('\n');

/** Only the part of the source that can reach a screen: strings and JSX text. */
const CODE = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

// ---------------------------------------------------------------------------

describe('the licence and the words are kept in step', () => {
  it('has copy for every kind the read model licenses', () => {
    // A kind licensed on the server with no words here would render the amber
    // missing-copy line on a customer's card.
    for (const kind of LICENSED_KINDS) expect(COPY_KINDS).toContain(kind);
  });

  it('has copy for nothing else', () => {
    // Words for a denied kind are a licence granted in the client, where no
    // permission check can see it.
    for (const kind of COPY_KINDS) expect(LICENSED_KINDS).toContain(kind);
  });

  it('covers exactly the five', () => {
    expect(COPY_KINDS).toHaveLength(5);
  });

  it('has no words for the kind the score already counts', () => {
    // CURRENT_SAME_COUNTRY was licensed here until the final Stage F audit
    // found that `internationalFit` scores the same compatriots off the same
    // 2026 roster. Words for it in this file would be a licence granted in the
    // client, where no permission check can see it.
    expect(COPY_KINDS).not.toContain('CURRENT_SAME_COUNTRY');
    expect(recruitingSignalCopyFor({
      kind: 'CURRENT_SAME_COUNTRY',
      facts: { country: 'New Zealand', count: 2, names: ['A', 'B'] },
    })).toBeNull();
  });

  it('says so visibly rather than inventing prose for an unknown kind', () => {
    const html = render({ facts: [{ kind: 'POSITION_GRADUATION', facts: { count: 4 } }] });
    expect(text(html)).toContain('No signal wording for POSITION_GRADUATION yet');
    // And nothing assembled out of whatever keys happened to be present.
    expect(text(html)).not.toContain('4');
  });

  it('returns null rather than a half sentence when a fact is missing', () => {
    expect(recruitingSignalCopyFor({ kind: 'COACH_ARRIVAL_SAME_COUNTRY', facts: { country: 'New Zealand' } })).toBeNull();
    expect(recruitingSignalCopyFor({ kind: 'ARRIVAL_SAME_COUNTRY_POSITION', facts: { country: 'New Zealand', count: 2 } })).toBeNull();
    expect(recruitingSignalCopyFor({ kind: 'ARRIVAL_SAME_REGION_POSITION', facts: { position: 'DEFENSE', count: 1, countries: [] } })).toBeNull();
    expect(recruitingSignalCopyFor({ kind: 'POSITION_GROUP_SCARCITY', facts: { position: 'DEFENSE' } })).toBeNull();
    expect(recruitingSignalCopyFor({ kind: 'CURRENT_SAME_COUNTRY', facts: { count: 2 } })).toBeNull();
  });
});

describe('coach arrival — a record, never a forecast', () => {
  it('names the coach, the country and the count, in the past', () => {
    expect(rendered('COACH_ARRIVAL')).toContain(
      'Jamie Franks has previously recruited 2 players from New Zealand.',
    );
  });

  it('agrees its verb with a count of one', () => {
    expect(rendered('COACH_ARRIVAL_SINGLE')).toContain(
      'Ali Simmons has previously recruited 1 player from New Zealand.',
    );
  });

  it('spans the seasons it was given without counting them', () => {
    expect(rendered('COACH_ARRIVAL')).toContain('Arriving 2024–2026');
    expect(rendered('COACH_ARRIVAL_SINGLE')).toContain('Arriving 2025');
  });

  it('never says the programme recruits, targets, prefers or needs anything', () => {
    for (const name of ['COACH_ARRIVAL', 'COACH_ARRIVAL_SINGLE']) {
      const out = rendered(name);
      expect(out).not.toMatch(/\brecruits\b/);
      expect(out).not.toMatch(/\btargets?\b/);
      expect(out).not.toMatch(/\bprefers?\b/i);
      expect(out).not.toMatch(/\bneeds?\b/);
      expect(out).not.toMatch(/\bwill\b/);
      expect(out).not.toMatch(/\blook(s|ing)? for\b/);
    }
  });

  it('never names a position on a coach arrival', () => {
    // The generator records one only when every attributable arrival shared
    // it — 42 of 177 real items — so naming it would make our record-keeping
    // look like a difference between programmes. The read model does not send
    // it; the copy does not read it either.
    const html = render({
      facts: [{
        kind: 'COACH_ARRIVAL_SAME_COUNTRY',
        facts: { coach: 'Jamie Franks', country: 'New Zealand', count: 2, position: 'DEFENSE', seasons: [] },
      }],
    });
    expect(text(html)).not.toMatch(/defender|defence|defense/i);
  });
});

describe('country + position arrival — the concrete observation', () => {
  it('states what was recruited, from where, in the past', () => {
    expect(rendered('TWO_SIGNALS')).toContain(
      'Has previously recruited 1 defender from New Zealand.',
    );
  });

  it('pluralises the position against this object’s own count', () => {
    const out = text(render({
      facts: [{
        kind: 'ARRIVAL_SAME_COUNTRY_POSITION',
        facts: { country: 'Ireland', position: 'MIDFIELD', count: 3, seasons: ['2021', '2024'] },
      }],
    }));
    expect(out).toContain('Has previously recruited 3 midfielders from Ireland.');
    expect(out).toContain('Arriving 2021–2024');
  });

  it('attributes nothing to a coach', () => {
    // This object counts the programme's arrivals across whoever was in
    // charge. A coach name here could only have come from another object.
    const out = rendered('TWO_SIGNALS');
    expect(out).not.toMatch(/coach|under /i);
  });

  it('never renders the position key', () => {
    for (const name of Object.keys(SIGNAL_FIXTURES)) {
      expect(rendered(name)).not.toMatch(/DEFENSE|MIDFIELD|FORWARD|GOALKEEPER|UNKNOWN/);
    }
  });
});

describe('region + position — countries, never the bucket', () => {
  it('names the country it was cut from', () => {
    expect(rendered('REGION')).toContain('Has previously recruited 1 defender from Australia.');
  });

  it('lists several countries without totalling them', () => {
    const out = rendered('REGION_TWO_COUNTRIES');
    expect(out).toContain('Has previously recruited 3 midfielders from Australia and Fiji.');
  });

  it('says the cut is wider than the athlete’s own country', () => {
    // Without this a reader who knows the athlete is a New Zealander reads a
    // row about Australia as a row about them.
    expect(rendered('REGION')).toContain('wider region, not their own country');
  });

  it('never prints a region key, on any fixture', () => {
    for (const name of Object.keys(SIGNAL_FIXTURES)) {
      expect(rendered(name)).not.toMatch(/OCEANIA|EUROPE|AFRICA|ASIA|AMERICAS|NORTH_AMERICA|SOUTH_AMERICA/);
    }
  });

  it('has no way to reach a region key', () => {
    // The projection does not send one, and nothing here reads `region`.
    expect(CODE).not.toMatch(/\bregion\b\s*[.:[]/);
    expect(CODE).not.toMatch(/f\.region/);
  });
});

describe('tense is the qualification, and it is visible', () => {
  it('keeps an earlier roster in the past', () => {
    expect(rendered('HISTORICAL')).toContain(
      '2 New Zealand players have appeared on earlier rosters.',
    );
    expect(rendered('HISTORICAL')).toContain('Present in 2022, 2023, 2025 and 2026');
  });

  it('will not render a current-squad headcount even if one arrives', () => {
    /**
     * A payload the server cannot produce, rendered anyway.
     *
     * CURRENT_SAME_COUNTRY is DENIED for this surface — the read model drops
     * it, the route asserts it never appears — so this fixture is a shape that
     * should be unreachable. The component still has to fail closed on it,
     * because "the server would never send that" is exactly the assumption
     * that makes a client leak invisible when it stops being true.
     */
    const out = rendered('CURRENT');
    expect(out).toContain('No signal wording for CURRENT_SAME_COUNTRY yet');
    // No sentence assembled out of the facts it carries.
    expect(out).not.toContain('New Zealand');
    expect(out).not.toContain('current squad');
    expect(out).not.toContain('Kaspar');
  });

  it('never merges a past and a present claim into a habit', () => {
    // The two same-country kinds share a dedupe group and cannot co-occur, but
    // the phrasing must not invite the reading even alone.
    for (const name of Object.keys(SIGNAL_FIXTURES)) {
      const out = rendered(name);
      expect(out).not.toMatch(/regularly|routinely|a history of|tends to|track record/i);
    }
  });
});

describe('scarcity — the safety case', () => {
  it('states the classification and the count', () => {
    expect(rendered('SCARCITY')).toContain('Thin at defender on the current roster.');
    expect(rendered('SCARCITY')).toContain('5 defenders in the squad now.');
  });

  it('never renders the share, as a percentage or otherwise', () => {
    // Duke's share is 0.18 against a count of 5. Rendering both hands back the
    // `classifiedSquad` figure the read model withheld — 28 — which is the one
    // that disagrees with POSITION_GROUP_SIZE at 47 of 228 programmes.
    const out = rendered('SCARCITY');
    expect(out).not.toContain('18%');
    expect(out).not.toContain('0.18');
    expect(out).not.toContain('%');
    expect(out).not.toContain('28');
  });

  it('never reads `share` at all', () => {
    expect(CODE).not.toMatch(/f\.share/);
    expect(CODE).not.toMatch(/\bshare\b\s*[*/]/);
  });

  it('has no arithmetic anywhere in the copy', () => {
    // Every digit rendered is a value the server sent. Nothing is derived, so
    // there is nothing to derive it with.
    expect(CODE).not.toMatch(/[^/*]\*\s*100/);
    expect(CODE).not.toMatch(/Math\.round\(/);
    expect(CODE).not.toMatch(/toFixed\(/);
    expect(CODE).not.toMatch(/\breduce\(/);
  });

  it('never mentions squad size, an opening or an opportunity', () => {
    const out = rendered('SCARCITY');
    expect(out).not.toMatch(/squad of|out of|roster of \d/);
    expect(out).not.toMatch(/opening|opportunit|spot|place available|minutes/i);
  });

  it('every digit it prints is on its own evidence object', () => {
    const facts = SCARCITY.facts[0].facts;
    const digits = rendered('SCARCITY').match(/\d+/g) ?? [];
    for (const d of digits) expect(String(facts.count)).toBe(d);
  });
});

describe('nothing on this surface is a score', () => {
  it('prints no percentage, ratio or grade on any fixture', () => {
    for (const name of Object.keys(SIGNAL_FIXTURES)) {
      const out = rendered(name);
      expect(out).not.toContain('%');
      expect(out).not.toMatch(/\d\s*\/\s*\d/);
      expect(out).not.toMatch(/\b(strong|weak|high|low|medium)\b/i);
    }
  });

  it('names no score concept in the source', () => {
    for (const word of ['likelihood', 'probability', 'confidence', 'strength',
      'signalScore', 'evidenceScore', 'match_score', 'weight', 'contribution',
      'criterion', 'breakdown', 'polarity', 'decisionClass', 'tier']) {
      expect(CODE).not.toContain(word);
    }
  });

  it('says out loud that it is not part of the score', () => {
    expect(rendered('TWO_SIGNALS'))
      .toContain('Independent evidence, not used in the match score above.');
  });

  it('does not claim everything here is history, because one kind is not', () => {
    /**
     * POSITION_GROUP_SCARCITY carries CURRENT temporality and describes the
     * roster as it stands. The boundary line used to read "Observed history",
     * which was false for it — and false in the direction that matters, since
     * the sentence's whole job is to be exactly true. The claim it makes now
     * is about the SCORE, which holds for all five: none of their measurements
     * is among the inputs `score.js` passes to a criterion.
     */
    expect(LICENSED_KINDS).toContain('POSITION_GROUP_SCARCITY');
    expect(SCARCITY.facts[0].qualification.temporality).toBe('CURRENT');
    const out = rendered('SCARCITY');
    expect(out).not.toMatch(/observed history/i);
    expect(out).toContain('Independent evidence, not used in the match score above.');
  });

  it('renders no bar, meter or coloured verdict', () => {
    const html = render(recruitingSignalsForCollege({ X: TWO_SIGNALS }, 'X'));
    expect(html).not.toContain('style=');
    expect(html).not.toMatch(/rounded-full/);          // the criterion-bar shape
    expect(html).not.toMatch(/bg-(primary|emerald|green|red|amber)/);
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain('role="progressbar"');
  });
});

describe('one row, one evidence object', () => {
  it('renders two signals as two independent rows', () => {
    const html = render(recruitingSignalsForCollege({ X: TWO_SIGNALS }, 'X'));
    const rows = html.match(/<li[^>]*>[\s\S]*?<\/li>/g) ?? [];
    expect(rows).toHaveLength(2);
    // The coach-free arrival row and the roster row say nothing about each
    // other: no row mentions both a country and a squad count.
    for (const row of rows) {
      const t = text(row);
      expect(t.includes('New Zealand') && t.includes('squad now')).toBe(false);
    }
  });

  it('never joins a recruiting history and a roster observation into one sentence', () => {
    // Asserted per SENTENCE, not over the flattened panel. Two adjacent rows
    // put "from New Zealand." and "Thin at defender" a few characters apart in
    // flat text, and a proximity test over that would be testing the absence
    // of a space rather than the absence of a claim.
    const html = render(recruitingSignalsForCollege({ X: TWO_SIGNALS }, 'X'));
    const sentences = text(html).split(/(?<=\.)\s+/);
    for (const s of sentences) {
      expect(s.includes('New Zealand') && /thin|squad now/i.test(s)).toBe(false);
    }
    expect(text(html)).not.toMatch(/New Zealand defenders? and/);
    // The two counts stay in their own sentences: "1 defender" from the
    // arrival, "3 defenders" from the roster, never summed or compared.
    expect(text(html)).not.toContain('4');
  });

  it('renders the facts in the order the server chose', () => {
    const html = render(recruitingSignalsForCollege({ X: TWO_SIGNALS }, 'X'));
    const arrival = html.indexOf('previously recruited');
    const scarcity = html.indexOf('Thin at');
    expect(arrival).toBeGreaterThan(-1);
    expect(scarcity).toBeGreaterThan(arrival);
  });

  it('does not sort, reverse or rank in the component', () => {
    // Scoped to the COMPONENT. The copy registry sorts the seasons inside one
    // object to find a span, which is formatting a single fact and not
    // ordering the facts against each other — the thing this forbids.
    const jsx = readFileSync(new URL('./RecruitingSignals.jsx', import.meta.url), 'utf8');
    expect(jsx).not.toMatch(/\.sort\(/);
    expect(jsx).not.toMatch(/\.reverse\(/);
    expect(jsx).not.toMatch(/\.filter\(/);
    expect(jsx).not.toMatch(/\.slice\(/);
  });
});

describe('empty, unavailable and unresolved are three different things', () => {
  it('renders nothing at all for zero signals', () => {
    expect(render(recruitingSignalsForCollege({ X: ZERO }, 'X'))).toBe('');
  });

  it('renders no heading, box or placeholder for zero signals', () => {
    const html = render(recruitingSignalsForCollege({ X: ZERO }, 'X'));
    expect(html).not.toContain('Recruiting signals');
    expect(html).not.toMatch(/No recruiting signals/i);
    expect(html).not.toContain('<section');
  });

  it('says so quietly when the server could not read one programme', () => {
    const html = render(recruitingSignalsForCollege({ X: UNAVAILABLE }, 'X'));
    expect(text(html)).toBe('Recruiting signals unavailable.');
    // Not a panel, not a heading, not an alarm.
    expect(html).not.toContain('<section');
    expect(html).not.toMatch(/border|rounded|bg-/);
  });

  it('never exposes the server’s error text', () => {
    const html = render(recruitingSignalsForCollege({ X: { unavailable: 'SqliteError: no such column' } }, 'X'));
    expect(html).not.toContain('Sqlite');
    expect(html).not.toContain('no such column');
  });

  it('does not claim the programme is unknown when the request failed', () => {
    const out = text(render(recruitingSignalsForCollege({ X: UNAVAILABLE }, 'X')));
    expect(out).not.toMatch(/unknown|unresolved|not found|no evidence|no signals/i);
  });

  it('renders nothing, and no badge, for an unresolved name', () => {
    expect(render(recruitingSignalsForCollege({ X: UNRESOLVED }, 'X'))).toBe('');
  });

  it('renders nothing before an answer arrives', () => {
    expect(render(recruitingSignalsForCollege(null, 'X'))).toBe('');
    expect(render(recruitingSignalsForCollege({}, 'X'))).toBe('');
  });
});

describe('the prop the card is handed', () => {
  it('carries facts and nothing else on a success', () => {
    expect(Object.keys(recruitingSignalsForCollege({ X: TWO_SIGNALS }, 'X'))).toEqual(['facts']);
  });

  it('carries no score, no permissions and no registry metadata', () => {
    const signals = recruitingSignalsForCollege({ X: TWO_SIGNALS }, 'X');
    const json = JSON.stringify(signals);
    for (const word of ['match_score', 'breakdown', 'weight', 'contribution',
      'permissions', 'tier', 'polarity', 'decisionClass', 'strength',
      'dedupeGroup', 'hasEvidence', 'resolved']) {
      expect(json).not.toContain(word);
    }
  });

  it('marks a failure without carrying its cause', () => {
    expect(recruitingSignalsForCollege({ X: UNAVAILABLE }, 'X')).toEqual({ unavailable: true });
  });
});

describe('accessibility', () => {
  it('names the region it renders', () => {
    const html = render(recruitingSignalsForCollege({ X: TWO_SIGNALS }, 'X'));
    expect(html).toContain('<section aria-label="Recruiting signals">');
  });

  it('renders the signals as a list', () => {
    const html = render(recruitingSignalsForCollege({ X: TWO_SIGNALS }, 'X'));
    expect(html).toContain('<ul');
    expect((html.match(/<li/g) ?? [])).toHaveLength(2);
  });

  it('carries no meaning in colour alone', () => {
    // The only coloured text is the amber missing-copy line, which says what
    // it means in words.
    for (const name of Object.keys(SIGNAL_FIXTURES)) {
      const html = render(recruitingSignalsForCollege({ X: SIGNAL_FIXTURES[name] }, 'X'));
      expect(html).not.toMatch(/text-(emerald|green|red)-/);
    }
  });

  it('has no click handler and no interactive div', () => {
    expect(CODE).not.toContain('onClick');
    expect(CODE).not.toContain('cursor-pointer');
  });

  it('keeps the unavailable line at readable muted weight, not a faint one', () => {
    const html = render(recruitingSignalsForCollege({ X: UNAVAILABLE }, 'X'));
    expect(html).toContain('text-muted-foreground');
    expect(html).not.toMatch(/opacity-[1-5]0/);
  });
});

describe('density', () => {
  it('adds at most a few short lines to a card', () => {
    for (const name of Object.keys(SIGNAL_FIXTURES)) {
      const out = rendered(name);
      // Two signals plus the boundary line. Nothing here is a paragraph.
      expect(out.length).toBeLessThan(340);
    }
  });

  it('nests no card inside the card', () => {
    for (const name of Object.keys(SIGNAL_FIXTURES)) {
      const html = render(recruitingSignalsForCollege({ X: SIGNAL_FIXTURES[name] }, 'X'));
      expect(html).not.toMatch(/rounded-(lg|xl)|shadow|border border-border/);
    }
  });

  it('lets long copy wrap rather than forcing a width', () => {
    const html = render(recruitingSignalsForCollege({ X: REGION_TWO_COUNTRIES }, 'X'));
    expect(html).not.toMatch(/w-\d+|whitespace-nowrap|truncate/);
  });
});
