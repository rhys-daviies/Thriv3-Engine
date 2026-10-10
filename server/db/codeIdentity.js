/**
 * MIGRATION CODE IDENTITY FROM WHAT EXECUTES, NOT FROM COMMENTS — DI-09A.
 *
 * DI-08 identified the migration code by the sha256 of schema.sql and migrate.js, byte for byte. Both
 * files are mostly prose (migrate.js is ~1,900 lines, the larger part of them comments), so a typo fix
 * in a comment changed the code manifest, and a server whose database had been recorded against the
 * old bytes refused to start until someone ran an authorised migration that did nothing. A rule that
 * fires on comment edits is a rule people learn to click through.
 *
 * So the manifest hashes a NORMALISED form of each file:
 *
 *   schema.sql   comments (`-- …` and `/* … *\/`) removed outside quoted text; runs of whitespace
 *                collapsed to one space. SQL whitespace outside quotes is never significant.
 *
 *   migrate.js   comments removed; string, template and regular-expression literals kept VERBATIM
 *                (an edit to a SQL string inside migrate.js is an edit to the migration); whitespace
 *                outside them collapsed to "\n" when the run contains a line break (automatic
 *                semicolon insertion can depend on one) and to " " otherwise. A block comment that
 *                spans lines becomes "\n" for the same reason.
 *
 * WHICH WAY IT FAILS. Mis-reading a token can only make the normaliser keep MORE text than it should,
 * except in one case: a regular expression literal mistaken for division, whose quote then opens a
 * phantom string. That desynchronises the lexer, and an unterminated string at a line end is the
 * symptom — it throws, and the caller falls back to the raw bytes (stricter, never looser). The test
 * suite also proves, with esbuild, that normalising the real migrate.js removes nothing but comments
 * and insignificant whitespace (codeIdentity.test.js).
 */

const REGEX_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const isWord = (c) => /[\w$]/.test(c);
const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\v' || c === '\f' || c === '\u00a0' || c === '\ufeff' || c === '\u2028' || c === '\u2029';

