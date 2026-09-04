import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ProgrammeDecision from './ProgrammeDecision.jsx';
import TopReasons from './TopReasons.jsx';
import { FIXTURES } from '@/lib/__fixtures__/operatorEvidence.js';
import { operatorCopyFor } from '@/lib/operatorEvidenceCopy';

/**
 * The decision surface, rendered against real payloads.
 *
 * `renderToStaticMarkup` rather than a testing library, which is not a
 * dependency here — the same choice `evidenceCard.test.js` makes, and enough
 * for a component with no interaction yet.
 *
 * The six fixtures are the six states this surface exists to tell apart, and
 * every one of them is a real programme in the production database. The
 * distinction that matters most is the last one: a name we could not resolve
 * must never render as an assessment that found nothing.
 */

const render = (props) => renderToStaticMarkup(createElement(ProgrammeDecision, props));
const of = (name) => render({ model: FIXTURES[name] });

/** Markup with tags stripped, for asserting on what a person would read. */
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('a programme with reasons', () => {
  const html = of('Jacksonville');

  it('reports how many reasons were identified', () => {
    expect(FIXTURES.Jacksonville.summary.reasonCount).toBe(4);
    expect(text(html)).toContain('4 reasons identified');
  });

  it('says a positional opening was identified', () => {
    expect(text(html)).toContain('Positional opening identified');
  });

  it('leads with the roster opening the server ranked first', () => {
    expect(text(html)).toContain('3 defenders in the graduating class');
  });

  it('carries no scoring, no counts of what was withheld, no enum names', () => {
    const t = text(html);
    for (const leak of ['generatedCount', 'evidenceCount', 'dedupeGroup', 'CATEGORY_CAP',
      'POSITION_GRADUATION', 'OPENING', 'PATHWAY', 'FACT', 'SIGNAL', 'HIGH', 'MEDIUM']) {
      expect(t).not.toContain(leak);
    }
  });

  it('renders no raw JSON', () => {
    expect(html).not.toContain('{"');
    expect(html).not.toContain('[object Object]');
  });
});

describe('a programme with one reason and no opening', () => {
  const html = of('George Mason');

  it('uses the singular', () => {
    expect(FIXTURES['George Mason'].summary.reasonCount).toBe(1);
    expect(text(html)).toContain('1 reason identified');
  });

  it('says an opening was NOT IDENTIFIED rather than that none exists', () => {
    // The difference between what we found and what is true. A roster we
    // cannot read has no opening we can see, and "No positional opening"
    // would report our own blind spot as a fact about their squad.
    expect(text(html)).toContain('No positional opening identified');
    expect(FIXTURES['George Mason'].summary.openingIdentified).toBe(false);
  });
});

describe('a resolved programme with evidence but no reasons', () => {
  for (const name of ['Hamilton (Ryan)', 'Carleton (Ryan)']) {
    const model = FIXTURES[name];
    const html = render({ model });

    it(`${name}: does not also print a redundant "0 reasons identified"`, () => {
      expect(text(html)).not.toContain('0 reasons identified');
      // The opening indicator still shows: it answers a different question.
      expect(text(html)).toContain('No positional opening identified');
    });

    it(`${name}: says plainly that none was identified`, () => {
      expect(model.programme.resolved).toBe(true);
      expect(model.summary.reasonCount).toBe(0);
      expect(model.summary.hasEvidence).toBe(true);
      expect(text(html)).toContain('No positive reasons identified');
    });

    it(`${name}: says we hold evidence that did not rise to a reason`, () => {
      expect(text(html)).toContain('none of it argues for acting');
    });

    it(`${name}: promises no navigation that does not exist yet`, () => {
      // No link anywhere: the zero state must not point at a page that does
      // not exist. Buttons are a different matter now — each evidence row
      // carries a provenance disclosure — so the assertion is that the ZERO
      // STATE itself offers no way out, not that the payload has no controls.
      expect(html).not.toContain('<a ');
      const zeroState = text(html).slice(text(html).indexOf('No positive reasons identified'));
      expect(zeroState).not.toMatch(/see |view |open |click/i);
    });
  }
});

describe('a resolved programme we hold almost nothing on', () => {
  const model = FIXTURES.Bethesda;
  const html = render({ model });

  it('is still resolved, and still says no reasons were identified', () => {
    expect(model.programme.resolved).toBe(true);
    expect(model.summary.hasEvidence).toBe(false);
    expect(text(html)).toContain('No positive reasons identified');
  });

  it('is worded differently from a programme we hold evidence on', () => {
    expect(text(html)).toContain('We hold almost nothing');
    expect(text(html)).not.toContain('none of it argues for acting');
  });

  it('frames the absence as our gap, not as a mark against the programme', () => {
    expect(text(html)).toContain('not a judgement about the');
  });
});

