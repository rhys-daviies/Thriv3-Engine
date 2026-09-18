/**
 * ONE EMAIL, AS BYTES — D5.1.
 *
 * ===========================================================================
 * PURE, AND IT DECIDES NOTHING.
 *
 * Every value it puts in a header was frozen by the execution claim before any
 * of this ran: the sender, the recipient, the subject and the body all arrive
 * as arguments and all leave unchanged. This file does not personalise, does
 * not append, does not substitute a token, does not generate an identifier and
 * does not read a clock it was not handed. It turns four strings into an RFC
 * 5322 message and base64url-encodes it, and that is the whole job.
 *
 * ---------------------------------------------------------------------------
 * ADAPTED FROM F11e, WITH ONE DELIBERATE CHANGE: THE Message-ID IS OPTIONAL.
 *
 * F11's encoder REQUIRED a self-assigned Message-ID, because F11 minted one so
 * that an ambiguous send could be settled afterwards by searching for it. That
 * reconciliation is not available to us: it needs `users.messages.list` or
 * `.get`, both of which require `gmail.readonly` — a RESTRICTED scope carrying
 * an annual CASA assessment and a consent screen that asks a teenage recruit
 * for full mailbox read access. We hold `gmail.send` and nothing more.
 *
 * Minting an identifier we cannot act on would invite the belief that we can
 * reconcile. Worse, Google publishes no guarantee that a caller-supplied
 * Message-ID survives at all — the send reference and the Message resource are
 * both silent on it — so the header would be an unverified assumption in the
 * one place assumptions are most expensive.
 *
 * So `internetMessageId` is omitted entirely for the Gmail MVP, the header is
 * simply absent, and Google assigns its own. `assertMessageId` is kept below,
 * unused by the default path, so that a later slice which does mint one has the
 * validation already written and tested rather than re-derived.
 * ---------------------------------------------------------------------------
 *
 * It is separate from the Gmail adapter on purpose. The bytes a coach receives
 * are the thing worth pinning by test, and they should be assertable without
 * a network, a credential or a mailbox anywhere in the picture.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * WHY HEADERS ARE COMPOSED BY HAND RATHER THAN BY A MIME LIBRARY.
 *
 * The honest argument for a library is header injection: a CR or LF smuggled
 * through a subject line ends the header and starts another, and a message
 * with an attacker's `Bcc:` in it is the classic result. That risk is real and
 * it is why `assertHeaderSafe` below exists and is applied to every single
 * value without exception.
 *
 * It is not, however, an argument for nodemailer. This message has five
 * headers and one part. A library that can build multipart trees, resolve
 * attachments, negotiate DKIM and open SMTP connections is a large amount of
 * surface acquired to avoid forty lines, and its own transport layer is
 * exactly the thing F11e must not let anywhere near a Gmail mutation. The
 * dangerous part is the validation, the validation is small, and it is
 * written out here where it can be read and tested rather than trusted.
 * ---------------------------------------------------------------------------
 */

/** Why a message could not be turned into bytes. All are programmer errors. */
export const RFC822_REFUSAL = Object.freeze({
  /** A CR, LF or NUL reached a header value. The injection case. */
  HEADER_UNSAFE: 'HEADER_UNSAFE',
  /** Not a single plain addr-spec. No groups, no lists, no display names. */
  ADDRESS_INVALID: 'ADDRESS_INVALID',
  /**
   * Not `<something@something.tld>`. Unreachable on the Gmail MVP path, which
   * sends no Message-ID at all — kept because the validation is the expensive
   * part of ever adding one, and it is already written.
   */
  MESSAGE_ID_INVALID: 'MESSAGE_ID_INVALID',
  /** There is nothing to send. */
  BODY_REQUIRED: 'BODY_REQUIRED',
});

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/* -------------------------------------------------------------------------- */
/* Header safety — the part that actually matters                              */
/* -------------------------------------------------------------------------- */

