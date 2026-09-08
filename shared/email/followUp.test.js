import { describe, it, expect } from 'vitest';
import { BLOCK_COPY, fragmentFor, FOLLOW_UP_FRAMING } from './blocks.js';
import { composeOutreach } from './compose.js';
import {
  BLOCKS, FLOWS, FLOW_KEYS, FLOW_PREFERENCE, eligibleFlows, resolveStructure,
  followUpStructure, FOLLOW_UP_KEY,
} from '../evidence/structures.js';
import { outreachEvidenceFor, applyPrefer } from '../evidence/outreachEvidence.js';
import { evidenceStrategyForMessage, SEQUENCE_STATUS } from '../evidence/sequenceStrategy.js';
import { defineEvidence, CONFIDENCE } from '../evidence/kinds.js';
import {
  fillTemplate, buildEmailContext, unresolvedTokens,
} from '../../src/lib/emailTemplate.js';

/**
 * C3 — the follow-up, as a coach would read it.
 *
 * Three properties carry the slice:
 *
 *   1. AN INITIAL EMAIL CANNOT REACH THIS. The follow-up sits outside FLOWS,
 *      outside FLOW_PREFERENCE and outside resolveStructure, so no evidence
 *      and no operator request can produce one.
 *   2. IT IS A CONTINUATION, NOT A SECOND COLD EMAIL. No re-introduction, no
 *      credentials, no repeated congratulation, one ask, and the same fact
 *      framed as an additional reason rather than a first discovery.
 *   3. NOTHING NEW TO SAY IS A VALID FOLLOW-UP. It does not resend the first
 *      email's reasons under a "following up" line.
 *
 * The fixtures deliberately avoid ARRIVAL_SAME_REGION_POSITION: the concurrent
 * K3 stream is actively changing its qualification and copy, and a fixture
 * pinned to a moving contract would be a trap for whoever next runs this file.
 * CURRENT_SAME_COUNTRY and HISTORICAL_SAME_COUNTRY are the same dedupe group
 * and are stable.
 */

const flow = (key, over = {}) => ({ key, ...FLOWS[key], ...over });

const ev = (kind, data) => defineEvidence(kind, {
  source: 'roster_players', confidence: CONFIDENCE.HIGH, season: '2022-2025', data,
});

const NZ_NOW = () => ev('CURRENT_SAME_COUNTRY', { country: 'New Zealand', count: 1, names: ['A Player'] });
const NZ_PAST = () => ev('HISTORICAL_SAME_COUNTRY', { country: 'New Zealand', count: 2, names: ['A', 'B'], seasons: ['2022'] });
const GRAD = () => ev('POSITION_GRADUATION', { position: 'DEFENSE', count: 3, names: ['P', 'Q', 'R'], classYear: 2027 });
const ACAD = () => ev('ACADEMIC_FIT', { stated: 'exercise science', major: 'Kinesiology' });
const TITLE = () => ev('CONFERENCE_TITLE', { conference: 'ACC' });

const player = {
  full_name: 'Rhys Davies',
  position: 'DEFENSE',
  nationality: 'New Zealand',
  recruiting_class_year: 2027,
  gpa: 3.6,
  intended_major: 'exercise science',
  email_template: null,
};
const college = { name: 'Example University', division: 'NCAA D1', notable_majors: ['Kinesiology'] };

/** The production composer, for whichever message this is. */
function composeFor(items, { step = 1, sent = [], flowKey = null } = {}) {
  const roles = outreachEvidenceFor({ all: items });
  const byKind = new Map(items.map((e) => [e.kind, e]));
  const ctx = { firstName: 'Rhys' };

  if (step === 1) {
    const key = flowKey ?? eligibleFlows({ roles })[0];
    return { ...composeOutreach(flow(key), roles, byKind, ctx), roles, strategy: null };
  }

  const strategy = evidenceStrategyForMessage({ outreach: roles, step, previouslySentKinds: sent });
  const wanted = strategy.preferredForThisMessage ?? [];
  const applied = wanted.length
    ? { ...applyPrefer(roles, wanted), operatorSelected: false }
    : { ...roles, hooks: [], relevance: [], recognition: [], hasPersonalisation: false };
  return {
    ...composeOutreach(followUpStructure(), applied, byKind, ctx),
    roles, strategy,
  };
}

const render = ({ template, tokens }) => fillTemplate(template, {
  ...buildEmailContext(player, college, 'Coach', { profileUrl: 'https://example.test/p/x' }),
  ...tokens,
});

const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;

// ---------------------------------------------------------------------------