describe('a name that did not resolve to a programme', () => {
  const model = FIXTURES['Nowhere At All'];
  const html = render({ model });

  it('reads the resolution state rather than the evidence count', () => {
    expect(model.programme.resolved).toBe(false);
    // Identical evidence fields to Bethesda above. Only `resolved` differs,
    // and the two must not read the same.
    expect(model.summary).toEqual(FIXTURES.Bethesda.summary);
  });

  it('does NOT use the zero-reason presentation', () => {
    // The whole point of the backend field. Saying "no positive reasons
    // identified" here would report a lookup miss as an assessment.
    expect(text(html)).not.toContain('No positive reasons identified');
    expect(text(html)).not.toContain('reasons identified');
  });

  it('says the evidence is unavailable and why', () => {
    expect(text(html)).toContain('Programme evidence unavailable');
    expect(text(html)).toContain('could not match this name');
  });

  it('does not imply the programme does not exist', () => {
    const t = text(html).toLowerCase();
    for (const wrong of ['does not exist', "doesn't exist", 'no such programme', 'invalid']) {
      expect(t).not.toContain(wrong);
    }
    expect(t).toContain('gap on our side');
  });
});

describe('loading and failure are not findings', () => {
  it('says it is still reading', () => {
    expect(text(render({ model: null, loading: true }))).toContain('Reading what we hold');
  });

  it('keeps a request failure apart from every zero state', () => {
    const html = render({ model: null, failed: true });
    expect(text(html)).toContain('problem at our end');
    expect(text(html)).not.toContain('No positive reasons identified');
    expect(text(html)).not.toContain('Programme evidence unavailable');
  });

  it('renders nothing at all before the first response', () => {
    expect(render({ model: null })).toBe('');
  });
});

describe('the ranked list', () => {
  const reasons = FIXTURES.Jacksonville.topReasons;
  const html = renderToStaticMarkup(createElement(TopReasons, { reasons }));

  it('is an ordered list, not a set of cards', () => {
    expect(html).toContain('<ol');
  });

  it('keeps the API\'s order and does not re-rank', () => {
    const t = text(html);
    // Where each reason's own headline lands in the rendered text, in the
    // order the server sent them. Strictly increasing means nothing re-sorted.
    const at = reasons.map((r) => t.indexOf(operatorCopyFor(r.primary, 'primary').conclusion));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);

    // And reversing the input reverses the output, so this is the array's
    // order rather than an ordering the component agrees with by coincidence.
    const rt = text(renderToStaticMarkup(
      createElement(TopReasons, { reasons: [...reasons].reverse() }),
    ));
    const rAt = [...reasons].reverse().map((r) => rt.indexOf(operatorCopyFor(r.primary, 'primary').conclusion));
    expect([...rAt].sort((a, b) => a - b)).toEqual(rAt);
  });

  it('gives a rank to each reason and to nothing else', () => {
    // Four reasons and four supporting items beneath them. Only the reasons
    // take a number, or the grouping would be undone by the numbering.
    const supporting = reasons.reduce((n2, r) => n2 + r.supporting.length, 0);
    expect(supporting).toBe(4);
    const ranks = html.match(/aria-hidden="true"[^>]*>\d+</g) ?? [];
    expect(ranks).toHaveLength(reasons.length);
  });

  it('reads the Jacksonville roster group as ONE reason', () => {
    const group = reasons[0];
    expect(group.supporting.map((s) => s.kind)).toEqual([
      'POSITION_GRADUATION_STARTERS', 'ELIGIBILITY_CLIFF',
    ]);
    const t = text(html);
    // The primary, then both supporting lines, in one block.
    expect(t).toContain('3 defenders in the graduating class');
    expect(t).toContain('2 projected defenders starting: Nahne Paulsen and Simon Libert.');
    expect(t).toContain('Eligibility pressure continues into 2027');
  });

  it('never prints a combined departure count', () => {
    const t = text(html);
    // 3 graduating, 2 projected starters, 5 across the cliff — no sum of those
    // is a number anybody computed.
    for (const forbidden of ['5 defenders', '7 defenders', '8 defenders', '10 defenders']) {
      expect(t).not.toContain(forbidden);
    }
  });

  it('keeps pathway support beside its primary rather than merged into it', () => {
    const pathway = reasons[1];
    expect(pathway.primary.kind).toBe('COACH_ARRIVAL_SAME_COUNTRY');
    const t = text(html);
    expect(t).toContain('This coach has recruited from New Zealand');
    // The coach's name never attaches to the region-position support.
    expect(t).not.toMatch(/Bobby Muuss[^.]*defender/i);
  });

  it('tags a reason with an operator label, not the backend enum', () => {
    const t = text(html);
    expect(t).toContain('Roster opportunity');
    expect(t).toContain('Recruitment pathway');
    expect(t).toContain('Programme fit');
    expect(t).not.toContain('OPENING');
    expect(t).not.toContain('PATHWAY');
  });

  it('shows a kind it has no words for rather than dropping it', () => {
    const unknown = [{
      dedupeGroup: 'x', decisionClass: 'FIT', category: 'c', section: 'PROGRAMME_CONTEXT',
      primary: { kind: 'SOME_FUTURE_KIND', facts: {} }, supporting: [],
    }];
    const t = text(renderToStaticMarkup(createElement(TopReasons, { reasons: unknown })));
    // A reason silently dropped is a reason the operator never learns we had,
    // and the gap would look exactly like the programme not having one.
    expect(t).toContain('No operator wording');
    expect(t).toContain('SOME_FUTURE_KIND');
  });
});
