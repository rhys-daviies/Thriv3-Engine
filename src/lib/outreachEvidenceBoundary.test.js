import { describe, it, expect } from 'vitest';
import {
  buildEmailContext, emailBodyFor, TEMPLATE_VARIABLES, DEFAULT_EMAIL_TEMPLATE,
  DEFAULT_EMAIL_SUBJECT,
} from '@/lib/emailTemplate';
import { FORBIDDEN_MAJOR_PHRASES } from '@/lib/matchmakingV2View';

/**
 * =============================================================================
 * WHAT A COACH MAY BE TOLD — A9.5 §N, §O.
 *
 * Two boundaries, and both are about things that would be true internally and
 * wrong to send.
 *
 * INTERNAL MATCHMAKING REASONING is for the consultant. A rank, a Pursuit
 * score, a band name and a layer value are all statements about how Thriv3
 * sorted a list of 1,205 programmes for one athlete. None of them is a fact
 * about the coach's programme, none was built to be read by the person being
 * written to, and "Thriv3 ranked you #37" is a sentence no recruiting email
 * should ever contain.
 *
 * SAFE OUTREACH EVIDENCE is the separate, already-governed thing the evidence
 * engine produces.
 *
 * The second boundary is A8.2's. Major evidence is PARTIAL POSITIVE: absence
 * from `notable_majors` establishes nothing, so outreach copy may say a school
 * offers a major and may never say it does not.
 *
 * Nothing here changes the email path. These tests pin a boundary that
 * currently holds by construction, because the construction is one careless
 * `else` away from not holding.
 * =============================================================================
 */

const PLAYER = {
  id: 'p1',
  full_name: 'Test Athlete',
  position: 'Midfielder',
  recruiting_class_year: 2028,
  sport: 'mens-soccer',
  intended_major: 'exercise science',
};

const college = (notableMajors) => ({
  name: 'Example College',
  division: 'NCAA D1',
  conference: 'Example Conference',
  city: 'Townsville',
  state: 'CA',
  notable_majors: notableMajors,
});

/** Every string a context hands to a template, flattened. */
const stringsOf = (ctx) => Object.values(ctx).filter((v) => typeof v === 'string');

describe('A9.5 §O. major evidence in outreach is positive-only', () => {
  it('O1. a MATCHED major may be stated', () => {
    const ctx = buildEmailContext(PLAYER, college(['Kinesiology', 'Business']), 'Coach Smith');
    expect(ctx.offers_intended_major).toBe('true');
    expect(ctx.intended_major_stated).toBeTruthy();
  });

  it('O2. an UNMATCHED major produces silence, never a negative claim', () => {
    /**
     * THE A8.2 BOUNDARY AT THE OUTREACH EDGE.
     *
     * 321 of 349 Division I women's programmes omit Mathematics from
     * `notable_majors`, Penn State and Ohio State among them, and all of them
     * grant mathematics degrees. So a school whose list does not name the
     * athlete's major has established NOTHING, and the only safe output is no
     * clause at all.
     */
    const ctx = buildEmailContext(PLAYER, college(['History', 'Philosophy']), 'Coach Smith');
    expect(ctx.offers_intended_major).toBe('');

    for (const s of stringsOf(ctx)) {
      for (const banned of FORBIDDEN_MAJOR_PHRASES) {
        expect(s.toLowerCase(), `"${banned}" in email context`).not.toContain(banned);
      }
    }
  });

  it('O3. no notable_majors at all is also silence', () => {
    for (const majors of [[], null, undefined]) {
      const ctx = buildEmailContext(PLAYER, college(majors), 'Coach Smith');
      expect(ctx.offers_intended_major).toBe('');
      for (const s of stringsOf(ctx)) {
        for (const banned of FORBIDDEN_MAJOR_PHRASES) {
          expect(s.toLowerCase()).not.toContain(banned);
        }
      }
    }
  });

  it('O4. a rendered email never carries an absent-major claim, in any of the cases', () => {
    for (const majors of [['History'], [], null, ['Kinesiology']]) {
      const body = emailBodyFor(PLAYER, college(majors), 'Coach Smith', {
        template: DEFAULT_EMAIL_TEMPLATE,
      });
      const text = `${JSON.stringify(body)}`.toLowerCase();
      for (const banned of FORBIDDEN_MAJOR_PHRASES) {
        expect(text, `"${banned}" rendered for ${JSON.stringify(majors)}`).not.toContain(banned);
      }
    }
  });

  it('O5. the gate is a positive membership test, so absence cannot reach a template', () => {
    /**
     * `offers_intended_major` is deliberately NOT in TEMPLATE_VARIABLES, so no
     * saved template can branch on it at all — the only consumer is
     * `shared/email/blocks.js`, which can narrow a decision the engine already
     * made and never widen one.
     */
    /**
     * `token`, not `name`. The first draft of this read `v.name ?? v`, which
     * yielded the OBJECTS — and `not.toContain('offers_intended_major')` over
     * a list of objects passes no matter what the list holds. It proved
     * nothing until it was read against the real shape.
     */
    const tokens = TEMPLATE_VARIABLES.map((v) => v.token);
    expect(tokens.length).toBeGreaterThan(10);
    expect(tokens).not.toContain('offers_intended_major');
  });
});

