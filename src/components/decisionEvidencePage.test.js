import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ProgrammeDecision from './ProgrammeDecision.jsx';
import { PAGE_FIXTURES } from '@/lib/__fixtures__/pageFixtures.js';
import { provenanceRows, FRESHNESS_SAFE, SOURCE_LABEL } from '@/lib/evidenceProvenance';
import { pathwayCopyFor } from '@/lib/pathwayEvidenceCopy';

/**
 * The Decision Evidence page as one product, across eleven real pairings.
 *
 * The section suites each defend their own semantics. This one defends the
 * properties that only exist once the whole page is assembled: that the six
 * areas appear in one order, that a claim never gains force from a claim in
 * another section, that no number on the page came from combining two, and
 * that nothing anywhere reads as a score or a promise.
 *
 * Eleven fixtures, chosen to cover every state the page can be in: four
 * reasons and none, every section full and every section empty, a relaxed
 * cohort, unread seasons, a gapped window, a coach whose start year may not be
 * printed, and a name that does not resolve.
 */

const text = (html) => html
  .replace(/<[^>]+>/g, ' ')
  // Entities first: an apostrophe arrives as `&#x27;` and leaves "27" behind
  // for anything scanning the result for digits.
  .replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();
const render = (name) => renderToStaticMarkup(
  createElement(ProgrammeDecision, { model: PAGE_FIXTURES[name] }),
);
const NAMES = Object.keys(PAGE_FIXTURES);
const RESOLVED = NAMES.filter((n) => PAGE_FIXTURES[n].programme.resolved);

/** Every evidence object on a page, sections and reasons alike. */
const itemsOf = (name) => {
  const m = PAGE_FIXTURES[name];
  return [
    ...Object.values(m.sections).flat(),
    ...m.topReasons.flatMap((r) => [r.primary, ...r.supporting]),
  ];
};

describe('the page is one product', () => {
  it('renders every fixture without throwing', () => {
    for (const name of NAMES) expect(() => render(name)).not.toThrow();
  });

  it('puts the six areas in one order, on every populated page', () => {
    const ORDER = [
      'Roster opportunity',
      'Recruitment pathway',
      'Development',
      'Academic and programme fit',
      'Programme context',
    ];
    for (const name of RESOLVED) {
      if (!PAGE_FIXTURES[name].summary.reasonCount) continue;
      const t = text(render(name));
      // The summary leads, in whichever number it needs.
      const summaryAt = t.search(/\d+ reasons? identified/);
      expect(summaryAt, `${name} has no summary line`).toBeGreaterThanOrEqual(0);
      const at = ORDER.map((s) => t.indexOf(s));
      expect(at.every((i) => i >= 0), `${name} missing a section`).toBe(true);
      expect(summaryAt).toBeLessThan(at[0]);
      expect([...at].sort((a, b) => a - b), `${name} out of order`).toEqual(at);
    }
  });

  it('keeps the server\'s reason order on every page', () => {
    for (const name of RESOLVED) {
      const m = PAGE_FIXTURES[name];
      if (m.topReasons.length < 2) continue;
      const t = text(render(name));
      // Rank numbers are rendered in order; the list never re-sorts.
      const ranks = m.topReasons.map((_, i) => t.indexOf(`${i + 1} `));
      expect(ranks.every((i) => i >= 0)).toBe(true);
    }
  });

  it('tags a reason with one word, never the section heading', () => {
    const t = text(render('Jacksonville'));
    expect(t).toContain('Opening');
    expect(t).toContain('Pathway');
    expect(t).toContain('Fit');
    // The old tags were the section headings verbatim, so the same phrase
    // meant two different things on one page.
    for (const name of RESOLVED) {
      const rendered = text(render(name));
      const tagLike = (rendered.match(/Roster opportunity/g) ?? []).length;
      // At most once: the section heading. Never again as a tag.
      expect(tagLike, `${name} repeated a section heading as a tag`).toBeLessThanOrEqual(1);
    }
  });
});

