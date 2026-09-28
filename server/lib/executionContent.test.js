import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveWireContent, trackedProfileUrl, complianceFooter, bodyHash, wireBodySha256,
  PROFILE_TOKEN, CONTENT_REFUSAL, OPT_OUT_SENTENCE,
} from './executionContent.js';
import { bodyHash as snapshotBodyHash } from '../../shared/evidence/sendSnapshot.js';
import { SENDER_IDENTITY, SENDER_POSTAL_ADDRESS, PUBLIC_BASE_URL } from './config.js';

/**
 * WHAT WOULD ACTUALLY LEAVE — the content half of F11c, converged for D4.7.
 *
 * ===========================================================================
 * THE REVIEWED BODY IS NOT THE WIRE BODY, AND BOTH HAVE TO BE TRUE AT ONCE.
 *
 * A person approved words. A coach receives those words plus a tracked link
 * and a legally required footer. F10 froze the first; this produces the second,
 * and the property that matters is that it is a FUNCTION: same approved words,
 * same token, same configuration produce the same bytes, every time.
 *
 * Byte-identity is not tidiness. An ambiguous provider result is settled by
 * finding the message afterwards, and a body that hashed differently on a
 * second look would make one sent message look like two.
 * ===========================================================================
 *
 * NO DATABASE IN THIS FILE, AND THAT IS THE STRONGEST STATEMENT IT MAKES. The
 * helper is pure, so its tests need no fixtures, no rows and no cleanup — if
 * one were ever needed here, the helper would have stopped being pure.
 *
 * The claim-time behaviour of the same helper — freezing, rollback, budget —
 * is executionClaimFreeze.test.js. The read-only preview layer that also calls
 * it (F11's executionResolution) is deliberately NOT on the send path and is
 * not exercised from here.
 */

const codeOf = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const WORDS = { reviewedSubject: 'Duke — 2027 defender', athleteName: 'Marcus Reyes',
  publicSlug: 'marcus-reyes', trackingToken: 'tok-abc' };

/* ========================================================================== */
/* The transformation                                                         */
/* ========================================================================== */

