import { createHash } from 'node:crypto';
import { bodyHash } from '../../shared/evidence/sendSnapshot.js';
import {
  PUBLIC_BASE_URL, SENDER_IDENTITY, SENDER_POSTAL_ADDRESS, complianceGaps,
} from './config.js';

/**
 * WHAT A COACH WOULD ACTUALLY RECEIVE — F11c.
 *
 * ===========================================================================
 * TWO CONTENTS, AND THEY ARE NOT THE SAME BYTES.
 *
 *   REVIEWED CONTENT   `programme_messages.subject` / `.body`. The words a
 *                      named operator read and approved. Immutable.
 *   WIRE CONTENT       those words with the tracked profile link substituted
 *                      and the compliance footer appended. What leaves.
 *
 * The difference is not cosmetic and it is not avoidable: the profile link
 * carries a per-relationship token that does not exist until an `outreach` row
 * does, and the footer is a legal requirement that is deliberately NOT a
 * template variable an operator can delete. F10 froze the first; this produces
 * the second, and `executionClaim` says in so many words that it does not.
 * ===========================================================================
 *
 * PURE. It touches no database, reads no row and holds no clock. Every input
 * is handed in, which is what makes the same inputs produce the same bytes —
 * and byte-identity is not an aesthetic here. An ambiguous provider result is
 * resolved by finding the message afterwards, and a body that hashed
 * differently on a retry would make the one message we sent look like two.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT MUST NEVER DO.
 *
 *   It does not personalise. The legacy path rewrites "Dear X," to match a
 *   per-coach name; campaign content was approved as written, and a regex
 *   editing an approved sentence is this layer overruling a person.
 *   It does not re-compose, re-rank evidence or touch the subject.
 *   It does not invent a link. If the approved body carries no
 *   `{{player_profile_url}}`, none is added — see `PROFILE_TOKEN` below.
 * ---------------------------------------------------------------------------
 */

/**
 * THE ONE TOKEN F10 LEAVES UNRESOLVED, and the only one this substitutes.
 *
 * `composeMessage` puts it in every campaign body on purpose: the tracked link
 * is per athlete↔coach and cannot exist at composition time. Whitespace inside
 * the braces is tolerated because the template vocabulary has always tolerated
 * it and an operator editing a reviewed body may introduce it.
 */
export const PROFILE_TOKEN = /\{\{\s*player_profile_url\s*\}\}/g;

/**
 * WHY A BODY COULD NOT BE PUT ON THE WIRE.
 *
 * All four are configuration or provenance, never policy: whether the campaign
 * MAY send is settled long before this is called.
 */
export const CONTENT_REFUSAL = Object.freeze({
  /** No `outreach` row, so no token, so no link. The claim creates it. */
  TRACKING_TOKEN_REQUIRED: 'TRACKING_TOKEN_REQUIRED',
  /** The athlete has no published page for a link to point at. */
  PUBLIC_PROFILE_REQUIRED: 'PUBLIC_PROFILE_REQUIRED',
  /** Nobody configured where that page lives. */
  PUBLIC_BASE_URL_REQUIRED: 'PUBLIC_BASE_URL_REQUIRED',
  /** CAN-SPAM §7704(a)(5) needs a sender identity and a postal address. */
  COMPLIANCE_CONFIGURATION_REQUIRED: 'COMPLIANCE_CONFIGURATION_REQUIRED',
});

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * THE TRACKED LINK, IN THE SHAPE THE PRODUCT ALREADY USES.
 *
 * Copied in form from `sendOutreach`, which is the only thing that has ever
 * built one — a second URL shape would be a second tracking identity, and the
 * `/u/<token>` and `?ref=<token>` endpoints already in production resolve this
 * one. The token belongs to the RELATIONSHIP, not to the message, so a
 * follow-up reuses it and a retry cannot mint a different link for the same
 * pair. That is the property the whole reconciliation story rests on.
 */
