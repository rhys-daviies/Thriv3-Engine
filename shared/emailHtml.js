/**
 * Plain-text email bodies, rendered as the HTML Outlook actually sends.
 *
 * Outlook's AppleScript `content` property is the *HTML* part of the message —
 * a probe setting it to "a<br>b" produced a text/html MIME part reading
 * "a<br>b" and a text/plain part reading "ab". So handing it a plain-text body
 * meant every newline was HTML whitespace, and a carefully spaced template
 * arrived as one unbroken paragraph. Templates are authored as plain text and
 * that is worth keeping; this converts at the last moment instead.
 *
 * Escaping is not optional here. "Missouri S&T" is in every men's match list
 * and would otherwise emit a bare ampersand, and a template is free text an
 * operator can put anything into.
 */

/** For text nodes. */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** For attribute values, which additionally must not contain a bare quote. */
export function escapeAttribute(text) {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

// Trailing punctuation is excluded so a link at the end of a sentence does not
// swallow the full stop. Parentheses are excluded for the same reason.
const URL_PATTERN = /(https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/g;

/**
 * Escapes one line and turns any URL in it into an anchor.
 *
 * Split on the URL *before* escaping rather than after: a tracked link carries
 * a query string, and once "&" has become "&amp;" a URL matcher can no longer
 * tell where the address ends. The href is attribute-escaped separately from
 * the visible text, which is what keeps "?ref=x&t=1" both correct in the
 * markup and clickable.
 */
function renderLine(line) {
  const parts = String(line).split(URL_PATTERN);
  return parts
    .map((part, i) => (i % 2 === 1
      ? `<a href="${escapeAttribute(part)}">${escapeHtml(part)}</a>`
      : escapeHtml(part)))
    .join('');
}

/**
 * A blank line starts a new paragraph; a single newline is a line break.
 *
 * That is the convention the templates are already written in — a bulleted
 * block is consecutive lines, and a gap separates sections — so honouring it
 * reproduces on screen what the operator sees while editing.
 */
export function textToHtml(plain) {
  const blocks = String(plain ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.replace(/^\n+|\n+$/g, ''))
    .filter((block) => block.length > 0);

  if (blocks.length === 0) return '';

  const body = blocks
    .map((block) => `<p>${block.split('\n').map(renderLine).join('<br>')}</p>`)
    .join('\n');

  // A conservative stack and an explicit line height, because Outlook's own
  // default for a scripted message is neither consistent nor comfortable to
  // read. Margins are set per paragraph rather than relied on: Outlook and
  // Gmail disagree about default <p> spacing.
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a">\n${
    body.replace(/<p>/g, '<p style="margin:0 0 14px 0">')
  }\n</div>`;
}
