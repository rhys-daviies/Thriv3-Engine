import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ProgrammeContext from './ProgrammeContext.jsx';
import ProgrammeDecision from './ProgrammeDecision.jsx';
import { contextCopyFor, contextWindow, CONTEXT_COPY_KINDS } from '@/lib/contextEvidenceCopy';
import { CONTEXT_FIXTURES } from '@/lib/__fixtures__/contextEvidence.js';
import { PATHWAY_FIXTURES } from '@/lib/__fixtures__/pathwayEvidence.js';
import { SECTION_OF, SECTIONS } from '@shared/evidence/operatorEvidence.js';
import { provenanceRows } from '@/lib/evidenceProvenance';

/**
 * The programme-context section, against six real programmes.
 *
 * One rule dominates and it comes from a real error. `windowBounded` says that
 * `since` is the earliest season we looked at rather than the year the coach
 * was appointed — Notre Dame's 2022 and 2023 staff pages were both unreadable,
 * the segment began at 2024, and the evidence read "two seasons into the job"
 * about a man who had held it since 2018. 1,341 of 2,088 real items are
 * bounded, so the branch that must not print a year is the majority one.
 *
 * The second theme is that this section stays out of the way: it is context,
 * not a reason, and it must not join up with the coach-attributed arrivals in
 * the pathway section to make a claim neither object supports.
 */

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const context = (name) => CONTEXT_FIXTURES[name].sections.PROGRAMME_CONTEXT;
const render = (name) => renderToStaticMarkup(
  createElement(ProgrammeContext, { items: context(name) }),
);
const coach = (name) => context(name).find((i) => i.kind === 'COACH_CONTEXT');

/** Anything that would turn a coaching record into a recommendation. */
const FORBIDDEN = [
  /\bstable\b/i, /\bunstable\b/i, /\bstability\b/i, /\bturmoil\b/i, /\bupheaval\b/i,
  /\brebuild/i, /\bfresh start\b/i, /\bopportunity\b/i, /\blikely\b/i, /\bprefers\b/i,
  /\bexperienced\b/i, /\bwell-established\b/i, /\bsettled\b/i, /\bproven\b/i,
  /\brespected\b/i, /\bgood fit\b/i, /\breceptive\b/i, /\bopen to\b/i,
  /\bworth (writing|contacting)\b/i, /\bwill (recruit|take|sign)\b/i,
];

describe('the one kind here can be presented', () => {
  it('is the only kind filed into this section', () => {
    const filed = Object.entries(SECTION_OF)
      .filter(([, section]) => section === SECTIONS.PROGRAMME_CONTEXT)
      .map(([kind]) => kind);
    expect(filed).toEqual(['COACH_CONTEXT']);
    expect(CONTEXT_COPY_KINDS).toEqual(['COACH_CONTEXT']);
  });

  it('presents every item in every fixture', () => {
    const missing = [];
    for (const name of Object.keys(CONTEXT_FIXTURES)) {
      for (const i of context(name)) if (!contextCopyFor(i)) missing.push(`${name}/${i.kind}`);
    }
    expect(missing).toEqual([]);
  });

  it('shows an unknown kind rather than dropping it', () => {
    const html = renderToStaticMarkup(createElement(ProgrammeContext, {
      items: [{ kind: 'SOME_FUTURE_CONTEXT_KIND', facts: {}, qualification: {} }],
    }));
    expect(text(html)).toContain('No context wording');
    expect(text(html)).toContain('SOME_FUTURE_CONTEXT_KIND');
  });

  it('returns null rather than half a row when a fact is missing', () => {
    expect(contextCopyFor({ kind: 'COACH_CONTEXT', facts: { coach: 'X' } })).toBeNull();
    expect(contextCopyFor({ kind: 'NOT_A_KIND', facts: { coach: 'X', seasonsObserved: 3 } })).toBeNull();
    expect(contextCopyFor(null)).toBeNull();
  });
});

describe('a start year is printed only when it was observed', () => {
  it('names the appointment year when the window did not bound it', () => {
    const c = coach('Oregon State');
    expect(c.facts.windowBounded).toBe(false);
    const copy = contextCopyFor(c);
    expect(copy.tenure).toBe(`In post since ${c.facts.since}`);
    expect(copy.detail).toContain(`Appointed for the ${c.facts.since} season`);
  });

  it('prints no year at all when the window bounded it', () => {
    const c = coach('Clemson');
    expect(c.facts.windowBounded).toBe(true);
    expect(c.facts.since).toBe(2024);
    const copy = contextCopyFor(c);
    // The Notre Dame error, exactly: "since 2024" about a coach whose start we
    // never saw. 1,341 of 2,088 real items are in this branch.
    expect(copy.tenure).toBe(`In post for at least ${c.facts.seasonsObserved} seasons`);
    expect(`${copy.tenure} ${copy.detail}`).not.toContain('2024');
    expect(text(render('Clemson'))).not.toContain('since 2024');
  });

  it('says outright that a bounded coach may have been there longer', () => {
    expect(contextCopyFor(coach('Clemson')).detail).toContain('may have been there longer');
  });

  it('gives a single observed season the singular', () => {
    const copy = contextCopyFor({
      kind: 'COACH_CONTEXT',
      facts: { coach: 'A Coach', seasonsObserved: 1, since: 2026, windowBounded: true, knownThrough: 2026, stillInPost: true, context: 'ESTABLISHED' },
    });
    expect(copy.tenure).toBe('In post for at least 1 season');
  });
});