export function trackedProfileUrl({ publicSlug, trackingToken, baseUrl = PUBLIC_BASE_URL }) {
  if (!trackingToken) {
    throw fail(CONTENT_REFUSAL.TRACKING_TOKEN_REQUIRED,
      'This athlete and coach have no outreach relationship yet, so there is no tracked link to '
      + 'put in the message. The execution claim creates one; content cannot be frozen before it.');
  }
  if (!publicSlug) {
    throw fail(CONTENT_REFUSAL.PUBLIC_PROFILE_REQUIRED,
      'This athlete has no published profile page, so a link to it would not resolve.');
  }
  const base = String(baseUrl ?? '').replace(/\/$/, '');
  if (!base) {
    throw fail(CONTENT_REFUSAL.PUBLIC_BASE_URL_REQUIRED,
      'THRIV3_PUBLIC_BASE_URL is not set, so no profile link can be built.');
  }
  return `${base}/p/${publicSlug}.html?ref=${trackingToken}`;
}

/**
 * THE COMPLIANCE FOOTER, BYTE-FOR-BYTE AS THE LEGACY PATH APPENDS IT.
 *
 * Reproduced here rather than imported because `sendOutreach` keeps it as a
 * module-private function inside a route that also opens Outlook — importing
 * it would drag a macOS transport into the campaign path. The bytes are the
 * thing that matters and they are pinned against the original by test.
 *
 * NOT A TEMPLATE VARIABLE, for the reason the legacy comment gives: an operator
 * editing a message can delete a token without noticing what it was for, and
 * the resulting email is unlawful rather than merely worse. It is concatenated
 * every time.
 *
 * TWO BLANK LINES, NOT ONE. The body renders as HTML where a blank line starts
 * a paragraph and a single newline is only a break — with one, the footer ran
 * straight on from the sign-off.
 */
export const OPT_OUT_SENTENCE =
  "If you'd rather not hear from us, just reply and we'll take you off our list.";

export function complianceFooter({ athleteName }) {
  return [
    '', '', '—',
    `Sent by ${SENDER_IDENTITY} on behalf of ${athleteName}.`,
    SENDER_POSTAL_ADDRESS,
    OPT_OUT_SENTENCE,
  ].join('\n');
}

/**
 * TWO HASHES, AND F11c FOUND OUT WHY THE HARD WAY.
 *
 * ---------------------------------------------------------------------------
 * `bodyHash` IS NOT A HASH OF THE BYTES, AND IT IS NOT SUPPOSED TO BE.
 *
 * The canonical helper in `sendSnapshot` NORMALISES before digesting: it
 * rewrites any `?ref=<token>` URL to a fixed placeholder, folds CRLF and
 * trims. That is deliberate and correct for what it is for — comparing what
 * two emails SAID, where the per-coach tracking token is noise that would make
 * every identical message look different.
 *
 * It is exactly wrong for the execution question. "What bytes left this
 * mailbox" cannot be answered by a digest that erases the one field which
 * differs per recipient: two coaches sent the same words would hash the same,
 * and a reconciliation that matched on it would match the wrong message.
 *
 * So both are returned, named for what they mean, and the canonical one is
 * IMPORTED rather than reimplemented — there is no second algorithm here, only
 * the same SHA-256 with and without the analytics normalisation.
 *
 * WHICH ONE `outreach_send.body_hash` SHOULD HOLD IS NOT SETTLED, and F11c
 * does not settle it. The column is written today by `recordDraft` with the
 * canonical value and every existing reader expects that. See the F11c report.
 * ---------------------------------------------------------------------------
 */
export { bodyHash };

/** The digest of the exact transmitted bytes. No normalisation of any kind. */
export const wireBodySha256 = (body) =>
  createHash('sha256').update(String(body), 'utf8').digest('hex');

/* -------------------------------------------------------------------------- */

