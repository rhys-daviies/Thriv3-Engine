/**
 * Unicode correctness: a name is drawn as the characters it is spelled with.
 *
 * The defect these tests exist for is not a missing glyph. It is that pdfkit's
 * standard faces do not REFUSE a character outside WinAnsi — `encode` hands
 * back the code point as a glyph selector and the viewer reads its low byte, so
 * U+0451 is drawn "Q" and the extracted text says "Q" too. A misspelling that
 * looks like a spelling is the worst failure this report can have, and it is
 * invisible to every check that does not read the finished page.
 *
 * So the assertions here read the finished page, through the PDF's own
 * ToUnicode map — the same route a reader's copy-and-paste takes.
 */
import { describe, it, expect } from 'vitest';
import { render, THEME } from './philosophyPdf.js';
import { createAudit } from './reportAudit.js';
import { pdfUnicodeText } from './pdfText.js';
import { unicodeFallback, winAnsi, PRIMARY_FACES, aliasFor } from './reportFonts.js';

const { M } = THEME;

/**
 * THE CORPUS. Latin-1 that has always worked, Latin Extended-A that never did,
 * and the Cyrillic and Greek that 13D would have folded onto look-alikes.
 *
 * `č ć š ž ā` are the reason homoglyph folding could not have been the answer:
 * they are Latin letters outside WinAnsi with no Latin twin to fold onto, and
 * one of them is in this database already.
 */
export const CORPUS = [
  { name: 'José Ramírez', chars: ['é', 'í'], winAnsi: true },
  { name: 'Zoë Lam', chars: ['ë'], winAnsi: true },
  { name: 'Ida Nyström', chars: ['ö'], winAnsi: true },
  { name: 'Sondre Ødegård', chars: ['Ø', 'å'], winAnsi: true },
  { name: 'Núñez Peña', chars: ['ú', 'ñ'], winAnsi: true },
  { name: 'Jānis Bērziņš', chars: ['ā', 'ē', 'ņ'], winAnsi: false },
  { name: 'Luka Čović', chars: ['Č', 'ć'], winAnsi: false },
  { name: 'Šime Živković', chars: ['Š', 'Ž', 'ć'], winAnsi: false },
  { name: 'Zoё May', chars: ['ё'], winAnsi: false },
  { name: 'Жанна Ковач', chars: ['Ж', 'а'], winAnsi: false },
  { name: 'πr Konstantinou', chars: ['π'], winAnsi: false },
];

// ---------------------------------------------------------------------------
// A ToUnicode-aware reading of the finished page
//
// `pdfUnicodeText` follows the font a string was drawn in rather than assuming
// WinAnsi, which is the only way to see an embedded subset at all — see
// pdfText.js. Every assertion below reads the finished page through it, because
// the defect this file exists for is invisible anywhere else.
// ---------------------------------------------------------------------------

const extractedText = pdfUnicodeText;

/** Draw a list of strings, one per line, in each of the three faces. */
const drawAll = (strings, faces = ['Helvetica']) => {
  const audit = createAudit();
  return render((k) => {
    const { doc } = k;
    doc.addPage();
    let y = M;
    for (const face of faces) {
      for (const s of strings) {
        doc.font(face).fontSize(10).fillColor(THEME.INK).text(s, M, y, { width: 400, lineBreak: false });
        y += 14;
      }
    }
  }, { audit }).then((buf) => ({ buf, audit }));
};

// ---------------------------------------------------------------------------

describe('the WinAnsi boundary', () => {
  it('classifies every corpus name by whether the standard faces can draw it', () => {
    for (const c of CORPUS) {
      expect([...c.name].every(winAnsi), c.name).toBe(c.winAnsi);
    }
  });

  it('places Latin Extended-A outside it, which is why folding could never work', () => {
    // č, ć, ā, ē and ņ are Latin letters with no Latin twin. A homoglyph map
    // has nothing to offer them, and one of them is in the roster data.
    for (const ch of ['č', 'Č', 'ć', 'ā', 'ē', 'ņ']) expect(winAnsi(ch)).toBe(false);
    // Latin-1 is inside it and always was, and CP1252 adds the four Central
    // European letters it happens to carry — š, ž and their capitals — which is
    // exactly the kind of boundary nobody remembers and a test should hold.
    for (const ch of ['é', 'ë', 'ö', 'ø', 'ñ', 'å', 'Ø', 'š', 'ž', 'Š', 'Ž']) {
      expect(winAnsi(ch), ch).toBe(true);
    }
  });
});

