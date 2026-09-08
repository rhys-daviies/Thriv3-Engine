import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AcademicProgrammeFit from './AcademicProgrammeFit.jsx';
import ProgrammeDecision from './ProgrammeDecision.jsx';
import { fitCopyFor, FIT_COPY_KINDS } from '@/lib/fitEvidenceCopy';
import { FIT_FIXTURES } from '@/lib/__fixtures__/fitEvidence.js';
import { SECTION_OF, SECTIONS } from '@shared/evidence/operatorEvidence.js';

/**
 * The academic and programme-fit section, against ten real programmes.
 *
 * The risk here is different from the other sections. Nothing needs adding up
 * and no axis can be borrowed; what these four kinds invite is a SUMMARY. A
 * subject that is taught, a conference won, a round of 16 reached and a rising
 * win rate sit together on one screen and the obvious sentence — "a strong
 * fit" — is one that no evidence object supports and that an operator would
 * read as a recommendation. Most of what follows checks that sentence, and its
 * relatives, never appear.
 */

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const fit = (name) => FIT_FIXTURES[name].sections.ACADEMIC_PROGRAMME_FIT;
const render = (name) => renderToStaticMarkup(
  createElement(AcademicProgrammeFit, { items: fit(name) }),
);
const item = (name, kind) => fit(name).find((i) => i.kind === kind);

/**
 * Sentences that would combine the kinds or claim something about admission.
 *
 * "entry requirement" is deliberately absent: the academic row DENIES being
 * about entry requirements, and a blanket ban on the phrase would forbid the
 * disclaimer along with the claim. The affirmative version is caught by the
 * admission, acceptance and eligibility patterns beside it, and a separate
 * test asserts the denial is present.
 */
const FORBIDDEN = [
  /overall fit/i, /strong fit/i, /good fit/i, /great fit/i, /poor fit/i, /excellent/i,
  /fit score/i, /elite/i, /championship-level/i, /top programme/i, /well suited/i,
  /admission/i, /admitted/i, /accept(ed|ance)/i, /scholarship/i, /eligib/i,
  /get in\b/i, /academically strong/i, /highly ranked/i,
  /reputable/i, /prestigious/i, /quality of/i,
];

describe('every kind can be presented', () => {
  it('covers all four kinds filed into this section', () => {
    const filed = Object.entries(SECTION_OF)
      .filter(([, section]) => section === SECTIONS.ACADEMIC_PROGRAMME_FIT)
      .map(([kind]) => kind);
    expect(filed).toHaveLength(4);
    expect(filed.filter((k) => !FIT_COPY_KINDS.includes(k))).toEqual([]);
  });

  it('presents every item in every fixture', () => {
    const missing = [];
    for (const name of Object.keys(FIT_FIXTURES)) {
      for (const i of fit(name)) if (!fitCopyFor(i)) missing.push(`${name}/${i.kind}`);
    }
    expect(missing).toEqual([]);
  });

  it('shows an unknown kind rather than dropping it', () => {
    const html = renderToStaticMarkup(createElement(AcademicProgrammeFit, {
      items: [{ kind: 'SOME_FUTURE_FIT_KIND', facts: {}, qualification: {} }],
    }));
    expect(text(html)).toContain('No fit wording');
    expect(text(html)).toContain('SOME_FUTURE_FIT_KIND');
  });

  it('returns null rather than half a row when a fact is missing', () => {
    expect(fitCopyFor({ kind: 'ACADEMIC_FIT', facts: {} })).toBeNull();
    expect(fitCopyFor({ kind: 'CONFERENCE_TITLE', facts: {} })).toBeNull();
    expect(fitCopyFor({ kind: 'NOT_A_KIND', facts: { conference: 'ACC' } })).toBeNull();
    expect(fitCopyFor(null)).toBeNull();
  });
});

