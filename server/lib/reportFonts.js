/**
 * Font fallback, so a name is drawn as the characters it is spelled with.
 *
 * THE DEFECT THIS EXISTS FOR. The report is set in the standard fourteen PDF
 * faces, whose encoding is WinAnsi — ASCII, Latin-1's upper half and a handful
 * of typographic extras. `StandardFont.encode` in pdfkit does not refuse a code
 * point outside that set: it returns the code point itself as a glyph selector
 * with an advance width of zero. The viewer reads the low byte of it against a
 * WinAnsi encoding, so "Zoё May" — U+0451 CYRILLIC SMALL LETTER IO — is drawn
 * "ZoQ May", and the extracted text says the same. A misspelling that looks
 * like a spelling is the worst failure this report can have.
 *
 * WHAT PHASE 13D DID AND WHY IT WAS WRONG. It folded Cyrillic and Greek letters
 * onto the Latin letters they look like: ё drawn as ë. That renders, and it is
 * still not the name. It also could not have worked in general — the same
 * encoding gap swallows č, ć, ā, š and ž, which are Latin letters with no
 * Latin twin to fold onto, and one of those is in this database already.
 *
 * WHAT THIS DOES INSTEAD. Where the active standard face cannot encode a
 * character, the whole `doc.text` call is drawn in an EMBEDDED face instead.
 * pdfkit subsets the real font and writes a ToUnicode CMap with it, so the
 * content stream carries the actual glyphs and the extracted text carries the
 * actual code points. Nothing is substituted, nothing is transliterated, and
 * the string handed to the renderer is the string that reaches the page.
 *
 * THE FACE, NOT A FACE. The fallback is registered per standard face, so bold
 * text falls back to a bold face and oblique to an oblique one. On macOS the
 * preferred source is the system Helvetica collection, which is the same
 * typeface the report is already set in — so a fallback run is typographically
 * indistinguishable from the text around it, and an ASCII-only report is
 * byte-for-byte unaffected because the fallback is never reached.
 *
 * WHOLE CALL, NOT PER-RUN. pdfkit has no per-run font fallback and its `text`
 * carries wrapping, alignment, ellipsis and continuation. Splitting a string
 * into runs would mean reimplementing all of that to place each run by hand.
 * Switching the face for the call keeps every one of those behaviours and, with
 * a fallback that is the same typeface, costs nothing visually. Where the
 * fallback is a different typeface the affected line is set in it entirely,
 * which is a visible and honest difference rather than a hidden one.
 *
 * NO DOWNLOADS. Nothing here fetches anything. It looks in the repository, then
 * at an operator-supplied directory, then at fonts already installed on the
 * host, and if none of them holds the character it draws nothing new and lets
 * the audit report the failure — see `encodableBy`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The three faces the report is set in, and nothing else. */
export const PRIMARY_FACES = Object.freeze(['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique']);

/** The alias each fallback face is registered under. */
export const aliasFor = (face) => `Thriv3Unicode-${face}`;

/**
 * Where a Unicode-capable face may come from, in order of preference.
 *
 * 1. THE REPOSITORY. `server/assets/fonts` holds nothing today and that is a
 *    deliberate gap rather than an oversight: a font shipped in a client-facing
 *    PDF is a licensing decision and a binary in the tree, and neither is
 *    mine to make. Dropping three OFL-licensed files there — DejaVu Sans or
 *    Noto Sans, regular, bold and oblique, named as below — closes this on
 *    every host with no other change.
 *
 * 2. AN OPERATOR DIRECTORY, `THRIV3_UNICODE_FONT_DIR`, with the same names.
 *
 * 3. FONTS ALREADY ON THE HOST. macOS first, because its Helvetica collection
 *    is the typeface the report is already set in — the ideal fallback, and
 *    already licensed to whoever is running the machine. Then DejaVu, which is
 *    on effectively every Linux distribution.
 */
const BUNDLED_NAMES = Object.freeze({
  Helvetica: 'Thriv3Unicode-Regular.ttf',
  'Helvetica-Bold': 'Thriv3Unicode-Bold.ttf',
  'Helvetica-Oblique': 'Thriv3Unicode-Oblique.ttf',
});