/**
 * NO CONTROL CHARACTER REACHES A HEADER. EVER.
 *
 * CR and LF are the injection vector: a subject of `Hi\r\nBcc: them@x.com`
 * composed naively is two headers, and the second one is somebody else's.
 * NUL is refused with them because it truncates in C string handling
 * downstream and is never legitimate in a header value.
 *
 * REFUSED, NOT STRIPPED. Silently removing the newline would send a message
 * whose subject is not the subject an operator reviewed, which is the same
 * class of lie as editing the body. Every one of these values came from a
 * frozen row, so a control character in one means something upstream is wrong
 * and the send must stop rather than be cleaned up.
 *
 * The whole C0 range and DEL go with them: none of them can appear unencoded
 * in a header per RFC 5322 §2.2, and a header that needs one has a
 * non-ASCII path below.
 */
export function assertHeaderSafe(name, value) {
  const text = String(value ?? '');
  // eslint-disable-next-line no-control-regex
  const control = /[\u0000-\u001F\u007F]/.exec(text);
  if (control) {
    const at = control.index;
    throw fail(RFC822_REFUSAL.HEADER_UNSAFE,
      `The ${name} header carries a control character (0x${control[0].charCodeAt(0)
        .toString(16).padStart(2, '0')}) at position ${at}. A header value cannot contain one, and `
      + 'stripping it would send something other than what was reviewed.');
  }
  return text;
}

/**
 * A BARE ADDRESS, AND NOTHING THAT COULD BE READ AS TWO.
 *
 * `From` and `To` are the two headers where a permissive parse is dangerous in
 * a second way: a comma makes an address list, and `<>` or a display name lets
 * the visible text disagree with the routed address. Both of the values here
 * come from columns — `connected_mailboxes.email_address`, verified by Google
 * at OAuth time, and `outreach_send.recipient_email`, frozen by the claim —
 * so neither should ever carry either, and the check costs nothing.
 *
 * Deliberately NOT a full RFC 5322 addr-spec grammar. That grammar admits
 * quoted local parts, comments and domain literals, none of which any column
 * in this database has ever held; implementing it would add the parsing bugs
 * it was meant to prevent. This asserts the shape the product actually uses.
 */
