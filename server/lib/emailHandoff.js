import { assertAddress, assertHeaderSafe, RFC822_REFUSAL } from './rfc822.js';
import { textToHtml } from '../../shared/emailHtml.js';

/**
 * ONE PREPARED EMAIL, HANDED TO A BROWSER TO HAND TO A MAIL CLIENT — R2B.
 *
 * ===========================================================================
 * THE SERVER DECIDES WHAT THE EMAIL IS. THE BROWSER IS A COURIER.
 *
 * Until R2B the transport was AppleScript: `composeInOutlook` handed five
 * values to `osascript` as argv, and `sendOutreach.js` refused outright on any
 * platform that is not macOS. Render is Linux, so hosted manual drafting was
 * impossible — see the platform note in sendOutreach.js.
 *
 * The replacement moves the LAST step into the operator's browser and nothing
 * else. Every decision that was made on the server is still made on the
 * server: the recipient, the subject, the personalised body, the tracking
 * link and the compliance footer are all composed, validated and PERSISTED
 * before this function is reached, and this turns that persisted row into
 * something a browser can put on a clipboard and open a compose window with.
 *
 * Nothing here composes. Nothing here personalises. Nothing here appends a
 * footer or substitutes a token. If a value is wrong it is refused, never
 * corrected — a corrected value would be an email nobody reviewed.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * WHY THE BODY IS NOT IN THE `mailto:` URL, WHICH IS THE WHOLE DESIGN.
 *
 * RFC 6068 gives `mailto:` a `body` pseudo-header, and using it would make
 * this a one-click handoff with no paste. It was measured rather than
 * assumed, against a real Thriv3 email rendered from DEFAULT_EMAIL_TEMPLATE
 * with four evidence sentences, the academic lines and a real tracking URL:
 *
 *     body                1,355 characters
 *     full mailto: URL    2,007 characters
 *
 * Two thousand characters is the accepted safe ceiling across browsers and
 * OS-level URL handlers, and a realistic email is already past it. The
 * failure mode is SILENT TRUNCATION, and what truncates is the END of the
 * body — which is where the CAN-SPAM footer lives. An email would reach a
 * coach without its sender identity, postal address or opt-out, and nothing
 * would say so.
 *
 * RFC 6068 also settles the fidelity question: the `body` value "is intended
 * to contain the content for the first TEXT/PLAIN body part", and Content-*
 * header fields in a mailto "MUST be ignored". So the URL could never carry
 * the HTML that shared/emailHtml.js produces — the profile link and the
 * WhatsApp `tel:` link would arrive in front of a coach as literal markdown.
 *
 * So the URL carries only what it is reliable at — one recipient and a
 * subject, about 120 characters — and the body travels on the clipboard as
 * BOTH text/html and text/plain. The operator presses one extra key and the
 * coach receives exactly the message the AppleScript path produced.
 * ---------------------------------------------------------------------------
 *
 * NO CC. NO BCC. NO From. NO ARBITRARY HEADERS. One email per coach is not a
 * style choice: attribution is per (athlete, coach) and the tracking token in
 * the body differs per relationship, so a second recipient on one message
 * would credit one coach's reading to another. A `From` is meaningless here
 * anyway — the operator's own mail client owns the sending identity, which is
 * the point of the whole architecture.
 */

/** Why a prepared email could not be handed over. Every one is a refusal. */
export const HANDOFF_REFUSAL = Object.freeze({
  /** The recipient is not a single plain address. Reuses rfc822's code. */
  ADDRESS_INVALID: RFC822_REFUSAL.ADDRESS_INVALID,
  /** A control character reached the subject. Reuses rfc822's code. */
  HEADER_UNSAFE: RFC822_REFUSAL.HEADER_UNSAFE,
  /**
   * The address is a valid addr-spec but carries a character that is
   * STRUCTURAL in a URI. See RECIPIENT_URI_UNSAFE below.
   */
  ADDRESS_URI_UNSAFE: 'ADDRESS_URI_UNSAFE',
  /** There is nothing to hand over. */
  BODY_REQUIRED: 'BODY_REQUIRED',
});

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * THE GAP BETWEEN "A VALID ADDRESS" AND "SAFE IN A URL", AND IT IS REAL.
 *
 * ---------------------------------------------------------------------------
 * `coaches.email` HAS NEVER BEEN VALIDATED, AND UNTIL NOW IT DID NOT MATTER.
 *
 * `findOrCreateCoach` accepts any non-empty string that is not "n/a" — no
 * format check at all. That has been safe for as long as the only transport
 * was AppleScript, where the address is one element of argv and a comma or a
 * question mark in it is inert text. Coach addresses arrive from operator CSV
 * imports, so this is lower-trust data than it looks.
 *
 * A `mailto:` URL is a completely different substrate. `?` opens the header
 * section, `&` starts another header, `,` adds a recipient and `#` starts a
 * fragment. `coach?bcc=attacker@evil.example@school.edu` is an injection.
 * ---------------------------------------------------------------------------
 *
 * `assertAddress` catches most of it — it already refuses whitespace, commas,
 * semicolons, angle brackets, quotes, parentheses, square brackets and
 * backslashes — but it was written for RFC 5322 headers, where `?`, `&`, `=`,
 * `#`, `/` and `%` are ordinary characters. They are not ordinary here.
 *
 * REFUSED RATHER THAN PERCENT-ENCODED, and that is the deliberate choice. The
 * address IS percent-encoded below as well, so encoding alone would be
 * sufficient to make the URL safe — but an address containing one of these
 * characters is not a deliverable address, it is a row somebody should look
 * at. Encoding it silently would put a broken recipient in a compose window
 * and let the operator discover it on the bounce. Belt and braces, and the
 * refusal is the load-bearing half.
 */
