import { describe, it, expect } from 'vitest';
import { textToHtml, escapeHtml, escapeAttribute } from './emailHtml.js';

describe('escaping', () => {
  // "Missouri S&T" is in every men's match list.
  it('escapes the characters that would break the markup', () => {
    expect(escapeHtml('Missouri S&T')).toBe('Missouri S&amp;T');
    expect(escapeHtml('a < b > c')).toBe('a &lt; b &gt; c');
    expect(escapeAttribute('x?a=1&b="2"')).toBe('x?a=1&amp;b=&quot;2&quot;');
  });

  it('escapes an ampersand once, not twice', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('a &amp; b')).toBe('a &amp;amp; b');
  });
});

describe('textToHtml', () => {
  // The defect: Outlook's `content` is the HTML part, so a plain-text body
  // arrived with every newline rendered as whitespace — one unbroken block.
  it('makes a blank line a paragraph and a newline a line break', () => {
    const html = textToHtml('one\n\ntwo\nthree');
    expect(html).toContain('<p style="margin:0 0 14px 0">one</p>');
    expect(html).toContain('<p style="margin:0 0 14px 0">two<br>three</p>');
  });

  it('keeps a bulleted block together as one paragraph', () => {
    const html = textToHtml('Profile:\n• GPA: 3.6\n• SAT: 1210');
    expect(html).toContain('Profile:<br>• GPA: 3.6<br>• SAT: 1210');
  });

  it('collapses runs of blank lines rather than emitting empty paragraphs', () => {
    expect(textToHtml('one\n\n\n\ntwo').match(/<p /g)).toHaveLength(2);
    expect(textToHtml('one\n\n\n\ntwo')).not.toContain('<p style="margin:0 0 14px 0"></p>');
  });

  it('normalises CRLF, which is what a pasted template carries', () => {
    expect(textToHtml('one\r\n\r\ntwo')).toBe(textToHtml('one\n\ntwo'));
  });

  it('is empty for an empty body rather than emitting a bare wrapper', () => {
    expect(textToHtml('')).toBe('');
    expect(textToHtml(null)).toBe('');
    expect(textToHtml('   \n\n  ')).toContain('<p');
  });

  describe('links', () => {
    it('makes a URL clickable', () => {
      expect(textToHtml('see https://x.test/p/a.html'))
        .toContain('<a href="https://x.test/p/a.html">https://x.test/p/a.html</a>');
    });

    // The tracked link carries ?ref=<token>. Splitting on the URL before
    // escaping is what keeps the query string intact — once & has become
    // &amp; a URL matcher can no longer find the end of the address.
    it('keeps a query string intact in both the href and the text', () => {
      const html = textToHtml('https://x.test/p/a.html?ref=tok&t=1');
      expect(html).toContain('href="https://x.test/p/a.html?ref=tok&amp;t=1"');
      expect(html).toContain('>https://x.test/p/a.html?ref=tok&amp;t=1</a>');
      expect(html).not.toContain('&t=1"');
    });

    it('does not swallow the punctuation after a link', () => {
      const html = textToHtml('go to https://x.test/a. Then stop.');
      expect(html).toContain('<a href="https://x.test/a">https://x.test/a</a>. Then stop.');
    });

    it('links every URL in a body, not just the first', () => {
      expect(textToHtml('https://a.test/1\n\nhttps://b.test/2').match(/<a href/g)).toHaveLength(2);
    });

    it('leaves text that merely mentions a domain alone', () => {
      expect(textToHtml('email us at striv3.com')).not.toContain('<a href');
    });
  });

  it('escapes inside a paragraph, so a school name cannot emit raw markup', () => {
    const html = textToHtml('Missouri S&T has 4 <b>graduating</b> defenders');
    expect(html).toContain('Missouri S&amp;T');
    expect(html).toContain('&lt;b&gt;graduating&lt;/b&gt;');
    expect(html).not.toContain('<b>');
  });
});