export function assertAddress(name, value) {
  const text = assertHeaderSafe(name, value).trim();
  if (!/^[^\s@<>,;"()[\]\\]+@[^\s@<>,;"()[\]\\]+\.[^\s@<>,;"()[\]\\]+$/.test(text)) {
    throw fail(RFC822_REFUSAL.ADDRESS_INVALID,
      `The ${name} header must be one plain address such as name@example.com. `
      + 'A display name, a bracketed address or a list is refused.');
  }
  return text;
}

/**
 * The shape a self-assigned Message-ID would have to take, asserted rather than
 * assumed. NOT CALLED BY `buildRfc822`'s default path — see the module header
 * for why the MVP sends none — and kept so that adding one later is a decision
 * about scopes and reconciliation rather than a re-derivation of this grammar.
 */
export function assertMessageId(value) {
  const text = assertHeaderSafe('Message-ID', value).trim();
  if (!/^<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$/.test(text)) {
    throw fail(RFC822_REFUSAL.MESSAGE_ID_INVALID,
      'The Message-ID must be <local@domain.tld>, exactly as the claim recorded it. Without a '
      + 'usable one an ambiguous send can never be reconciled.');
  }
  return text;
}

/* -------------------------------------------------------------------------- */
/* Non-ASCII header text                                                       */
/* -------------------------------------------------------------------------- */

const ASCII_PRINTABLE = /^[\x20-\x7E]*$/;

/**
 * Max octets of UTF-8 per RFC 2047 encoded-word.
 *
 * An encoded-word may be 75 characters in total (RFC 2047 §2). `=?UTF-8?B?`
 * and the closing `?=` spend 12 of them, leaving 63 for base64 — and base64
 * comes in groups of four, so 60 characters, which encode 45 input octets.
 */
const ENCODED_WORD_OCTETS = 45;

/**
 * Split a UTF-8 buffer at CHARACTER boundaries, never mid-sequence.
 *
 * An encoded-word is decoded independently of its neighbours, so a multi-byte
 * character cut across two of them decodes to two replacement characters. The
 * names this handles are the ones a recruiting product sees constantly —
 * Māori macrons, Spanish and Portuguese accents, German umlauts — so getting
 * it wrong would be visible in the subject line of real mail.
 */
function chunkUtf8(buffer, limit) {
  const chunks = [];
  let start = 0;
  while (start < buffer.length) {
    let end = Math.min(start + limit, buffer.length);
    // 10xxxxxx is a continuation byte: walk back until we are on a lead byte.
    while (end > start && end < buffer.length && (buffer[end] & 0b1100_0000) === 0b1000_0000) {
      end -= 1;
    }
    chunks.push(buffer.subarray(start, end));
    start = end;
  }
  return chunks;
}

/**
 * A header value a mail reader will show correctly, whatever alphabet it is in.
 *
 * Plain ASCII is passed through untouched — the common case, and encoding it
 * would make every message's raw bytes unreadable for no gain. Anything else
 * becomes RFC 2047 base64 encoded-words, folded onto continuation lines with a
 * leading space when there is more than one.
 *
 * Base64 rather than quoted-printable because the failure modes are fewer:
 * Q-encoding has its own rules about which characters must be escaped inside a
 * header versus a body, and getting one wrong produces a subject that looks
 * fine in most clients and broken in one.
 */
export function encodeHeaderValue(name, value) {
  const text = assertHeaderSafe(name, value);
  if (ASCII_PRINTABLE.test(text)) return text;
  return chunkUtf8(Buffer.from(text, 'utf8'), ENCODED_WORD_OCTETS)
    .map((chunk) => `=?UTF-8?B?${chunk.toString('base64')}?=`)
    .join('\r\n ');
}

/* -------------------------------------------------------------------------- */
/* The body                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * THE BODY IS PLAIN TEXT, AND THAT IS NOT A PREFERENCE.
 *
 * `outreach_send.body` holds what `executionContent` froze: the reviewed words,
 * the substituted profile link and the compliance footer, as text. The legacy
 * Outlook path converts that same text to HTML at ITS transport boundary — see
 * shared/emailHtml.js and the note in server/lib/outlook.js — because Outlook's
 * AppleScript `content` property IS the HTML part and handing it text collapsed
 * every newline.
 *
 * Gmail imposes no such thing, so the choice here is between sending the frozen
 * bytes and running them through a converter first. Running them through a
 * converter would mean the octets a coach receives are not the octets a named
 * operator approved and `wire_body_sha256` recorded, and F11e is explicitly not
 * allowed to change content. So: text/plain, UTF-8, verbatim.
 *
 * The one consequence worth stating out loud is that a Gmail-sent message and
 * an Outlook-sent message of the same body render differently — paragraphs
 * separated by a blank line rather than by <p>. That is a product question
 * about what the canonical content type should be, and it belongs to whoever
 * decides it, not to a transport adapter deciding it by accident.
 */

/**
 * base64 with CRLF every 76 characters, per RFC 2045 §6.8.
 *
 * WHY THE BODY IS ENCODED AT ALL, rather than dropped in as 8-bit text: RFC
 * 5322 §2.1.1 caps a line at 998 octets, and a reviewed paragraph can exceed
 * that in one line easily. Base64 solves the line limit and 8-bit transparency
 * together, with no escaping rules to get subtly wrong, and every mail client
 * on earth decodes it. Quoted-printable would keep the raw human-readable at
 * the cost of a per-character escaping table; that trade is not worth a bug in
 * a coach's email.
 */
function base64Body(text) {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  const lines = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join('\r\n');
}

/**
 * LF BECOMES CRLF, AND IT IS THE ONLY OCTET WE TOUCH.
 *
 * Email line endings are CRLF by specification. The database holds bodies with
 * bare LF, as every text column in this system does, so somebody has to convert
 * — and if we do not, the first relay will, which means the bytes on the wire
 * differ from the bytes we recorded either way. Doing it here makes the
 * difference deliberate, one line long and testable.
 *
 * `unfoldCrlf` is its exact inverse, and a test asserts the round trip: decode
 * the raw payload, fold CRLF back to LF, and you have `outreach_send.body`
 * character for character. The TEXT is unchanged; only the line terminator is.
 * Existing CRLF is normalised first so a mixed body cannot become CRCRLF.
 */
export const foldCrlf = (text) => String(text).replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
export const unfoldCrlf = (text) => String(text).replace(/\r\n/g, '\n');

/* -------------------------------------------------------------------------- */
/* base64url                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * VERIFIED GOOGLE FACT: the Gmail API guide states that "Gmail messages are
 * sent as base64URL encoded strings within the `raw` field", and the Message
 * resource defines `raw` as "the entire RFC 2822 formatted and base64url
 * encoded message".
 *
 * base64url is base64 with `+` → `-`, `/` → `_` and the `=` padding removed.
 * Node's own 'base64url' encoding does exactly that, so this is a named
 * function rather than a hand-rolled replace chain — the substitution is the
 * kind of thing that is trivial and still gets written backwards.
 */
export const base64url = (input) => (Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8'))
  .toString('base64url');

/** The inverse, so a test can read back exactly what would have been sent. */
export const decodeBase64url = (encoded) => Buffer.from(String(encoded), 'base64url').toString('utf8');

/* -------------------------------------------------------------------------- */
/* The message                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * FOUR FROZEN INPUTS IN, ONE RFC 5322 MESSAGE OUT.
 *
 * ---------------------------------------------------------------------------
 * `date` IS THE ONLY VALUE HERE THAT IS NOT FROZEN UPSTREAM, AND IT IS
 * ENVELOPE METADATA RATHER THAN CONTENT.
 *
 * RFC 5322 §3.6 makes Date and From the two mandatory headers, and a message
 * that omits Date relies on the first relay to invent one. It says WHEN THE
 * TRANSPORT RAN, which is a fact about this request, not about what a person
 * approved — so it is deliberately outside every content digest. `body_hash`
 * and `wire_body_sha256` cover the BODY only and no header at all, which is
 * why a retried message re-encoded a day later still matches the row that
 * froze it. Injectable so a test can pin the exact bytes.
 * ---------------------------------------------------------------------------
 *
 * NO Message-ID unless one is explicitly supplied — see the module header. NO
 * Bcc, NO Reply-To, NO List-Unsubscribe, NO In-Reply-To, NO References, NO
 * X- anything. Each would be a decision about what the message IS, which was
 * made upstream and not here. The opt-out mechanism is a reply to the From
 * address, which is already true of every message this product has sent.
 *
 * @returns {{ raw: string, headers: string[], message: string }}
 *   `raw` is what goes in the Gmail request. The other two are the same content
 *   before encoding, returned so a test or a log can assert on them without
 *   decoding — never so a caller can edit them.
 */
export function buildRfc822({
  from, to, subject, body, internetMessageId = null, date = new Date(),
}) {
  const fromAddress = assertAddress('From', from);
  const toAddress = assertAddress('To', to);
  const subjectText = encodeHeaderValue('Subject', subject ?? '');

  if (body === null || body === undefined || String(body) === '') {
    throw fail(RFC822_REFUSAL.BODY_REQUIRED,
      'There is no body to send. The execution claim freezes one before a transport is reached.');
  }

  /**
   * ORDER IS CONVENTIONAL, NOT REQUIRED. Trace headers first, then
   * originator, then recipient, then content — the order a human reading
   * `Show original` expects, which makes a real message easy to compare
   * against the fixture in the tests.
   *
   * ABSENT, NOT EMPTY, when there is no Message-ID. A `Message-ID:` header
   * with nothing after it is a malformed header, and Gmail would be entitled
   * to do anything at all with it.
   */
  const headers = [
    ...(internetMessageId ? [`Message-ID: ${assertMessageId(internetMessageId)}`] : []),
    `Date: ${date.toUTCString().replace(/GMT$/, '+0000')}`,
    `From: ${fromAddress}`,
    `To: ${toAddress}`,
    `Subject: ${subjectText}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];

  const message = `${headers.join('\r\n')}\r\n\r\n${base64Body(foldCrlf(body))}\r\n`;
  return { raw: base64url(message), headers, message };
}
