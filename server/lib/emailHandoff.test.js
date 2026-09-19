import { describe, it, expect } from 'vitest';
import { buildHandoff, mailtoUrlFor, HANDOFF_REFUSAL } from './emailHandoff.js';
import { textToHtml } from '../../shared/emailHtml.js';

/**
 * THE PREPARED EMAIL, AND THE URL IT TRAVELS BESIDE — R2B.
 *
 * ===========================================================================
 * TWO PROPERTIES ARE WORTH MORE THAN ALL THE OTHERS HERE.
 *
 *   1. THE BODY IS NEVER IN THE URL. It is the single reason this design
 *      exists: a real Thriv3 email makes a 2,007-character mailto, two
 *      thousand is the safe ceiling, and what truncates is the END of the
 *      body — where the CAN-SPAM footer lives. A coach would receive an email
 *      with no sender identity, no postal address and no opt-out, and nothing
 *      would say so. So the length test below is not a micro-optimisation, it
 *      is a legal-compliance test wearing a URL's clothes.
 *
 *   2. A STRUCTURALLY DANGEROUS VALUE IS REFUSED, NEVER CLEANED. `coaches`
 *      has never validated an address — `findOrCreateCoach` accepts anything
 *      that is not empty and not "n/a" — and that was safe while the only
 *      transport passed it to `osascript` as argv. In a URL, `?` opens the
 *      header section and `&` starts another one.
 * ===========================================================================
 */

const BASE = {
  sendId: 'send-1',
  coachId: 'coach-1',
  to: 'coach@example.edu',
  subject: 'Jack Davies — 2027 centre-back',
  body: 'Hi Coach,\n\nSee https://thriv3.test/p/ab.html?ref=tok123\n\nBest regards,\nRhys',
};

const build = (over = {}) => buildHandoff({ ...BASE, ...over });

/* ========================================================================== */
/*  What comes out                                                            */
/* ========================================================================== */

describe('the prepared email', () => {
  it('carries the draft it was built from, unchanged', () => {
    const h = build();
    expect(h.sendId).toBe('send-1');
    expect(h.coachId).toBe('coach-1');
    expect(h.to).toBe('coach@example.edu');
    expect(h.subject).toBe(BASE.subject);
    // Verbatim. What the operator pastes is what the row holds.
    expect(h.body).toBe(BASE.body);
  });

  /**
   * ONE RENDERER, NOT TWO. `textToHtml` already escapes `&`, `<`, `>` and `"`
   * and allows only http, https, tel and mailto in an anchor. A second
   * implementation here would be a second escaping policy, and the way that
   * ends is one of them being wrong in front of a coach.
   */
  it('renders HTML with the same function the Outlook path uses', () => {
    expect(build().bodyHtml).toBe(textToHtml(BASE.body));
  });

  it('refuses to hand over nothing', () => {
    for (const body of [null, undefined, '']) {
      expect(() => build({ body })).toThrow(/no body to hand over/i);
    }
    try { build({ body: '' }); } catch (e) { expect(e.code).toBe(HANDOFF_REFUSAL.BODY_REQUIRED); }
  });
});

/* ========================================================================== */
/*  The URL carries two things                                                */
/* ========================================================================== */