describe('A9.5 §N. internal matchmaking reasoning does not reach coach copy', () => {
  const MATCHMAKING_WORDS = [
    'pursuit', 'recruitability', 'priority outreach', 'strong pursuit',
    'viable consideration', 'broader universe', 'limited_data', 'matchmaking',
    'ranked #', 'rank #', 'coverage', 'unscoreable', 'measured evidence',
  ];

  it('N1. no V2 vocabulary appears in the email context for any major case', () => {
    for (const majors of [['Kinesiology'], ['History'], []]) {
      const ctx = buildEmailContext(PLAYER, college(majors), 'Coach Smith');
      for (const s of stringsOf(ctx)) {
        for (const word of MATCHMAKING_WORDS) {
          expect(s.toLowerCase(), `"${word}" in email context`).not.toContain(word);
        }
      }
    }
  });

  it('N2. no template variable offers a rank, a score or a band', () => {
    const names = TEMPLATE_VARIABLES.map((v) => v.token.toLowerCase());

    /**
     * "score" ALONE IS THE WRONG TEST, and a first draft of this used it.
     *
     * It matched `player_sat_score`, `player_act_score` and their two `has_`
     * gates — the ATHLETE'S OWN test results, which are legitimately in a
     * recruiting email and have nothing to do with matchmaking. Banning the
     * substring would have forced those four out of the product to satisfy a
     * test, which is the tail wagging the dog.
     *
     * The boundary is about THRIV3'S INTERNAL NUMBERS, so the list names them.
     */
    for (const word of ['rank', 'pursuit', 'recruitability', 'match_score',
      'matchmaking', 'band', 'coverage', 'opportunity']) {
      expect(names.filter((n) => n.includes(word)), word).toEqual([]);
    }
    /** And the four athlete-owned score tokens are still present and allowed. */
    expect(names).toContain('player_sat_score');
  });

  it('N3. the default template and subject contain no matchmaking vocabulary', () => {
    const text = `${DEFAULT_EMAIL_TEMPLATE} ${DEFAULT_EMAIL_SUBJECT}`.toLowerCase();
    for (const word of MATCHMAKING_WORDS) {
      expect(text, word).not.toContain(word);
    }
  });

  it('N4. the email module does not import the V2 engine or its runs', () => {
    /**
     * A source assertion, because the boundary that matters is "this code
     * cannot see those numbers", not "this code does not currently print
     * them". A9.5 adds no adapter between them, and this is what keeps the
     * next phase from adding one by accident.
     */
    const src = emailBodyFor.toString() + buildEmailContext.toString();
    expect(src).not.toMatch(/matchmaking|pursuit|recruitability/i);
  });
});