describe('an initial email cannot become a follow-up', () => {
  it('is not one of the flows the engine chooses between', () => {
    expect(FLOW_KEYS).toEqual(['RELATIONSHIP_FIRST', 'PLAYER_FIRST']);
    expect(FLOW_PREFERENCE).toEqual(['RELATIONSHIP_FIRST', 'PLAYER_FIRST']);
    expect(FLOW_KEYS).not.toContain(FOLLOW_UP_KEY);
    expect(FLOWS[FOLLOW_UP_KEY]).toBeUndefined();
  });

  it('is unreachable through eligibility or an operator request', () => {
    const roles = outreachEvidenceFor({ all: [NZ_NOW(), GRAD(), ACAD()] });
    expect(eligibleFlows({ roles })).toEqual(['RELATIONSHIP_FIRST', 'PLAYER_FIRST']);

    // An operator asking for it by name is refused, like any unknown flow.
    const asked = resolveStructure({ roles }, FOLLOW_UP_KEY);
    expect(asked.key).not.toBe(FOLLOW_UP_KEY);
    expect(asked.refusedRequest).toMatchObject({ key: FOLLOW_UP_KEY, reason: 'unknown flow' });
  });

  it('records that the sequence chose it, not the engine or an operator', () => {
    // ENGINE would claim a selection that never happened; OPERATOR would claim
    // a person made a choice they were never offered.
    expect(followUpStructure().source).toBe('SEQUENCE');
  });
});

// ---------------------------------------------------------------------------