describe('the mailto URL', () => {
  it('is a recipient and a subject and nothing else', () => {
    const url = new URL(build().mailtoUrl);
    expect(url.protocol).toBe('mailto:');
    expect(url.pathname).toBe('coach@example.edu');
    const params = [...new URLSearchParams(url.search).keys()];
    expect(params).toEqual(['subject']);
  });

  /** THE REASON THE WHOLE DESIGN EXISTS. */
  it('never carries the body', () => {
    const h = build();
    expect(h.mailtoUrl).not.toContain('body=');
    expect(h.mailtoUrl.toLowerCase()).not.toContain('best%20regards');
    expect(h.mailtoUrl).not.toContain('tok123');
  });

  it('carries no cc, no bcc, no from and no arbitrary header', () => {
    const url = build().mailtoUrl.toLowerCase();
    for (const header of ['cc=', 'bcc=', 'from=', 'reply-to=', 'in-reply-to=', 'x-']) {
      expect(url, header).not.toContain(header);
    }
  });

  /**
   * A 40,000-CHARACTER BODY PRODUCES THE SAME URL AS A 40-CHARACTER ONE.
   *
   * The operator edits the body freely before drafting and an athlete may
   * carry a custom template of any length, so the body is unbounded in
   * principle. This asserts that the bound does not matter — which is the
   * property `body=` would have taken away.
   */
  it('does not grow with the body', () => {
    const short = build({ body: 'Hi.' }).mailtoUrl;
    const long = build({ body: 'x'.repeat(40_000) }).mailtoUrl;
    expect(long).toBe(short);
    expect(long.length).toBeLessThan(200);
  });

  it('stays far inside the two-thousand-character ceiling for a real email', () => {
    // A subject at the long end of what the composer produces.
    const h = build({ subject: 'Jack Davies — 2027 centre-back from New Zealand, GPA 3.8' });
    expect(h.mailtoUrl.length).toBeLessThan(300);
  });
});

/* ========================================================================== */
/*  Encoding                                                                  */
/* ========================================================================== */

describe('encoding', () => {
  /**
   * EXACTLY ONCE. RFC 6068 §7 warns about double-escaping specifically, and
   * the way it happens is two layers each assuming the other did not. The
   * server builds the URL; the client is handed it finished and encodes
   * nothing.
   */
  it('percent-encodes the subject exactly once', () => {
    const subject = 'Q&A: 100% ready? — “yes” #1';
    const h = build({ subject });
    const decoded = new URLSearchParams(new URL(h.mailtoUrl).search).get('subject');
    expect(decoded).toBe(subject);
    // Double-encoding shows up as a literal %25 where a % was encoded twice.
    expect(h.mailtoUrl).not.toContain('%2525');
  });

  it('round-trips Unicode a recruiting product actually sees', () => {
    for (const subject of ['Māori macron — tēnā koe', 'José Muñoz · Grün', '⚽ 2027']) {
      const h = build({ subject });
      expect(new URLSearchParams(new URL(h.mailtoUrl).search).get('subject')).toBe(subject);
    }
  });

  /**
   * The delimiters, escaped so they cannot act as delimiters. A subject of
   * "Ready? & waiting" must not become a `waiting` header.
   */
  it('neutralises ? & = # in a subject', () => {
    const h = build({ subject: 'Ready? & waiting = yes #1' });
    const params = [...new URLSearchParams(new URL(h.mailtoUrl).search).keys()];
    expect(params).toEqual(['subject']);
  });

  it('leaves @ literal in the address, as the ABNF requires', () => {
    expect(build().mailtoUrl).toContain('mailto:coach@example.edu?');
    expect(build().mailtoUrl).not.toContain('%40');
  });
});

/* ========================================================================== */
/*  Refusals — the injection surface                                          */
/* ========================================================================== */