const RECIPIENT_URI_UNSAFE = /[/?#[\]&;=%,]/;

/**
 * The address, encoded for the one position it appears in.
 *
 * `encodeURIComponent` covers the RFC 6068 requirement — non-ASCII becomes
 * UTF-8 percent-encoding, and every reserved character is escaped. `@` is put
 * back because RFC 6068's ABNF makes it the literal separator in <addr-spec>
 * (`addr-spec = local-part "@" domain`), and `%40` there is read by some
 * handlers as part of the local part.
 *
 * ENCODED EXACTLY ONCE. RFC 6068 §7 warns specifically about double-escaping,
 * and the way that happens is two layers each believing the other did not.
 * This is the only place in the handoff where a URL is built; the client is
 * handed a finished `mailtoUrl` and encodes nothing.
 */
const encodeAddress = (address) => encodeURIComponent(address).replace(/%40/g, '@');

/**
 * The `mailto:` URL, carrying a recipient and a subject and deliberately
 * nothing else.
 *
 * Exported so a test can assert on the URL without building a whole handoff,
 * and so that the "no body, no cc, no bcc, no headers" property has one place
 * it can be violated rather than several.
 */
export function mailtoUrlFor({ to, subject }) {
  const address = assertRecipient(to);
  const subjectText = assertHeaderSafe('Subject', subject ?? '');
  return `mailto:${encodeAddress(address)}?subject=${encodeURIComponent(subjectText)}`;
}

/** Both checks, in the order that gives the more specific message. */
function assertRecipient(to) {
  const address = assertAddress('To', to);
  const bad = RECIPIENT_URI_UNSAFE.exec(address);
  if (bad) {
    throw fail(HANDOFF_REFUSAL.ADDRESS_URI_UNSAFE,
      `The recipient address carries "${bad[0]}", which is structural in a mailto URL. `
      + 'Nothing was handed over — correct the address on the coach record.');
  }
  return address;
}

/**
 * One prepared email, from the row that recorded it.
 *
 * ---------------------------------------------------------------------------
 * THE CALLER PASSES WHAT `outreach_send` HOLDS, NOT WHAT IT INTENDED TO WRITE.
 *
 * This function is pure so that it can be tested without a database, which
 * means it cannot enforce that on its own — the enforcement is at the call
 * site in sendOutreach.js, which reads the row back with `sendById` after
 * `recordDraft` returns and passes THAT row's `subject` and `body`. The
 * consequence is the property the whole design rests on: the bytes an
 * operator is handed are the bytes Thriv3 recorded, and there is no path by
 * which the two can disagree.
 *
 * The recipient is the exception and comes from the canonical `coaches` row
 * that `findOrCreateCoach` returned, because `outreach_send.recipient_email`
 * is a campaign-execution column that `recordDraft` never writes. That row is
 * what `outreach_send.coach_id` points at, so it is the same authority by a
 * different column — never the address in the request body.
 * ---------------------------------------------------------------------------
 *
 * `bodyHtml` is `textToHtml`, the SAME function the AppleScript path hands to
 * Outlook's `content` property. Not a second renderer: a second renderer is
 * two escaping implementations and one of them is eventually wrong. It
 * escapes `&`, `<`, `>` and `"`, and its anchor scheme allowlist is http,
 * https, tel and mailto — so a template cannot put `javascript:` in front of
 * a coach, on this path either.
 *
 * @returns {{sendId, coachId, to, subject, body, bodyHtml, mailtoUrl}}
 */
export function buildHandoff({ sendId, coachId, to, subject, body }) {
  const address = assertRecipient(to);
  const subjectText = assertHeaderSafe('Subject', subject ?? '');

  if (body === null || body === undefined || String(body) === '') {
    throw fail(HANDOFF_REFUSAL.BODY_REQUIRED,
      'There is no body to hand over. The draft records one before this is reached.');
  }
  const bodyText = String(body);

  return {
    sendId: sendId ?? null,
    coachId: coachId ?? null,
    to: address,
    subject: subjectText,
    // Verbatim. What the operator pastes is what the row holds.
    body: bodyText,
    bodyHtml: textToHtml(bodyText),
    mailtoUrl: `mailto:${encodeAddress(address)}?subject=${encodeURIComponent(subjectText)}`,
  };
}