describe('nothing is respelled', () => {
  it('exports no transliteration, no folding and no homoglyph map', async () => {
    const pdf = await import('./philosophyPdf.js');
    const fonts = await import('./reportFonts.js');
    for (const m of [pdf, fonts]) {
      for (const key of Object.keys(m)) {
        expect(key, `${key} looks like a substitution helper`)
          .not.toMatch(/fold|translit|homoglyph|substitut|asciif/i);
      }
    }
  });

  it('draws each corpus name as the exact characters it is spelled with', async () => {
    const { buf } = await drawAll(CORPUS.map((c) => c.name));
    const text = extractedText(buf);
    for (const c of CORPUS) {
      expect(text, c.name).toContain(c.name);
      for (const ch of c.chars) expect(text, `${c.name}: ${ch}`).toContain(ch);
    }
  });

  it('keeps two names that look alike apart', async () => {
    // Latin ë and Cyrillic ё are the same shape. 13D drew the second as the
    // first; both are on the page now and they are different strings.
    const { buf } = await drawAll(['Zoë Lam', 'Zoё May']);
    const text = extractedText(buf);
    expect(text).toContain('Zoë Lam');
    expect(text).toContain('Zoё May');
  });

  it('draws a name in bold and oblique as the same characters', async () => {
    const { buf } = await drawAll(['Zoё May', 'Luka Čović'],
      ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique']);
    const text = extractedText(buf);
    expect(text.match(/Zoё May/g) ?? []).toHaveLength(3);
    expect(text.match(/Luka Čović/g) ?? []).toHaveLength(3);
  });
});

describe('the fallback', () => {
  const available = Boolean(unicodeFallback());

  it('registers one alias per primary face', () => {
    expect(PRIMARY_FACES).toEqual(['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique']);
    expect(new Set(PRIMARY_FACES.map(aliasFor)).size).toBe(3);
  });

  it('resolves a source that holds all three faces, or none at all', () => {
    const source = unicodeFallback();
    if (!source) return; // A host with no Unicode face: see the failure test.
    for (const face of PRIMARY_FACES) expect(source.faces[face].file).toBeTruthy();
  });

  it.runIf(available)('embeds a face only where one is needed', async () => {
    const plain = await drawAll(['Plain ASCII name', 'José Ramírez']);
    expect(/\/FontFile2/.test(plain.buf.toString('latin1')),
      'an ASCII and Latin-1 page embedded a font it did not need').toBe(false);
    const wide = await drawAll(['Zoё May']);
    expect(/\/FontFile2/.test(wide.buf.toString('latin1'))).toBe(true);
  });

  it.runIf(available)('reports nothing for a character the face in use can draw', async () => {
    const { audit } = await drawAll(CORPUS.map((c) => c.name));
    expect(audit.unencodable).toEqual([]);
  });
});

describe('a glyph no approved face holds', () => {
  it('is reported rather than substituted', async () => {
    // A private-use code point, because no text face holds one on any host —
    // an arrow's fate now depends on which fallback the machine has, which is
    // the point of having a fallback at all.
    const { audit, buf } = await drawAll(['a \uE000 b']);
    expect(audit.unencodable).toHaveLength(1);
    expect(audit.unencodable[0].characters).toEqual(['\uE000']);
    // And nothing was quietly turned into a letter that looks plausible.
    expect(extractedText(buf)).not.toMatch(/a [A-Za-z] b/);
  });

  it('draws a character the fallback does hold, rather than reporting it', async () => {
    if (!unicodeFallback()) return;
    // ≠ is outside WinAnsi and inside most text faces. Before 13D.1 every such
    // character was a defect by definition; now the question is whether the
    // face that draws it has the glyph.
    const { audit } = await drawAll(['x ≠ y']);
    const reported = new Set(audit.unencodable.flatMap((u) => u.characters));
    expect(reported.has('≠')).toBe(false);
  });
});