describe('the four page states stay distinct', () => {
  it('shows ranked reasons where there are some', () => {
    const t = text(render('Jacksonville'));
    expect(PAGE_FIXTURES.Jacksonville.summary.reasonCount).toBe(4);
    expect(t).toContain('4 reasons identified');
    expect(t).toContain('3 defenders in the graduating class');
  });

  it('makes zero reasons with rich evidence still worth reading', () => {
    // Carleton is the fixture this distinction exists for.
    const m = PAGE_FIXTURES['Carleton (Ryan)'];
    expect(m.summary.reasonCount).toBe(0);
    expect(m.summary.hasEvidence).toBe(true);
    const t = text(render('Carleton (Ryan)'));
    expect(t).toContain('No positive reasons identified');
    expect(t).toContain('none of it argues for acting');
    // And the detail is genuinely there rather than a bare apology.
    expect(t).toContain('First-year defenders');
    expect(t).toContain('8 defenders recruited across');
    expect(t.length).toBeGreaterThan(2000);
  });

  it('says plainly when there is almost nothing', () => {
    const t = text(render('Bethesda'));
    expect(PAGE_FIXTURES.Bethesda.summary.evidenceCount).toBe(0);
    expect(t).toContain('We hold almost nothing on this programme');
    // Every section still shows its heading, so an operator can see each was
    // looked at — but not five paragraphs explaining rows that do not exist.
    for (const heading of ['Roster opportunity', 'Recruitment pathway', 'Development',
      'Academic and programme fit', 'Programme context']) {
      expect(t).toContain(heading);
    }
    expect(t).not.toContain('Current roster structure');
    expect(t.length).toBeLessThan(1200);
  });

  it('treats an unresolved name as a lookup miss, not an assessment', () => {
    const t = text(render('A Programme We Do Not Hold'));
    expect(PAGE_FIXTURES['A Programme We Do Not Hold'].programme.resolved).toBe(false);
    expect(t).toContain('Programme evidence unavailable');
    expect(t).toContain('gap on our side');
    // No sections at all, and none of the zero-reason wording.
    expect(t).not.toContain('No positive reasons identified');
    expect(t).not.toContain('Roster opportunity');
  });

  it('keeps the empty-but-resolved and unresolved pages different', () => {
    const empty = text(render('Bethesda'));
    const unknown = text(render('A Programme We Do Not Hold'));
    expect(PAGE_FIXTURES.Bethesda.summary).toEqual(
      PAGE_FIXTURES['A Programme We Do Not Hold'].summary,
    );
    // Identical evidence fields; only `programme.resolved` separates them, and
    // the two pages must not read the same.
    expect(empty).not.toBe(unknown);
    expect(empty).toContain('No positive reasons identified');
    expect(unknown).not.toContain('No positive reasons identified');
  });
});