const dirSource = (id, dir) => (dir ? {
  id,
  dir,
  faces: Object.fromEntries(PRIMARY_FACES.map((face) =>
    [face, { file: path.join(dir, BUNDLED_NAMES[face]) }])),
} : null);

const SOURCES = () => [
  dirSource('repository', path.join(HERE, '..', 'assets', 'fonts')),
  dirSource('operator', process.env.THRIV3_UNICODE_FONT_DIR || null),
  {
    id: 'macos-helvetica',
    // One collection file; the face is selected by its PostScript name, which
    // is what pdfkit's third argument means for a .ttc.
    faces: Object.fromEntries(PRIMARY_FACES.map((face) =>
      [face, { file: '/System/Library/Fonts/Helvetica.ttc', family: face }])),
  },
  {
    id: 'dejavu',
    faces: {
      Helvetica: { file: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' },
      'Helvetica-Bold': { file: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' },
      'Helvetica-Oblique': { file: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf' },
    },
  },
].filter(Boolean);

let resolved;

/**
 * The first source whose every face exists on disk, or null.
 *
 * ALL THREE OR NONE. A source that holds a regular face and no bold one would
 * fall back for a name in body text and not for the same name in a table
 * heading, and one report would then spell it two ways.
 */
export function unicodeFallback({ refresh = false } = {}) {
  if (resolved !== undefined && !refresh) return resolved;
  resolved = null;
  for (const source of SOURCES()) {
    const ok = PRIMARY_FACES.every((face) => {
      try { return fs.statSync(source.faces[face].file).isFile(); } catch { return false; }
    });
    if (ok) { resolved = source; break; }
  }
  return resolved;
}

/**
 * Register the fallback faces on a document. Returns the source id, or null
 * where the host holds no Unicode-capable face at all.
 *
 * Registration is cheap — pdfkit reads and embeds a face only when something is
 * actually drawn in it — so an ASCII-only report pays nothing for this and its
 * bytes are unchanged.
 */
export function registerUnicodeFallback(doc) {
  const source = unicodeFallback();
  if (!source) return null;
  for (const face of PRIMARY_FACES) {
    const { file, family } = source.faces[face];
    try {
      doc.registerFont(aliasFor(face), file, family);
    } catch {
      // A face that will not open is the same as a face that is not there.
      return null;
    }
  }
  doc.__unicodeFallback = source.id;
  return source.id;
}

/**
 * Every character the standard fourteen can draw: WinAnsi (CP1252).
 *
 * The set is written down because three phases of this report shipped a
 * character outside it — an arrow and a not-equals each time.
 */
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹'
  + 'ŒŽ‘’“”•–—˜™š›'
  + 'œžŸ';

export function winAnsi(ch) {
  const c = ch.codePointAt(0);
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.includes(ch);
}

/**
 * Whether the font CURRENTLY SET on this document can draw a character.
 *
 * Asks the font rather than assuming one. A standard face is WinAnsi and
 * nothing else; an embedded face is asked for the glyph, which is the only
 * answer that is true of both the page and the extracted text.
 */
export function encodableBy(doc, ch) {
  const font = doc?._font;
  const has = font?.font?.hasGlyphForCodePoint;
  if (typeof has === 'function') return Boolean(has.call(font.font, ch.codePointAt(0)));
  return winAnsi(ch);
}

/**
 * The alias to draw this string in, or null to leave the call alone.
 *
 * Null in the overwhelming majority of calls — 276,743 of 276,745 roster rows
 * are WinAnsi throughout — so the fallback is a path this document takes twice
 * and the rest of the report is drawn exactly as it was.
 */
export function fallbackFor(doc, str) {
  if (typeof str !== 'string' || !str) return null;
  const font = doc?._font;
  // Already embedded: whatever it can draw, it draws, and there is nothing
  // above it to fall back to.
  if (!font || font.constructor?.name !== 'StandardFont') return null;
  const face = font.name;
  if (!PRIMARY_FACES.includes(face)) return null;
  let needs = false;
  for (const ch of str) { if (!winAnsi(ch)) { needs = true; break; } }
  if (!needs) return null;
  if (!doc.__unicodeFallback) return null;
  return aliasFor(face);
}