describe('the two groups never become one claim', () => {
  it('writes no combining or admissions sentence on any fixture', () => {
    for (const name of Object.keys(FIT_FIXTURES)) {
      const t = text(render(name));
      for (const pattern of FORBIDDEN) {
        expect(t, `${name} matched ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('keeps academic fit and a conference title in separate groups', () => {
    // SMU has both. The forbidden synthesis is one sentence covering the two.
    const t = text(render('SMU'));
    expect(item('SMU', 'ACADEMIC_FIT')).toBeTruthy();
    expect(item('SMU', 'CONFERENCE_TITLE')).toBeTruthy();
    expect(t).toContain('Academic match');
    expect(t).toContain('Programme results');
    // No row mentions both a subject and a competition.
    for (const i of fit('SMU')) {
      const copy = fitCopyFor(i);
      const line = `${copy.headline} ${copy.detail ?? ''}`;
      const subject = line.includes('Kinesiology');
      const competition = /ACC|round of|postseason|title|final/i.test(line);
      expect(subject && competition).toBe(false);
    }
  });

  it('does not let three results add up to a verdict on the programme', () => {
    // High Point carries all four kinds — the fixture most likely to produce
    // "elite programme" or "strong overall fit".
    expect(fit('High Point').map((i) => i.kind)).toEqual([
      'ACADEMIC_FIT', 'CONFERENCE_TITLE', 'POSTSEASON_RESULT', 'PROGRAM_MOMENTUM',
    ]);
    const t = text(render('High Point'));
    for (const pattern of FORBIDDEN) expect(t).not.toMatch(pattern);
    for (const claim of [/all of which/i, /together/i, /combined/i, /on top of/i]) {
      expect(t).not.toMatch(claim);
    }
  });

  it('does not let momentum modify the academic claim', () => {
    const academic = fitCopyFor(item('Jacksonville', 'ACADEMIC_FIT'));
    const momentum = item('Jacksonville', 'PROGRAM_MOMENTUM');
    const line = `${academic.headline} ${academic.detail}`;
    // The academic row says nothing about results, and nothing about the
    // classification the row beneath it carries.
    expect(line).not.toMatch(/rising|strong|result|win/i);
    expect(line).not.toContain(momentum.facts.classification);
  });

  it('never presents a programme result as being about this athlete', () => {
    // Said once, over the group, rather than on every row. The rows carry the
    // result and nothing else; the heading carries what the group means.
    for (const name of ['High Point', 'Georgetown', 'Washington']) {
      const t = text(render(name));
      expect(t).toContain('This says nothing about this athlete in particular');
      for (const i of fit(name)) {
        const copy = fitCopyFor(i);
        if (copy.scope !== 'programme') continue;
        // And no programme row phrases itself as being about the athlete.
        expect(`${copy.headline} ${copy.detail ?? ''}`)
          .not.toMatch(/this athlete|for them|suits/i);
      }
    }
  });

  it('adds no score, meter or badge', () => {
    const html = render('High Point');
    for (const cls of ['text-emerald', 'bg-emerald', 'text-green', 'bg-green',
      'text-red', 'bg-red', 'bg-primary', 'text-primary']) {
      expect(html).not.toContain(cls);
    }
    expect(text(html)).not.toMatch(/\b\d+\s*\/\s*\d+\b/);   // no "3/4"-style score
  });
});

describe('academic fit is about a subject, not a place', () => {
  const academic = item('Wake Forest', 'ACADEMIC_FIT');
  const copy = fitCopyFor(academic);

  it('names the subject that matched', () => {
    expect(copy.headline).toBe(`Offers ${academic.facts.matchedProgramme}`);
  });

  it('quotes the athlete\'s own words for what was matched against', () => {
    expect(copy.detail).toContain(`“${academic.facts.statedByAthlete}”`);
  });

  it('says explicitly that it is not about entry or a place', () => {
    expect(copy.detail).toContain('not about entry requirements or a place');
  });

  it('claims nothing about admission, funding or eligibility', () => {
    const t = text(render('Wake Forest'));
    for (const pattern of FORBIDDEN) expect(t).not.toMatch(pattern);
  });

  it('claims nothing about how good the department is', () => {
    for (const claim of [/ranked/i, /respected/i, /leading/i, /renowned/i, /accredited/i]) {
      expect(`${copy.headline} ${copy.detail}`).not.toMatch(claim);
    }
  });

  it('is the only kind treated as athlete-specific', () => {
    for (const name of Object.keys(FIT_FIXTURES)) {
      for (const i of fit(name)) {
        const expected = i.kind === 'ACADEMIC_FIT' ? 'athlete' : 'programme';
        expect(fitCopyFor(i).scope).toBe(expected);
      }
    }
  });
});

describe('a conference title is a result with a season on it', () => {
  const title = item('SMU', 'CONFERENCE_TITLE');

  it('names the conference and the season', () => {
    // The season lives on the qualification, not the facts — these kinds
    // carry what happened and when rides alongside.
    expect(title.facts).toEqual({ conference: title.facts.conference });
    expect(title.qualification.season).toBe('2025');
    expect(fitCopyFor(title).headline).toBe(`Won the ${title.facts.conference} in 2025`);
  });

  it('drops the season rather than inventing one when it is absent', () => {
    expect(fitCopyFor({ kind: 'CONFERENCE_TITLE', facts: { conference: 'ACC' }, qualification: {} }).headline)
      .toBe('Won the ACC');
  });

  it('does not become a claim about the programme\'s standing', () => {
    const t = text(render('SMU'));
    for (const claim of [/championship-level/i, /title-winning programme/i, /a winner/i]) {
      expect(t).not.toMatch(claim);
    }
  });
});

describe('a postseason result is named, not ranked', () => {
  const rounds = {
    champion: 'Washington',
    r32: 'High Point',
    r16: 'Georgetown',
    final: 'Rollins',
  };

  for (const [round, name] of Object.entries(rounds)) {
    it(`names the ${round} result with its season`, () => {
      const post = item(name, 'POSTSEASON_RESULT');
      expect(post.facts.round).toBe(round);
      const copy = fitCopyFor(post);
      expect(copy.headline).toContain(post.qualification.season);
      expect(copy.headline).toMatch(/title|final|semi|quarter|round of|postseason/i);
    });
  }

  it('refuses a round it has never seen rather than guessing', () => {
    expect(fitCopyFor({ kind: 'POSTSEASON_RESULT', facts: { round: 'play-in' }, qualification: {} }))
      .toBeNull();
  });

  it('assigns no score or ordering between rounds', () => {
    const champ = text(render('Washington'));
    const early = text(render('Georgetown'));
    // Neither is described as better, further or stronger than anything.
    for (const claim of [/further than/i, /deeper run/i, /only reached/i, /as far as/i,
      /better than/i, /stronger than/i]) {
      expect(champ).not.toMatch(claim);
      expect(early).not.toMatch(claim);
    }
  });
});

describe('momentum reports the classification the server made', () => {
  it('names the RISING classification without embellishing it', () => {
    const momentum = item('Jacksonville', 'PROGRAM_MOMENTUM');
    expect(momentum.facts.classification).toBe('RISING');
    const copy = fitCopyFor(momentum);
    expect(copy.headline).toContain('classified as rising');
    expect(copy.detail).toContain(`${Math.round(momentum.facts.recentWinPct * 100)}%`);
    expect(copy.detail).toContain(`${Math.round(momentum.facts.priorWinPct * 100)}%`);
  });

  it('does not describe a STRONG programme as improving', () => {
    const strong = fitCopyFor({
      kind: 'PROGRAM_MOMENTUM',
      facts: { classification: 'STRONG', recentWinPct: 0.8, priorWinPct: 0.79 },
      qualification: { season: 'recent vs prior two seasons' },
    });
    // The server did not call a direction for STRONG, so neither does this.
    expect(strong.headline).not.toMatch(/rising|improv|upward/i);
    expect(strong.detail).not.toMatch(/\bup from\b|\bagainst\b/);
  });

  it('computes no direction of its own', () => {
    // Fed figures that fall, the copy still reports the classification it was
    // given rather than reading the two numbers.
    const contradictory = fitCopyFor({
      kind: 'PROGRAM_MOMENTUM',
      facts: { classification: 'RISING', recentWinPct: 0.2, priorWinPct: 0.9 },
      qualification: {},
    });
    expect(contradictory.headline).toContain('rising');
    expect(contradictory.detail).toContain('20%');
    expect(contradictory.detail).toContain('90%');
  });

  it('refuses a classification it has never seen', () => {
    expect(fitCopyFor({ kind: 'PROGRAM_MOMENTUM', facts: { classification: 'FALLING' }, qualification: {} }))
      .toBeNull();
  });
});

describe('each claim carries the window it covers', () => {
  it('renders the momentum window as a phrase, not a year', () => {
    const momentum = item('Jacksonville', 'PROGRAM_MOMENTUM');
    // This kind's `season` reads "recent vs prior two seasons" where the other
    // two carry "2025". Putting it in the headline would produce "in recent vs
    // prior two seasons".
    expect(momentum.qualification.season).toBe('recent vs prior two seasons');
    expect(fitCopyFor(momentum).headline).not.toContain('recent vs prior');
    expect(text(render('Jacksonville'))).toContain('Measured over recent vs prior two seasons');
  });

  it('puts a dated result\'s season in its own headline', () => {
    expect(fitCopyFor(item('Georgetown', 'POSTSEASON_RESULT')).headline).toContain('2025');
  });

  it('gives the academic match no season at all', () => {
    const academic = item('Wake Forest', 'ACADEMIC_FIT');
    // It carries none — the subject is taught or it is not.
    expect(academic.qualification.season).toBeNull();
    expect(fitCopyFor(academic).when).toBeNull();
  });
});

describe('the groups fill and empty independently', () => {
  it('shows an academic gap beside real results', () => {
    // Georgetown has three results and no academic match.
    const t = text(render('Georgetown'));
    expect(fit('Georgetown').some((i) => i.kind === 'ACADEMIC_FIT')).toBe(false);
    expect(t).toContain('No academic-fit evidence on file.');
    expect(t).toContain('Won the');
    expect(t).not.toMatch(/no academic fit\b/i);
  });

  it('shows a results gap beside a real academic match', () => {
    const t = text(render('Wake Forest'));
    expect(t).toContain('No programme-performance evidence on file.');
    expect(t).toContain('Offers Kinesiology');
    // Absence of a title is not evidence of anything.
    for (const claim of [/has not won/i, /no success/i, /underperform/i, /weak/i]) {
      expect(t).not.toMatch(claim);
    }
  });

  it('shows one restrained line when both groups are empty', () => {
    expect(fit('Charlotte')).toEqual([]);
    const t = text(render('Charlotte'));
    expect(t).toContain('No academic or programme-performance evidence on file');
    // One line, not two empty headings.
    expect(t).not.toContain('Academic match');
    expect(t).not.toContain('Programme results');
  });

  it('shows momentum alone without inventing an academic state', () => {
    // George Mason: one programme measurement and nothing else.
    expect(fit('George Mason').map((i) => i.kind)).toEqual(['PROGRAM_MOMENTUM']);
    const t = text(render('George Mason'));
    expect(t).toContain('No academic-fit evidence on file.');
    expect(t).toContain('classified as rising');
  });
});

describe('the order is the server\'s', () => {
  it('renders the programme results in the order they arrived', () => {
    const t = text(render('High Point'));
    const at = fit('High Point')
      .filter((i) => fitCopyFor(i).scope === 'programme')
      .map((i) => t.indexOf(fitCopyFor(i).headline));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('does not re-rank a list handed to it in another order', () => {
    const reversed = [...fit('High Point')].reverse();
    const t = text(renderToStaticMarkup(createElement(AcademicProgrammeFit, { items: reversed })));
    const order = reversed
      .filter((i) => fitCopyFor(i).scope === 'programme')
      .map((i) => t.indexOf(fitCopyFor(i).headline));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('the section sits beneath the others and changes none of them', () => {
  const full = renderToStaticMarkup(
    createElement(ProgrammeDecision, { model: FIT_FIXTURES.Jacksonville }),
  );
  const t = text(full);

  it('renders after Development', () => {
    expect(t.indexOf('What the athlete’s stated subject matches here'))
      .toBeGreaterThan(t.indexOf('How first-year players have been used here'));
  });

  it('renders after Roster Opportunity and Recruitment Pathway', () => {
    const at = t.indexOf('What the athlete’s stated subject matches here');
    expect(at).toBeGreaterThan(t.indexOf('Current roster structure'));
    expect(at).toBeGreaterThan(t.indexOf('Recruiting history and roster make-up'));
  });

  it('keeps evidence that is also a top reason', () => {
    const reason = FIT_FIXTURES.Jacksonville.topReasons
      .find((r) => r.primary.kind === 'ACADEMIC_FIT');
    expect(reason).toBeTruthy();
    expect(t).toContain('Offers Kinesiology');
  });

  it('adds detail the reason does not carry', () => {
    // The Top Reason names the subject. The section adds what it was matched
    // against and says what the match is not.
    expect(t).toContain('not about entry requirements or a place');
    expect(t).toContain('Measured over recent vs prior two seasons');
  });

  it('leaves the three sections above it untouched', () => {
    expect(t).toContain('3 defenders in the graduating class');
    expect(t).toContain('Recruiting history and roster make-up');
    expect(t).toContain('How first-year players have been used here');
  });

  it('renders no raw JSON or backend vocabulary', () => {
    expect(full).not.toContain('{"');
    expect(full).not.toContain('[object Object]');
    for (const leak of ['ACADEMIC_FIT', 'PROGRAM_MOMENTUM', 'CONFERENCE_TITLE', 'RISING',
      'STRONG', 'r16', 'r32', 'matchedProgramme', 'statedByAthlete', 'minConfidence',
      'requiresWindow', 'requiresComparison', 'dedupeGroup']) {
      expect(t).not.toContain(leak);
    }
  });
});

describe('a caveat is not attached to data it does not describe', () => {
  it('shows no freshness note, because the freshness is the roster\'s', () => {
    // All four kinds read from `colleges` columns, and every one of them
    // carries the roster scrape's freshness from the shared programme context.
    for (const name of Object.keys(FIT_FIXTURES)) {
      for (const i of fit(name)) {
        expect(i.qualification.source).toMatch(/^colleges:/);
      }
    }
    // George Mason's roster stamp is missing, which produced "no scrape date
    // on these roster rows" beneath a win percentage — a warning about a
    // figure the roster has nothing to do with.
    const momentum = item('George Mason', 'PROGRAM_MOMENTUM');
    expect(momentum.qualification.freshness.state).not.toBe('CURRENT');
    expect(text(render('George Mason'))).not.toContain('roster rows');
    expect(text(render('George Mason'))).not.toMatch(/scrape|stale/i);
  });

  it('still shows the momentum window, which does describe the claim', () => {
    expect(text(render('George Mason'))).toContain('Measured over recent vs prior two seasons');
  });
});