describe('a recipient that is not one plain address', () => {
  /**
   * EACH OF THESE IS A DIFFERENT INJECTION, AND ALL OF THEM ARE REFUSED.
   * A comma adds a recipient; `?` opens the header section; `&` adds a
   * header; a display name lets the visible text disagree with the routed
   * address; brackets are the other way of writing one.
   */
  const REFUSED = [
    ['comma — a second recipient', 'coach@example.edu,attacker@evil.example'],
    ['question mark — opens headers', 'coach?bcc=attacker@evil.example'],
    ['ampersand — adds a header', 'coach&bcc=attacker@evil.example'],
    ['equals', 'coach=x@example.edu'],
    ['hash — a fragment', 'coach#x@example.edu'],
    ['slash', 'coach/x@example.edu'],
    ['percent — pre-encoded input', 'coach%40evil.example@example.edu'],
    ['semicolon', 'coach@example.edu;attacker@evil.example'],
    ['display name', 'Coach Anderson <coach@example.edu>'],
    ['bracketed', '<coach@example.edu>'],
    ['quoted local part', '"coach"@example.edu'],
    ['whitespace', 'coach @example.edu'],
    ['newline', 'coach@example.edu\nBcc: attacker@evil.example'],
    ['no domain', 'coach'],
    ['empty', ''],
  ];

  for (const [why, to] of REFUSED) {
    it(`refuses a ${why}`, () => {
      expect(() => build({ to })).toThrow();
      expect(() => mailtoUrlFor({ to, subject: 'x' })).toThrow();
    });
  }

  /**
   * REFUSED, NOT SANITISED — and this is the assertion that says so. The
   * address is percent-encoded as well, so stripping or escaping would also
   * have produced a safe URL. It would also have produced a compose window
   * addressed to somebody who does not exist, and let the operator find out
   * on the bounce.
   */
  it('produces no handoff at all rather than a cleaned one', () => {
    let handoff = null;
    try { handoff = build({ to: 'coach,attacker@evil.example' }); } catch { /* expected */ }
    expect(handoff).toBeNull();
  });

  it('names the refusal so a bad coach row can be found', () => {
    try {
      build({ to: 'coach?x@example.edu' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe(HANDOFF_REFUSAL.ADDRESS_URI_UNSAFE);
      expect(err.message).toMatch(/coach record/i);
    }
  });

  it('accepts the ordinary addresses this product actually holds', () => {
    for (const to of [
      'coach@example.edu', 'first.last@athletics.example.edu',
      'soccer-info@example.edu', 'coach_1@example.edu', "o'brien@example.edu",
    ]) {
      expect(() => build({ to })).not.toThrow();
    }
  });
});

describe('a subject that is not a subject', () => {
  /**
   * CR AND LF ARE THE CLASSIC HEADER BREAK. Meaningless in AppleScript argv,
   * structural the moment the value reaches a URL or an RFC 5322 header.
   */
  it('refuses a control character rather than stripping it', () => {
    for (const subject of [
      'Hi\r\nBcc: attacker@evil.example',
      'Hi\nBcc: attacker@evil.example',
      'Hi there',
      'Hithere',
      'Hithere',
    ]) {
      expect(() => build({ subject })).toThrow();
      let handoff = null;
      try { handoff = build({ subject }); } catch { /* expected */ }
      expect(handoff).toBeNull();
    }
  });

  it('allows an empty subject, which is a choice and not a failure', () => {
    expect(() => build({ subject: '' })).not.toThrow();
    expect(build({ subject: '' }).subject).toBe('');
  });
});

/* ========================================================================== */
/*  What cannot reach a coach                                                 */
/* ========================================================================== */

describe('the HTML', () => {
  /**
   * The allowlist lives in shared/emailHtml.js and is asserted here as well,
   * because this is a NEW route to a coach's inbox and "the other file tests
   * it" is how a policy stops being enforced on the path that matters.
   */
  it('cannot carry a javascript: link, however it is written', () => {
    for (const body of [
      '[click me](javascript:alert(1))',
      'javascript:alert(1)',
      '<a href="javascript:alert(1)">x</a>',
      '[x](JavaScript:alert(1))',
    ]) {
      const html = build({ body }).bodyHtml.toLowerCase();
      /**
       * A LIVE ANCHOR, not the characters. Raw `<a href="javascript:...">` in
       * a body is escaped to `&lt;a href=...&gt;` and arrives as inert text
       * that happens to contain the string — which is the correct outcome,
       * and a naive substring check calls it a failure. What must not exist
       * is an anchor ELEMENT with that scheme.
       */
      expect(html, body).not.toMatch(/<a\s[^>]*href="javascript:/);
      expect(html, body).not.toMatch(/<a\s[^>]*href="[^"]*script:/);
    }
  });

  it('escapes a raw anchor in the body instead of emitting one', () => {
    const html = build({ body: '<a href="javascript:alert(1)">x</a>' }).bodyHtml;
    expect(html).toContain('&lt;a href=');
    expect(html).not.toMatch(/<a\s/);
  });

  it('escapes markup in the body rather than emitting it', () => {
    const html = build({ body: '<script>alert(1)</script> & "quotes"' }).bodyHtml;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('keeps a real tracking link clickable with its query string intact', () => {
    const url = 'https://thriv3.test/p/ab.html?ref=tok123';
    expect(build({ body: `See ${url}` }).bodyHtml)
      .toContain(`<a href="${url}">${url}</a>`);
  });
});