describe('no number on the page came from combining two', () => {
  it('traces every rendered figure to a fact or qualification of its own item', () => {
    for (const name of NAMES) {
      const items = itemsOf(name);
      if (!items.length) continue;

      const allowed = new Set();
      const collect = (node) => {
        if (typeof node === 'number') {
          allowed.add(String(node));
          String(node).split('.').forEach((p) => allowed.add(p));
          String(Number(node.toFixed(1))).split('.').forEach((p) => allowed.add(p));
          if (node > 0 && node < 1) allowed.add(String(Math.round(node * 100)));
          allowed.add(String(Math.round(node)));
          // Thousands separators are stripped before the scan, but a rounded
          // and re-formatted figure must still match.
          allowed.add(Math.round(node).toLocaleString('en-GB').replace(/,/g, ''));
        } else if (typeof node === 'string') {
          (node.match(/\d+/g) ?? []).forEach((v) => allowed.add(v));
        } else if (Array.isArray(node)) node.forEach(collect);
        else if (node && typeof node === 'object') {
          Object.keys(node).forEach(collect);
          Object.values(node).forEach(collect);
        }
      };
      items.forEach((i) => { collect(i.facts); collect(i.qualification); });
      // The summary's own counts are legitimately on the page.
      collect(PAGE_FIXTURES[name].summary);
      // Rank numbers on the reason list.
      PAGE_FIXTURES[name].topReasons.forEach((_, i) => allowed.add(String(i + 1)));

      const rendered = text(render(name)).replace(/,/g, '');
      const unsourced = [...new Set(rendered.match(/\d+/g) ?? [])].filter((v) => !allowed.has(v));
      expect(unsourced, `${name} rendered numbers with no source`).toEqual([]);
    }
  });

  it('prints no sum of the graduating class, the starters and the cliff', () => {
    const t = text(render('Jacksonville'));
    // 3 graduating, 2 projected starters, 5 across the cliff — of whom the
    // 2026 rows are the same three people.
    for (const sum of ['5 defenders are leaving', '7 defenders', '8 defenders', '10 defenders']) {
      expect(t).not.toContain(sum);
    }
  });

  it('prints one squad total where two kinds disagree about it', () => {
    // POSITION_GROUP_SCARCITY and POSITION_GROUP_SIZE both carry `squadSize`
    // and differ at 47 of 228 programmes.
    for (const name of RESOLVED) {
      const roster = PAGE_FIXTURES[name].sections.ROSTER_OPPORTUNITY;
      const scarcity = roster.find((i) => i.kind === 'POSITION_GROUP_SCARCITY');
      const size = roster.find((i) => i.kind === 'POSITION_GROUP_SIZE');
      if (!scarcity || !size || scarcity.facts.squadSize === size.facts.squadSize) continue;
      const t = text(render(name));
      expect(t).not.toContain(`squad of ${scarcity.facts.squadSize}`);
    }
  });

  it('never derives an international share from the roster count', () => {
    for (const name of RESOLVED) {
      const pathway = PAGE_FIXTURES[name].sections.RECRUITMENT_PATHWAY;
      const share = pathway.find((i) => i.kind === 'INTERNATIONAL_SHARE');
      if (!share) continue;
      const t = text(render(name));
      const shown = [...new Set(t.match(/\d+% of the squad is international/g) ?? [])];
      expect(shown).toEqual([`${Math.round(share.facts.share * 100)}% of the squad is international`]);
    }
  });
});