/**
 * APPROVED WORDS IN, WIRE CONTENT OUT.
 *
 * @param {string} args.reviewedSubject  `programme_messages.subject`
 * @param {string} args.reviewedBody     `programme_messages.body`
 * @param {string} args.athleteName      for the footer's "on behalf of"
 * @param {string} args.publicSlug       the athlete's published page
 * @param {string} args.trackingToken    `outreach.token` — the RELATIONSHIP's
 * @returns {{subject, body, bodyHash, profileUrl, reviewedBodyHash, tokenOccurrences}}
 */
export function resolveWireContent({
  reviewedSubject, reviewedBody, athleteName, publicSlug, trackingToken,
  baseUrl = PUBLIC_BASE_URL,
} = {}) {
  /**
   * CHECKED BEFORE ANYTHING IS BUILT, because a half-composed body that then
   * discovers it has no postal address has already cost the caller a
   * transaction. The legacy path checks the same gaps before its loop, for the
   * same reason.
   */
  const gaps = complianceGaps();
  if (gaps.length) {
    throw fail(CONTENT_REFUSAL.COMPLIANCE_CONFIGURATION_REQUIRED,
      `The compliance footer is not configured — missing ${gaps.join(', ')}. Every commercial `
      + 'email needs a sender identity and a physical postal address.');
  }
  if (typeof reviewedBody !== 'string' || !reviewedBody.trim()) {
    throw fail('REVIEWED_BODY_REQUIRED', 'There are no approved words to send.');
  }
  if (typeof reviewedSubject !== 'string' || !reviewedSubject.trim()) {
    throw fail('REVIEWED_SUBJECT_REQUIRED', 'There is no approved subject to send.');
  }

  const occurrences = (reviewedBody.match(PROFILE_TOKEN) ?? []).length;

  /**
   * THE LINK IS BUILT ONLY IF THE BODY ASKS FOR IT.
   *
   * ---------------------------------------------------------------------
   * EXPLICIT SUBSTITUTION, NEVER INSERTION — and this is the one place this
   * module deliberately differs from the legacy path.
   *
   * `ensureProfileLink` APPENDS a link when the template has no placeholder,
   * because templates predating tracking had none and "an email without the
   * link is an email we learn nothing from". That reasoning does not survive
   * the move to campaign content: an F10 body is composed by
   * `composeMessage`, which always emits the token, and it is then READ AND
   * APPROVED BY A PERSON. If the token is gone, an operator removed it —
   * deliberately or by editing around it — and silently re-adding a
   * paragraph would transmit words nobody reviewed.
   *
   * So a message with no token gets no link, and the analytics loss is the
   * correct price for not editing approved content.
   * ---------------------------------------------------------------------
   */
  const profileUrl = occurrences > 0
    ? trackedProfileUrl({ publicSlug, trackingToken, baseUrl })
    : null;

  const withLink = profileUrl
    ? reviewedBody.replace(PROFILE_TOKEN, profileUrl)
    : reviewedBody;

  /**
   * APPENDED EXACTLY ONCE. The footer is derived from configuration and the
   * athlete's name, so resolving the same message twice produces the same two
   * paragraphs — but it is appended to the REVIEWED body every time, never to
   * a previous result, so there is nothing to accumulate.
   */
  const body = `${withLink}${complianceFooter({ athleteName })}`;

  return {
    /**
     * UNCHANGED, AND THAT IS A DECISION. The subject a person approved is the
     * subject that goes: there is no token in it, no footer belongs in it, and
     * no transport requirement in this build asks for one. A subject rewritten
     * between review and send would make the review a review of half a message.
     */
    subject: reviewedSubject,
    body,
    /** Comparable: what this email SAID, tracking token normalised away. */
    bodyHash: bodyHash(body),
    /** Exact: what would leave the mailbox, byte for byte. */
    wireBodySha256: wireBodySha256(body),
    /** So a caller can prove which approved words these were built from. */
    reviewedBodyHash: bodyHash(reviewedBody),
    profileUrl,
    tokenOccurrences: occurrences,
  };
}