describe('the follow-up is a continuation, not a second cold email', () => {
  const items = [NZ_NOW(), GRAD(), ACAD()];

  it('drops the re-introduction, the credentials and the congratulation', () => {
    const blocks = followUpStructure().blocks;
    expect(blocks).toEqual([
      BLOCKS.GREETING, BLOCKS.RECONNECT, BLOCKS.RELEVANCE,
      BLOCKS.PROFILE, BLOCKS.CTA, BLOCKS.SIGNOFF,
    ]);
    for (const dropped of [BLOCKS.ATHLETE_INTRO, BLOCKS.CREDENTIALS,
      BLOCKS.RECOGNITION, BLOCKS.HOOK]) {
      expect(blocks).not.toContain(dropped);
    }
  });

  it('does not introduce the athlete again', () => {
    const body = render(composeFor(items, { step: 2, sent: ['CURRENT_SAME_COUNTRY'] }));
    // The first email said "I'm reaching out about Rhys Davies, a defender
    // from New Zealand looking at options for the 2027 class." Saying it again
    // is the clearest possible signal that nobody remembers writing.
    expect(body).not.toMatch(/I'm reaching out about/);
    expect(body).not.toMatch(/looking at options for the/);
    expect(body).toContain('Following up on my note about Rhys Davies.');
  });

  it('does not repeat the credentials the first email already carried', () => {
    const body = render(composeFor(items, { step: 2, sent: ['CURRENT_SAME_COUNTRY'] }));
    expect(body).not.toMatch(/GPA:/);
    expect(body).not.toMatch(/SAT:|ACT:/);
  });

  it('asks once, and asks the same question', () => {
    const body = render(composeFor(items, { step: 2, sent: ['CURRENT_SAME_COUNTRY'] }));
    expect(body).toContain('Would still be great to hear your thoughts on Rhys');
    // The initial CTA's second move — an offer plus a phone number — is a
    // second ask on top of an unanswered first.
    expect(body).not.toMatch(/WhatsApp/);
    expect(body).not.toMatch(/happy to send over anything else/);
    expect((body.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it('keeps the profile link, because it is how the coach acts', () => {
    const body = render(composeFor(items, { step: 2, sent: ['CURRENT_SAME_COUNTRY'] }));
    expect(body).toContain('https://example.test/p/x');
  });

  it('leaves no unresolved token', () => {
    const composed = composeFor(items, { step: 2, sent: ['CURRENT_SAME_COUNTRY'] });
    const context = {
      ...buildEmailContext(player, college, 'Coach', { profileUrl: 'https://example.test/p/x' }),
      ...composed.tokens,
    };
    expect(unresolvedTokens(composed.template, context)).toEqual([]);
  });

  it('is materially shorter than the initial email it follows', () => {
    const initial = render(composeFor(items, { step: 1 }));
    const followUp = render(composeFor(items, { step: 2, sent: ['CURRENT_SAME_COUNTRY'] }));

    // Relative, not an invented absolute: the initial email's length is a
    // moving product decision and this must stay true as it moves.
    expect(words(followUp)).toBeLessThan(words(initial) * 0.7);
    expect(words(followUp)).toBeGreaterThan(20);   // still a real message
  });
});

// ---------------------------------------------------------------------------

describe('the one fresh reason', () => {
  it('uses an unused academic fit when the first email spent the pathway', () => {
    const out = composeFor([NZ_NOW(), ACAD()], { step: 2, sent: ['CURRENT_SAME_COUNTRY'] });
    expect(out.strategy.status).toBe(SEQUENCE_STATUS.NEW_EVIDENCE);
    expect(out.sentences.map((s) => s.kind)).toEqual(['ACADEMIC_FIT']);
    expect(render(out)).toContain('Kinesiology');
  });

  it('uses unused position evidence when the first email spent hook and academic', () => {
    const out = composeFor([NZ_NOW(), GRAD(), ACAD()], {
      step: 2, sent: ['CURRENT_SAME_COUNTRY', 'ACADEMIC_FIT'],
    });
    expect(out.sentences.map((s) => s.kind)).toEqual(['POSITION_GRADUATION']);
  });

  it('renders an unused hook in continuation voice, not as a cold opening', () => {
    const out = composeFor([NZ_PAST(), ACAD()], { step: 2, sent: ['ACADEMIC_FIT'] });
    const body = render(out);

    expect(out.sentences.map((s) => s.kind)).toEqual(['HISTORICAL_SAME_COUNTRY']);
    // The same fact the copy registry produces for an initial email...
    expect(body).toContain('New Zealand');
    // ...doing a different job. "I was having a look through your program and
    // noticed" would tell a coach we had just found their programme, in the
    // message where we are following up on having written about it.
    expect(body).toContain(FOLLOW_UP_FRAMING);
    expect(body).not.toMatch(/I was having a look through your program/);
    expect(body).not.toMatch(/^I saw /m);
    // And it lands in the relevance slot, because the follow-up has no hook.
    expect(out.sentences[0].slot).toBe(BLOCKS.RELEVANCE);
  });

  it('never repeats a dedupe group the first email already used', () => {
    // "You have a New Zealander now" was sent; "you've had New Zealanders
    // before" is the same connection said another way.
    const out = composeFor([NZ_PAST(), NZ_NOW()], { step: 2, sent: ['CURRENT_SAME_COUNTRY'] });
    expect(out.strategy.status).toBe(SEQUENCE_STATUS.NO_NEW_EVIDENCE);
    expect(out.sentences).toEqual([]);
  });

  it('carries at most one', () => {
    const out = composeFor([NZ_NOW(), GRAD(), ACAD()], { step: 2, sent: [] });
    expect(out.sentences).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('a follow-up with nothing new to say', () => {
  const spent = ['CURRENT_SAME_COUNTRY', 'POSITION_GRADUATION', 'ACADEMIC_FIT'];

  it('still reads as a message, and makes no programme claim', () => {
    const out = composeFor([NZ_NOW(), GRAD(), ACAD()], { step: 2, sent: spent });
    const body = render(out);

    expect(out.strategy.status).toBe(SEQUENCE_STATUS.NO_NEW_EVIDENCE);
    expect(out.sentences).toEqual([]);
    // Greeting, reconnect, link, ask, sign-off — coherent without inventing
    // anything about the programme.
    expect(body).toContain('Hi Coach,');
    expect(body).toContain('Following up on my note about Rhys Davies.');
    expect(body).toContain('Would still be great to hear your thoughts on Rhys');
    expect(body).toContain('Best regards');
    expect(unresolvedTokens(out.template, {
      ...buildEmailContext(player, college, 'Coach', { profileUrl: 'https://example.test/p/x' }),
      ...out.tokens,
    })).toEqual([]);
  });

  it('does not resend the first email\'s reasons under a following-up line', () => {
    const body = render(composeFor([NZ_NOW(), GRAD(), ACAD()], { step: 2, sent: spent }));
    // The single worst output this phase exists to prevent.
    expect(body).not.toContain('New Zealand');
    expect(body).not.toContain('Kinesiology');
    expect(body).not.toMatch(/graduating|defenders/i);
    expect(body).not.toContain(FOLLOW_UP_FRAMING);
  });

  it('treats a leftover congratulation as nothing new', () => {
    const out = composeFor([ACAD(), TITLE()], { step: 2, sent: ['ACADEMIC_FIT'] });
    const body = render(out);

    expect(out.strategy.status).toBe(SEQUENCE_STATUS.NO_NEW_EVIDENCE);
    // A congratulation is not a reason to write to somebody a second time, and
    // the follow-up structure has no recognition block to put one in anyway.
    expect(body).not.toMatch(/ACC|congrat/i);
    expect(out.sentences).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('what the follow-up did not change', () => {
  const items = [NZ_NOW(), GRAD(), ACAD()];

  it('leaves both initial flows composing exactly as they did', () => {
    // The initial email is chosen, shaped and framed by untouched code: the
    // follow-up is reached only through a step, never through eligibility.
    for (const key of FLOW_KEYS) {
      const composed = composeOutreach(
        flow(key), outreachEvidenceFor({ all: items }),
        new Map(items.map((e) => [e.kind, e])), { firstName: 'Rhys' },
      );
      const body = render(composed);
      expect(body).toContain("I'm reaching out about Rhys Davies");
      expect(body).toContain('WhatsApp');
      expect(body).not.toContain('Following up on my note');
      expect(body).not.toContain(FOLLOW_UP_FRAMING);
    }
  });

  it('adds no CTA variant that conditions the ask on a recruiting need', () => {
    expect(Object.keys(BLOCK_COPY[BLOCKS.CTA])).toEqual(['default', 'followUp']);
    expect(fragmentFor(BLOCKS.CTA)).toBe(BLOCK_COPY[BLOCKS.CTA].default);
  });

  it('makes no claim in either new block', () => {
    // Every fragment here is about the athlete, about us, or is a question.
    // Claims about programmes come from the evidence renderers and nowhere else.
    for (const text of [BLOCK_COPY[BLOCKS.RECONNECT].default, BLOCK_COPY[BLOCKS.CTA].followUp]) {
      expect(text).not.toMatch(/your (roster|squad|program|needs)/i);
      expect(text).not.toMatch(/you (have|need|are looking)/i);
    }
  });
});