describe('the classifier is not printed', () => {
  it('renders neither ESTABLISHED nor NEW', () => {
    // `context` is ESTABLISHED unless a coach has two seasons or fewer AND we
    // know their start year — so ESTABLISHED is the residue, including every
    // case where we have no idea how long they have been in post. Printing it
    // would assert tenure this system never measured.
    for (const name of Object.keys(CONTEXT_FIXTURES)) {
      const t = text(render(name));
      expect(t).not.toMatch(/established/i);
      expect(t).not.toMatch(/\bnew coach\b/i);
    }
    expect(coach('Clemson').facts.context).toBe('ESTABLISHED');
    expect(coach('Clemson').facts.windowBounded).toBe(true);
  });

  it('says nothing different about a NEW coach than the facts do', () => {
    const c = coach('Vermont');
    expect(c.facts.context).toBe('NEW');
    const copy = contextCopyFor(c);
    // Two observed seasons and a known start year — stated as those, not as a
    // category, and with no suggestion that a new coach is an opening.
    expect(copy.tenure).toBe('In post since 2025');
    expect(`${copy.headline} ${copy.tenure} ${copy.detail}`).not.toMatch(/new|recent appointment/i);
  });
});

describe('nothing here becomes a judgement or an expectation', () => {
  it('uses no stability, regime-quality or intent language on any fixture', () => {
    for (const name of Object.keys(CONTEXT_FIXTURES)) {
      const t = text(render(name));
      for (const pattern of FORBIDDEN) {
        expect(t, `${name} matched ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('is styled as the lightest thing on the page', () => {
    const html = render('Clemson');
    // No card, no colour, no heading weight competing with the sections above.
    for (const cls of ['rounded-lg', 'bg-card', 'text-emerald', 'bg-emerald',
      'text-primary', 'bg-primary', 'text-red', 'text-lg']) {
      expect(html).not.toContain(cls);
    }
  });

  it('mentions no position, country or athlete', () => {
    for (const name of Object.keys(CONTEXT_FIXTURES)) {
      const t = text(render(name));
      for (const word of ['defender', 'defenders', 'New Zealand', 'this athlete', 'international']) {
        expect(t).not.toContain(word);
      }
    }
  });
});

describe('the measured window says which staff records were read', () => {
  it('spans a run of seasons', () => {
    const w = contextWindow(coach('Oregon State'));
    expect(w.measured).toMatch(/^Staff records read across \d{4}–\d{4}$/);
  });

  it('names an unreadable staff record rather than hiding the gap', () => {
    const c = coach('Clemson');
    expect(c.qualification.window.seasonsUnread).toEqual(['2022', '2023']);
    // These are the seasons that make the window start at 2024, which is
    // exactly why the tenure line above refuses to print that year.
    expect(contextWindow(c).coverage)
      .toBe('The 2022 and 2023 staff records could not be read.');
    expect(text(render('Clemson'))).toContain('staff records could not be read');
  });

  it('says nothing when the window was fully read', () => {
    const c = coach('Jacksonville');
    expect(c.qualification.window.seasonsUnread).toEqual([]);
    expect(contextWindow(c).coverage).toBeNull();
  });

  it('words an unread season as a staff record, not a cohort', () => {
    // The Development section's tri-state is about cohort readability; here it
    // is about staff pages, and a page that said nobody was in post is an
    // answer rather than a hole — it never lands in this list.
    expect(contextWindow(coach('Clemson')).coverage).toContain('staff record');
    expect(contextWindow(coach('Clemson')).coverage).not.toMatch(/cohort|first-year/i);
  });

  it('reports unknown coverage as unknown', () => {
    expect(contextWindow({ qualification: { window: { seasons: ['2025'], seasonsUnread: null } } }).coverage)
      .toBe('Which seasons we could read is unknown.');
  });
});

describe('freshness is not shown, because it is the wrong table\'s', () => {
  it('sources from coach_seasons but carries the roster\'s freshness', () => {
    for (const name of Object.keys(CONTEXT_FIXTURES)) {
      for (const i of context(name)) {
        expect(i.qualification.source).toBe('coach_seasons');
        // Handed to every generator from the shared programme context.
        expect(i.qualification.freshness).toEqual(expect.any(Object));
      }
    }
  });

  it('prints no staleness warning about roster rows', () => {
    for (const name of Object.keys(CONTEXT_FIXTURES)) {
      const t = text(render(name));
      expect(t).not.toMatch(/roster rows|scrape|stale|out of date/i);
    }
  });
});

describe('an empty section is a gap, not an absence of context', () => {
  const html = render('Gardner-Webb');

  it('has no coaching evidence in the fixture', () => {
    expect(context('Gardner-Webb')).toEqual([]);
  });

  it('says what is missing without claiming there is nothing to know', () => {
    expect(text(html)).toContain('No programme-context evidence on file');
    for (const claim of [/no relevant context/i, /nothing to note/i, /no context exists/i]) {
      expect(text(html)).not.toMatch(claim);
    }
  });

  it('still shows the section', () => {
    // The heading stays so the operator can see the section was looked at;
    // the framing paragraph does not, because it explains how to read rows
    // and there are none.
    expect(text(html)).toContain('Programme context');
    expect(text(html)).not.toContain('Coaching context that may change how');
  });
});

describe('coach context and coach-attributed arrivals stay apart', () => {
  const full = renderToStaticMarkup(
    createElement(ProgrammeDecision, { model: PATHWAY_FIXTURES.Jacksonville }),
  );
  const t = text(full);

  it('keeps the coach-attributed arrival in Recruitment Pathway', () => {
    const arrival = PATHWAY_FIXTURES.Jacksonville.sections.RECRUITMENT_PATHWAY
      .find((i) => i.kind === 'COACH_ARRIVAL_SAME_COUNTRY');
    expect(arrival).toBeTruthy();
    expect(t.indexOf('from New Zealand under'))
      .toBeGreaterThan(t.indexOf('Recruiting history and roster make-up'));
    expect(t.indexOf('from New Zealand under'))
      .toBeLessThan(t.indexOf('Coaching context that may change how'));
  });

  it('does not put coach context into Recruitment Pathway or Top Reasons', () => {
    expect(PATHWAY_FIXTURES.Jacksonville.sections.RECRUITMENT_PATHWAY
      .map((i) => i.kind)).not.toContain('COACH_CONTEXT');
    expect(PATHWAY_FIXTURES.Jacksonville.topReasons
      .flatMap((r) => [r.primary.kind, ...r.supporting.map((s) => s.kind)]))
      .not.toContain('COACH_CONTEXT');
  });

  it('never fuses tenure and recruiting into one claim', () => {
    // "Ali Simmons has been here since 2023 and regularly recruits New Zealand
    // players" is the sentence these two sections could produce between them.
    // Neither object supports it and no row contains both halves.
    const ctx = contextCopyFor(coach('Jacksonville'));
    const line = `${ctx.headline} ${ctx.tenure} ${ctx.detail}`;
    expect(line).not.toMatch(/recruit|arrival|New Zealand|signed/i);
    expect(t).not.toMatch(/in post since \d{4} and/i);
    expect(t).not.toMatch(/has been here since[^.]*recruit/i);
  });

  it('gives the coach no position-specific claim', () => {
    // The roster section above names defenders and the pathway section names a
    // coach. Neither combines into "this coach recruits defenders".
    const c = coach('Jacksonville');
    const ctx = contextCopyFor(c);
    // The item's own text, drawer included. Searching the whole page instead
    // would flatten the element boundary between this row and the next.
    const own = [ctx.headline, ctx.tenure, ctx.detail,
      ...provenanceRows(c).map((r) => `${r.label} ${r.value}`)].join(' ');
    expect(own).toContain(c.facts.coach);
    expect(own).not.toMatch(/defender|forward|midfield|position/i);
  });

  it('does not turn a coaching change beside roster turnover into a rebuild', () => {
    for (const claim of [/rebuild/i, /fresh start/i, /clean slate/i, /new era/i,
      /chance to (get|come) in/i]) {
      expect(t).not.toMatch(claim);
    }
  });
});

describe('the section closes the page and changes nothing above it', () => {
  const full = renderToStaticMarkup(
    createElement(ProgrammeDecision, { model: CONTEXT_FIXTURES.Jacksonville }),
  );
  const t = text(full);

  it('renders after Academic and programme fit', () => {
    expect(t.indexOf('Coaching context that may change how'))
      .toBeGreaterThan(t.indexOf('What the athlete’s stated subject matches here'));
  });

  it('renders last of the six sections', () => {
    const order = [
      'reasons identified',
      'Current roster structure',
      'Recruiting history and roster make-up',
      'How first-year players have been used here',
      'What the athlete’s stated subject matches here',
      'Coaching context that may change how',
    ].map((s) => t.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('leaves every section above it untouched', () => {
    expect(t).toContain('3 defenders in the graduating class');
    expect(t).toContain('Eligibility runs out across 2026–2027');
    expect(t).toContain('Offers Kinesiology');
  });

  it('renders no raw JSON or backend vocabulary', () => {
    expect(full).not.toContain('{"');
    expect(full).not.toContain('[object Object]');
    for (const leak of ['COACH_CONTEXT', 'windowBounded', 'knownThrough', 'stillInPost',
      'ESTABLISHED', 'coach_seasons', 'seasonsUnread', 'minConfidence', 'requiresWindow']) {
      expect(t).not.toContain(leak);
    }
  });
});