describe('approved words in, wire content out', () => {
  it('substitutes the token and appends the footer, and nothing else', () => {
    const out = resolveWireContent({
      ...WORDS, reviewedBody: 'Hi Coach,\n\nProfile:\n{{player_profile_url}}\n\nRhys',
    });

    expect(out.subject).toBe('Duke — 2027 defender');
    expect(out.profileUrl).toBe(`${PUBLIC_BASE_URL}/p/marcus-reyes.html?ref=tok-abc`);
    expect(out.body).toBe(
      `Hi Coach,\n\nProfile:\n${out.profileUrl}\n\nRhys`
      + `\n\n—\nSent by ${SENDER_IDENTITY} on behalf of Marcus Reyes.\n`
      + `${SENDER_POSTAL_ADDRESS}\n${OPT_OUT_SENTENCE}`,
    );
    /* Every approved word survives verbatim. */
    expect(out.body.startsWith('Hi Coach,\n\nProfile:\n')).toBe(true);
    expect(out.tokenOccurrences).toBe(1);
  });

  /** THE SUBJECT IS NOT TOUCHED. A review of half a message is not a review. */
  it('never rewrites the subject', () => {
    const subject = 'Marcus Reyes | Defender | 2027 | {{not_a_token}}';
    const out = resolveWireContent({ ...WORDS, reviewedSubject: subject, reviewedBody: 'Body.' });
    expect(out.subject).toBe(subject);
  });

  it('replaces every occurrence, and tolerates whitespace in the braces', () => {
    const out = resolveWireContent({
      ...WORDS,
      reviewedBody: 'One {{player_profile_url}} two {{ player_profile_url }} three.',
    });
    expect(out.tokenOccurrences).toBe(2);
    expect(out.body.match(new RegExp(out.profileUrl.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&'), 'g')))
      .toHaveLength(2);
    expect(out.body).not.toMatch(PROFILE_TOKEN);
  });

  /**
   * THE ONE PLACE THIS DELIBERATELY DIFFERS FROM THE LEGACY PATH.
   *
   * `ensureProfileLink` APPENDS a link when a template has no placeholder.
   * That reasoning does not survive review: an F10 body always carries the
   * token, so its absence means a person removed it, and re-adding a paragraph
   * would transmit words nobody approved.
   */
  it('adds no link to a body whose token an operator removed', () => {
    const out = resolveWireContent({ ...WORDS, reviewedBody: 'Hi Coach,\n\nNo link here.\n\nRhys' });
    expect(out.profileUrl).toBeNull();
    expect(out.tokenOccurrences).toBe(0);
    expect(out.body).toBe(`Hi Coach,\n\nNo link here.\n\nRhys${complianceFooter({ athleteName: 'Marcus Reyes' })}`);
    expect(out.body).not.toMatch(/https?:\/\//);
  });

  it('preserves line breaks exactly, including runs of them', () => {
    const body = 'A\n\n\nB\nC\n';
    const out = resolveWireContent({ ...WORDS, reviewedBody: body });
    expect(out.body.startsWith(body)).toBe(true);
  });

  it('never personalises, and holds no regex over the greeting', () => {
    const code = codeOf('server/lib/executionContent.js');
    expect(code).not.toMatch(/personalise|Dear\\s/);
    /* A body addressed to one name comes out addressed to that name. */
    const out = resolveWireContent({ ...WORDS, reviewedBody: 'Dear Coach Frid,\n\nHello.' });
    expect(out.body).toMatch(/^Dear Coach Frid,/);
  });
});

describe('the footer', () => {
  it('is appended exactly once, however many times it is resolved', () => {
    const body = 'Hi.\n\n{{player_profile_url}}';
    const a = resolveWireContent({ ...WORDS, reviewedBody: body });
    const b = resolveWireContent({ ...WORDS, reviewedBody: body });
    expect(b.body).toBe(a.body);
    /* Built from the REVIEWED body each time, so nothing can accumulate. */
    expect((a.body.match(new RegExp(OPT_OUT_SENTENCE, 'g')) ?? [])).toHaveLength(1);
  });

  it('matches the bytes the legacy path appends', () => {
    /* Pinned against sendOutreach's own footer so the two cannot drift. */
    const legacy = fs.readFileSync(path.resolve(process.cwd(), 'server/routes/sendOutreach.js'), 'utf8');
    expect(legacy).toContain("If you'd rather not hear from us, just reply and we'll take you off our list.");
    expect(legacy).toContain('on behalf of');
    expect(complianceFooter({ athleteName: 'X' })).toBe(
      `\n\n—\nSent by ${SENDER_IDENTITY} on behalf of X.\n${SENDER_POSTAL_ADDRESS}\n${OPT_OUT_SENTENCE}`,
    );
  });

  it('is two blank lines, not one', () => {
    expect(complianceFooter({ athleteName: 'X' }).startsWith('\n\n—')).toBe(true);
  });

  it('is counted in both hashes', () => {
    const body = 'Hi.';
    const out = resolveWireContent({ ...WORDS, reviewedBody: body });
    expect(out.bodyHash).not.toBe(out.reviewedBodyHash);
    expect(out.bodyHash).toBe(bodyHash(out.body));
    expect(out.wireBodySha256).toBe(wireBodySha256(out.body));
  });
});

describe('the refusals are configuration, never policy', () => {
  it('refuses without a tracking token, and names the claim as the fix', () => {
    expect(() => resolveWireContent({
      ...WORDS, trackingToken: null, reviewedBody: 'Hi {{player_profile_url}}',
    })).toThrow(expect.objectContaining({ code: CONTENT_REFUSAL.TRACKING_TOKEN_REQUIRED }));
  });

  it('refuses without a published profile page', () => {
    expect(() => resolveWireContent({
      ...WORDS, publicSlug: null, reviewedBody: 'Hi {{player_profile_url}}',
    })).toThrow(expect.objectContaining({ code: CONTENT_REFUSAL.PUBLIC_PROFILE_REQUIRED }));
  });

  it('refuses without a public base url', () => {
    expect(() => trackedProfileUrl({ publicSlug: 's', trackingToken: 't', baseUrl: '' }))
      .toThrow(expect.objectContaining({ code: CONTENT_REFUSAL.PUBLIC_BASE_URL_REQUIRED }));
  });

  it('refuses empty approved words rather than sending a footer on its own', () => {
    expect(() => resolveWireContent({ ...WORDS, reviewedBody: '   ' }))
      .toThrow(expect.objectContaining({ code: 'REVIEWED_BODY_REQUIRED' }));
    expect(() => resolveWireContent({ ...WORDS, reviewedSubject: '', reviewedBody: 'Hi.' }))
      .toThrow(expect.objectContaining({ code: 'REVIEWED_SUBJECT_REQUIRED' }));
  });

  /** A missing token is checked BEFORE anything is built, as the legacy path does. */
  it('checks compliance configuration first', () => {
    const code = codeOf('server/lib/executionContent.js');
    const fn = code.slice(code.indexOf('export function resolveWireContent'));
    expect(fn.indexOf('complianceGaps()')).toBeLessThan(fn.indexOf('PROFILE_TOKEN'));
  });
});

describe('two hashes, because they answer two different questions', () => {
  /** The comparable one is imported, not reimplemented. */
  it('is the send snapshot’s own helper, unchanged', () => {
    for (const s of ['', 'a', 'Hi Coach,\n\nBody.\n', 'x https://t.test/p/a.html?ref=TOK y']) {
      expect(bodyHash(s)).toBe(snapshotBodyHash(s));
    }
  });

  /**
   * THE FINDING THAT JUSTIFIES THE SECOND HASH. The canonical digest rewrites
   * `?ref=<token>` to a fixed placeholder, so two coaches sent identical words
   * hash the SAME — correct for comparing what was said, useless for proving
   * what left.
   */
  it('collapses the tracking token, which is why an exact digest exists too', () => {
    const a = resolveWireContent({ ...WORDS, reviewedBody: 'Hi {{player_profile_url}}' });
    const b = resolveWireContent({ ...WORDS, trackingToken: 'tok-xyz', reviewedBody: 'Hi {{player_profile_url}}' });

    expect(a.profileUrl).not.toBe(b.profileUrl);
    expect(a.bodyHash).toBe(b.bodyHash);              // comparable: same words
    expect(a.wireBodySha256).not.toBe(b.wireBodySha256); // exact: different bytes
  });

  it('both change when the words change', () => {
    const base = resolveWireContent({ ...WORDS, reviewedBody: 'Hi {{player_profile_url}}' });
    const otherWords = resolveWireContent({ ...WORDS, reviewedBody: 'Hi. {{player_profile_url}}' });
    const otherName = resolveWireContent({ ...WORDS, athleteName: 'Someone Else', reviewedBody: 'Hi {{player_profile_url}}' });

    expect(new Set([base, otherWords, otherName].map((x) => x.bodyHash)).size).toBe(3);
    expect(new Set([base, otherWords, otherName].map((x) => x.wireBodySha256)).size).toBe(3);
  });
});

/* ========================================================================== */
/* The helper stays a helper                                                   */
/* ========================================================================== */

describe('the content module itself', () => {
  const code = codeOf('server/lib/executionContent.js');

  it('holds no writer, no reader and no clock', () => {
    expect(code).not.toMatch(/INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/i);
    expect(code).not.toMatch(/db\.prepare|db\.exec|from '\.\.\/db\//);
    expect(code).not.toMatch(/Date\.now|new Date|utcNow|utcToday/);
    expect(code).not.toMatch(/randomUUID|Math\.random/);
  });

  it('reaches no credential, no provider and no transport', () => {
    expect(code).not.toMatch(/mailboxCredential|mailboxCrypto|decrypt|connected_mailbox/);
    expect(code).not.toMatch(/googleapis|google-auth|OAuth2Client|nodemailer|smtp|outlook/i);
    expect(code).not.toMatch(/fetch\(|axios/);
  });

  /** One hash algorithm, imported. A second implementation would be a second answer. */
  it('imports the canonical body hash rather than reimplementing it', () => {
    expect(code).toMatch(/import\s*\{\s*bodyHash\s*\}\s*from\s*'\.\.\/\.\.\/shared\/evidence\/sendSnapshot\.js'/);
    expect(bodyHash).toBe(snapshotBodyHash);
  });
});