describe('no claim gains force from a claim in another section', () => {
  const FUSIONS = [
    /coach[^.]*recruits[^.]*defender/i,
    /consistently recruits/i,
    /strong (overall )?fit/i,
    /elite programme/i,
    /rebuild/i,
    /in post since \d{4} and/i,
    /both a[^.]*and a[^.]*fit/i,
  ];

  it('writes none of the known dangerous combinations, on any page', () => {
    for (const name of NAMES) {
      const t = text(render(name));
      for (const pattern of FUSIONS) {
        expect(t, `${name} matched ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('names a country and a position together only where one object does', () => {
    // ARRIVAL_SAME_COUNTRY_POSITION establishes both axes in a single evidence
    // object, so "1 New Zealand defender recruited" is a claim it makes. The
    // same phrase assembled from a country item and a position item beside it
    // would not be, so the guard asks which page it is looking at.
    for (const name of RESOLVED) {
      const licensed = PAGE_FIXTURES[name].sections.RECRUITMENT_PATHWAY
        .some((i) => i.facts?.country && i.facts?.position);
      if (licensed) continue;
      expect(text(render(name)), name).not.toMatch(/New Zealand defender/i);
    }
  });

  it('keeps a coach claim free of a position from the row beneath it', () => {
    // Asserted on the coach item's own text, drawer included. Searching the
    // whole page flattens the boundary between one row's provenance and the
    // next row's headline.
    for (const name of RESOLVED) {
      const coach = PAGE_FIXTURES[name].sections.RECRUITMENT_PATHWAY
        .find((i) => i.kind === 'COACH_ARRIVAL_SAME_COUNTRY');
      if (!coach) continue;
      // The CLAIM, not the provenance. The headline deliberately names no
      // position even on the 42 of 177 items that carry one, so that our
      // record-keeping does not read as a difference between programmes. The
      // drawer beneath it describes what was actually measured, and where the
      // cohort really was position-narrowed — Portland — saying so is the
      // honest answer to "what population is this".
      const copy = pathwayCopyFor(coach);
      const claim = `${copy.headline} ${copy.detail ?? ''}`;
      expect(claim, name).toContain(coach.facts.coach);
      expect(claim, name).not.toMatch(/defender|forward|midfield|goalkeeper/i);
    }
  });
});

describe('nothing reads as a score or a promise', () => {
  const SCORE = [
    /overall score/i, /fit score/i, /evidence score/i, /opportunity score/i,
    /confidence percentage/i, /pathway probability/i, /recommendation/i,
    /\bscore\b/i, /\brating\b/i, /out of \d+/i, /\b\d+\s*\/\s*\d+\b/,
  ];
  const CERTAINTY = [
    /definitely/i, /guaranteed/i, /will recruit/i, /will play/i, /likely to recruit/i,
    /scholarship available/i, /coach needs/i, /perfect fit/i, /a lock/i, /shoo-in/i,
    /you should/i, /we recommend/i, /best option/i,
  ];

  it('shows no synthetic score on any page', () => {
    for (const name of NAMES) {
      const t = text(render(name));
      for (const pattern of SCORE) expect(t, `${name} matched ${pattern}`).not.toMatch(pattern);
    }
  });

  it('promises nothing on any page', () => {
    for (const name of NAMES) {
      const t = text(render(name));
      for (const pattern of CERTAINTY) expect(t, `${name} matched ${pattern}`).not.toMatch(pattern);
    }
  });

  it('carries no score vocabulary anywhere in the Decision Evidence source', () => {
    // A guard on the code as well as the render: a fixture that never
    // exercises a branch cannot prove the branch is safe.
    const files = [
      'src/lib/operatorEvidenceCopy.js', 'src/lib/rosterEvidenceCopy.js',
      'src/lib/pathwayEvidenceCopy.js', 'src/lib/developmentEvidenceCopy.js',
      'src/lib/fitEvidenceCopy.js', 'src/lib/contextEvidenceCopy.js',
      'src/lib/evidenceProvenance.js',
    ];
    for (const file of files) {
      // Comments stripped FIRST. They discuss what is forbidden and why, and
      // an apostrophe in "the athlete's subject" otherwise reads as a string
      // delimiter and drags half a paragraph into the scan.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
      const literals = (code.match(/`[^`]*`|'[^']*'/g) ?? []).join(' ');
      for (const word of ['score', 'rating', 'guaranteed', 'perfect fit', 'we recommend']) {
        expect(literals.toLowerCase(), `${file} contains "${word}"`).not.toContain(word);
      }
    }
  });
});

describe('provenance is one consistent affordance', () => {
  it('gives every evidence object exactly one control', () => {
    for (const name of NAMES) {
      const html = render(name);
      const controls = (html.match(/aria-expanded/g) ?? []).length;
      expect(controls, `${name}`).toBe(itemsOf(name).length);
    }
  });

  it('starts every control closed, on every page', () => {
    for (const name of NAMES) {
      for (const state of render(name).match(/aria-expanded="[a-z]+"/g) ?? []) {
        expect(state).toBe('aria-expanded="false"');
      }
    }
  });

  it('uses one short label, because a rich page carries dozens', () => {
    const html = render('Jacksonville');
    expect((html.match(/aria-expanded/g) ?? []).length).toBe(27);
    expect(text(html)).not.toContain('Where this comes from');
    expect((text(html).match(/Provenance/g) ?? []).length).toBe(27);
  });

  it('offers no link anywhere, because sourceUrl is null everywhere', () => {
    for (const name of NAMES) {
      for (const i of itemsOf(name)) expect(i.qualification?.sourceUrl ?? null).toBeNull();
      expect(render(name)).not.toContain('<a ');
    }
  });
});

describe('the audited freshness and source rules still hold', () => {
  it('suppresses freshness on all eight unsafe kinds', () => {
    const UNSAFE = ['ACADEMIC_FIT', 'CONFERENCE_TITLE', 'POSTSEASON_RESULT', 'PROGRAM_MOMENTUM',
      'COACH_CONTEXT', 'COACH_ARRIVAL_SAME_COUNTRY', 'ARRIVAL_SAME_COUNTRY_POSITION',
      'ARRIVAL_SAME_REGION_POSITION'];
    for (const kind of UNSAFE) expect(FRESHNESS_SAFE.has(kind), kind).toBe(false);
    expect(FRESHNESS_SAFE.size).toBe(11);
  });

  it('gives an unknown kind no freshness by default', () => {
    const rows = provenanceRows({
      kind: 'SOME_FUTURE_KIND',
      qualification: { source: 'roster_players', temporality: 'CURRENT', freshness: { state: 'STALE', reason: 'last read 400 days ago' } },
    });
    expect(rows.map((r) => r.label)).not.toContain('Roster reading');
  });

  it('maps every source that occurs across the whole matrix', () => {
    const unmapped = new Set();
    for (const name of NAMES) {
      for (const i of itemsOf(name)) {
        const s = i.qualification?.source;
        if (s && !SOURCE_LABEL[s]) unmapped.add(s);
      }
    }
    expect([...unmapped]).toEqual([]);
  });

  it('never prints a raw table name', () => {
    for (const name of NAMES) {
      const t = text(render(name));
      for (const table of ['roster_players', 'coach_seasons', 'colleges:', 'recruiting_arrivals']) {
        expect(t, `${name} leaked ${table}`).not.toContain(table);
      }
    }
  });
});

describe('no raw metadata reaches any page', () => {
  it('renders no object dump, null or NaN', () => {
    for (const name of NAMES) {
      const html = render(name);
      for (const junk of ['[object Object]', 'undefined', 'NaN', '{"']) {
        expect(html, `${name} rendered ${junk}`).not.toContain(junk);
      }
    }
  });

  it('leaks a raw position enum only inside the backend\'s own sentence', () => {
    // ATHLETE_COHORT_LADDER's `refused` reads "DEFENSE / international: only 1
    // in 1 season — too few to read separately". It is rendered verbatim on
    // purpose, so a relaxed cohort explains itself in the words of the thing
    // that relaxed it, and rewriting backend prose to tidy the enum would put
    // this screen back in the business of authoring claims. Backend copy debt,
    // pinned here so it is a known quantity rather than a surprise.
    for (const name of NAMES) {
      const t = text(render(name));
      const at = t.indexOf('DEFENSE');
      if (at === -1) continue;
      const refused = PAGE_FIXTURES[name].sections.DEVELOPMENT
        .find((i) => i.kind === 'ATHLETE_COHORT_LADDER')?.facts?.refused;
      expect(refused, `${name} showed DEFENSE outside a refusal note`).toContain('DEFENSE');
      expect(t.slice(at)).toContain('too few to read separately');
    }
  });

  it('renders none of the implementation vocabulary', () => {
    for (const name of NAMES) {
      const t = text(render(name));
      for (const leak of ['dedupeGroup', 'decisionClass', 'polarity', 'minConfidence',
        'requiresWindow', 'requiresComparison', 'generatedCount', 'seasonsUnread',
        'verdictKey', 'windowBounded', 'OCEANIA', 'ESTABLISHED']) {
        expect(t, `${name} leaked ${leak}`).not.toContain(leak);
      }
    }
  });

  it('has no section component reaching past the serialized payload', () => {
    // `data` is not on the wire at all; this catches a component trying.
    for (const file of readdirSync('src/components').filter((f) => f.endsWith('.jsx'))) {
      const src = readFileSync(`src/components/${file}`, 'utf8');
      expect(src, `${file} reads evidence.data`).not.toMatch(/\.data\b/);
    }
  });
});