/** JavaScript source with comments removed and insignificant whitespace collapsed. Throws on a lexing desync. */
export function normaliseJs(src) {
  const n = src.length;
  let i = 0;
  let out = '';
  let pendingSpace = null; // null | ' ' | '\n'
  let lastSig = '';
  let lastWord = '';

  const space = (nl) => { pendingSpace = nl || pendingSpace === '\n' ? '\n' : ' '; };
  const emit = (text, sig, word = '') => {
    if (pendingSpace !== null && out.length) out += pendingSpace;
    pendingSpace = null;
    out += text;
    lastSig = sig;
    lastWord = word;
  };
  const quoted = (q) => {
    let j = i + 1;
    while (j < n && src[j] !== q) {
      if (src[j] === '\\') j += 2;
      else if (src[j] === '\n') throw new Error(`normaliseJs: unterminated string at ${i}`);
      else j += 1;
    }
    if (j >= n) throw new Error(`normaliseJs: unterminated string at ${i}`);
    const text = src.slice(i, j + 1);
    i = j + 1;
    return text;
  };
  // A template literal, verbatim, including any `${ … }` (whose contents are code, lexed so a `}` in a
  // nested string or template cannot end the substitution early — but kept verbatim, comments and all).
  const template = () => {
    const start = i;
    i += 1;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i += 1; return src.slice(start, i); }
      if (c === '$' && src[i + 1] === '{') { i += 2; skipCode(); continue; }
      i += 1;
    }
    throw new Error(`normaliseJs: unterminated template at ${start}`);
  };
  // Skip code up to and including the `}` that closes a template substitution.
  const skipCode = () => {
    let depth = 0; let sig = '{'; let word = '';
    while (i < n) {
      const c = src[i];
      const d = src[i + 1];
      if (isSpace(c)) { i += 1; continue; }
      if (c === '/' && d === '/') { const j = src.indexOf('\n', i); i = j < 0 ? n : j; continue; }
      if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); if (j < 0) throw new Error('normaliseJs: unterminated comment'); i = j + 2; continue; }
      if (c === '"' || c === "'") { quoted(c); sig = '"'; continue; }
      if (c === '`') { template(); sig = '`'; continue; }
      if (c === '/' && (REGEX_AFTER.has(sig) || (sig === 'w' && REGEX_AFTER_WORD.has(word)))) { i = regexEnd(i); sig = 'r'; continue; }
      if (isWord(c)) { let j = i; while (j < n && isWord(src[j])) j += 1; word = src.slice(i, j); sig = 'w'; i = j; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') { if (depth === 0) { i += 1; return; } depth -= 1; }
      sig = c; i += 1;
    }
    throw new Error('normaliseJs: unterminated template substitution');
  };
  // The index just past a regular-expression literal starting at `at`.
  const regexEnd = (at) => {
    let j = at + 1; let cls = false;
    while (j < n) {
      const x = src[j];
      if (x === '\\') { j += 2; continue; }
      if (x === '\n') throw new Error(`normaliseJs: unterminated regular expression at ${at}`);
      if (x === '[') cls = true; else if (x === ']') cls = false; else if (x === '/' && !cls) break;
      j += 1;
    }
    if (j >= n) throw new Error(`normaliseJs: unterminated regular expression at ${at}`);
    j += 1; while (j < n && /[a-z]/i.test(src[j])) j += 1;
    return j;
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (isSpace(c)) {
      let j = i; let nl = false;
      while (j < n && isSpace(src[j])) { if (src[j] === '\n' || src[j] === '\r' || src[j] === '\u2028' || src[j] === '\u2029') nl = true; j += 1; }
      space(nl); i = j; continue;
    }
    if (c === '/' && d === '/') { const j = src.indexOf('\n', i); i = j < 0 ? n : j; continue; }
    if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2);
      if (j < 0) throw new Error(`normaliseJs: unterminated comment at ${i}`);
      space(/[\n\r\u2028\u2029]/.test(src.slice(i, j)));
      i = j + 2; continue;
    }
    if (i === 0 && c === '#' && d === '!') { const j = src.indexOf('\n'); emit(src.slice(0, j < 0 ? n : j), ''); i = j < 0 ? n : j; continue; }
    if (c === '"' || c === "'") { emit(quoted(c), '"'); continue; }
    if (c === '`') { emit(template(), '`'); continue; }
    if (c === '/' && (lastSig === '' || REGEX_AFTER.has(lastSig) || (lastSig === 'w' && REGEX_AFTER_WORD.has(lastWord)))) {
      const j = regexEnd(i);
      emit(src.slice(i, j), 'r'); i = j; continue;
    }
    if (isWord(c)) {
      let j = i; while (j < n && isWord(src[j])) j += 1;
      const w = src.slice(i, j);
      emit(w, 'w', w); i = j; continue;
    }
    emit(c, c); i += 1;
  }
  return out;
}

/** SQL with comments removed outside quoted text and whitespace collapsed. */
export function normaliseSql(src) {
  const n = src.length;
  let i = 0; let out = ''; let pendingSpace = false;
  const emit = (t) => { if (pendingSpace && out.length) out += ' '; pendingSpace = false; out += t; };
  while (i < n) {
    const c = src[i]; const d = src[i + 1];
    if (/\s/.test(c)) { pendingSpace = true; i += 1; continue; }
    if (c === '-' && d === '-') { const j = src.indexOf('\n', i); i = j < 0 ? n : j; pendingSpace = true; continue; }
    if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; pendingSpace = true; continue; }
    const close = { "'": "'", '"': '"', '`': '`', '[': ']' }[c];
    if (close) {
      let j = i + 1;
      while (j < n) { if (src[j] === close) { if (close !== ']' && src[j + 1] === close) { j += 2; continue; } break; } j += 1; }
      emit(src.slice(i, Math.min(j + 1, n))); i = j + 1; continue;
    }
    emit(c); i += 1;
  }
  return out;
}

/** Normalise by file kind; on any lexing doubt return the raw text, marked, so identity is stricter, never looser. */
export function normalisedSource(kind, src) {
  try {
    return { text: kind === 'sql' ? normaliseSql(src) : normaliseJs(src), normalised: true };
  } catch {
    return { text: `RAW\n${src}`, normalised: false };
  }
}
