/**
 * What a reader's copy-and-paste would give back.
 *
 * WHY THIS IS NOT THE OBVIOUS THING. Every earlier reader of these PDFs decoded
 * each byte of a drawn string as WinAnsi, which is right for the standard
 * fourteen faces and wrong for an embedded subset — there a glyph code is two
 * bytes and means whatever the font's `/ToUnicode` CMap says it means. Since
 * Phase 13D.1 a name outside WinAnsi is drawn in an embedded face, so a
 * WinAnsi-only reader reports the very names this exists to check as absent
 * from the page. It did, for an hour.
 *
 * So this follows the font: `Tf` selects a resource, the resource says whether
 * codes are one byte or two, and the CMap says what each code means. That is
 * the same route a viewer takes, which is the only reason to trust the answer.
 */
import zlib from 'node:zlib';

/** The CP1252 bytes that are not Latin-1, for the standard faces. */
const WINANSI_BYTE = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function inflate(body) {
  const at = body.indexOf('stream');
  if (at === -1) return null;
  const start = body.indexOf('\n', at) + 1;
  const bytes = Buffer.from(body.slice(start, body.lastIndexOf('endstream')), 'latin1');
  try { return zlib.inflateSync(bytes).toString('latin1'); } catch { return bytes.toString('latin1'); }
}

const hexToStr = (h) => {
  let out = '';
  for (let i = 0; i + 3 < h.length + 1; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
  return out.normalize('NFC');
};

/** Glyph code to string, from a `/ToUnicode` CMap. */
function cmapOf(text) {
  const map = new Map();
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(p[1], 16), hexToStr(p[2]));
    }
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    // The array form — one destination per code — is what pdfkit writes for a
    // subset, and handling only the base form below is what lost the name.
    for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([^\]]*)\]/g)) {
      const lo = parseInt(p[1], 16);
      [...p[3].matchAll(/<([0-9A-Fa-f]+)>/g)].forEach((d, i) => map.set(lo + i, hexToStr(d[1])));
    }
    for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(p[1], 16); const hi = parseInt(p[2], 16); const base = parseInt(p[3], 16);
      for (let c = lo; c <= hi; c += 1) if (!map.has(c)) map.set(c, String.fromCharCode(base + (c - lo)));
    }
  }
  return map;
}

/**
 * Every string drawn in the document, in the order the content streams hold
 * them, decoded through whichever font drew it.
 *
 * A glyph code with no mapping becomes U+FFFD rather than nothing: an extractor
 * that silently drops one reports a name as missing when it is on the page.
 */
export function pdfUnicodeText(buf) {
  const raw = buf.toString('latin1');
  const objs = new Map();
  for (const m of raw.matchAll(/(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g)) objs.set(Number(m[1]), m[3]);

  const fonts = new Map();
  for (const [, body] of objs) {
    for (const r of body.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
      const font = objs.get(Number(r[2])) ?? '';
      if (!/\/BaseFont/.test(font)) continue;
      const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(font);
      const stream = tu ? inflate(objs.get(Number(tu[1])) ?? '') : null;
      fonts.set(r[1], {
        map: stream ? cmapOf(stream) : null,
        width: /\/Subtype\s*\/Type0/.test(font) ? 2 : 1,
      });
    }
  }

  let out = '';
  for (const [, body] of objs) {
    if (!/\/Type\s*\/Page[^s]/.test(body)) continue;
    const cs = /\/Contents\s+(\d+)\s+0\s+R/.exec(body);
    const content = cs ? inflate(objs.get(Number(cs[1])) ?? '') ?? '' : '';
    let font = null;
    const re = /\/(F\d+)\s+[\d.]+\s+Tf|(?:\[([^\]]*)\]\s*TJ)|(?:<([0-9A-Fa-f]*)>\s*Tj)/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      if (m[1]) { font = fonts.get(m[1]) ?? null; continue; }
      const step = (font?.width ?? 1) * 2;
      let word = '';
      for (const hex of (m[2] ?? `<${m[3] ?? ''}>`).matchAll(/<([0-9A-Fa-f]*)>/g)) {
        for (let i = 0; i + step - 1 < hex[1].length; i += step) {
          const code = parseInt(hex[1].slice(i, i + step), 16);
          word += font?.map ? (font.map.get(code) ?? '�') : (WINANSI_BYTE[code] ?? String.fromCharCode(code));
        }
      }
      if (word) out += `${word} `;
    }
  }
  return out.replace(/\s+/g, ' ');
}
