/**
 * PROGRAMME CONTACT ADDRESS SLOTS — Phase 1G-B (B1). Pure functions over a staff page's HTML.
 *
 * WHERE an address is printed decides what it can be. A staff page prints addresses in three
 * kinds of place, and this module reports every published address with the place it sat in:
 *
 *   PERSON           against exactly ONE named person — coach intelligence, never a programme
 *                    contact (approved 1G-A Q2), even when it reads like an inbox (Hope's
 *                    menssoccer@ printed against the head coach alone)
 *   SHARED           against TWO OR MORE DISTINCT named people (Vermont's mens.soccer@ against
 *                    four coaches) — a shared programme address
 *   TEAM_SLOT        in a staff row whose "name" is not a person ("Team Email", "General Inquiries")
 *   RECRUITING_SLOT  the same, about recruiting ("All Recruit Emails: Please Direct Inquiries to")
 *   CONTACT_BLOCK    outside any staff row, in a block whose own text is about this programme or
 *                    recruiting; a footer address (web-accessibility@…) is NOT a slot at all
 *
 * DUPLICATED MARKUP IS NOT SHARING. Sidearm prints the same staff more than once (table + list
 * views, hidden mobile copies); people are counted by normalised NAME, so one coach printed twice
 * is one person, and two coaches sharing an address are two.
 *
 * Only a well-formed address in a mailto (or the printed text of one) counts: a link like
 * mailto:WomensSoccerRecruiting with no domain is recorded as MALFORMED and never completed —
 * completing it with the page's domain would be inventing an address.
 *
 * Nothing here decides eligibility: slots are evidence for the classifier and the validator.
 */
import { decodeEntities } from './rosterStructure.js';

export const SLOT = Object.freeze({
  PERSON: 'PERSON', SHARED: 'SHARED', TEAM_SLOT: 'TEAM_SLOT', RECRUITING_SLOT: 'RECRUITING_SLOT', CONTACT_BLOCK: 'CONTACT_BLOCK',
});
export const SLOT_PARSER_VERSION = 'pc-slots-1';

const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const strip = (s) => decodeEntities(String(s ?? '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
/** A row whose name cell is a label, not a person. */
const NON_PERSON = /\b(e-?mails?|recruit\w*|inquir\w*|enquir\w*|team|office|contact|general|info\w*|questions?|program(me)?|department|staff|main|prospective|camps?)\b/i;
const RECRUITING = /\brecruit\w*|prospective|questionnaire/i;
const PROGRAMME_TEXT = /\b(soccer|futbol|fútbol|recruit\w*|prospective|questionnaire|team)\b/i;
const personKey = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Every mailto in a fragment: { email (valid, lower case) | malformed }. */
function mailtos(fragment) {
  const out = [];
  for (const m of String(fragment).matchAll(/href\s*=\s*["']?\s*mailto:([^"'?>\s]*)/gi)) {
    let raw = m[1];
    try { raw = decodeURIComponent(raw); } catch { /* keep raw */ }
    const e = decodeEntities(raw).trim().toLowerCase();
    if (EMAIL.test(e)) out.push({ email: e }); else if (e) out.push({ malformed: e });
  }
  return out;
}

/** Is a name cell a person? A label ("All Recruit Emails"), an empty cell or a bare address is not. */
export function isPersonName(name) {
  const n = String(name ?? '').trim();
  if (!n || /@/.test(n) || !/[a-z]/i.test(n)) return false;
  if (NON_PERSON.test(n)) return false;
  return n.split(/\s+/).filter((w) => /[a-z]/i.test(w)).length >= 2;
}

/** Staff ROWS from every table that has a Name column (Sidearm table view, Presto tables). */
function tableRows(html) {
  const rows = [];
  for (const tm of String(html).matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const t = tm[0];
    const trs = [...t.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
    const headTr = trs.find((tr) => /<th/i.test(tr) && /\bname\b/i.test(strip(tr)) && !/mailto:/i.test(tr));
    if (!headTr) continue;
    const heads = [...headTr.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => strip(m[1]).toLowerCase());
    const nameAt = heads.findIndex((h) => /^name$/.test(h));
    const titleAt = heads.findIndex((h) => /title|position/.test(h));
    if (nameAt < 0) continue;
    for (const tr of trs) {
      if (tr === headTr) continue;
      const cells = [...tr.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => m[1]);
      if (cells.length <= nameAt) continue;
      rows.push({ name: strip(cells[nameAt]), title: titleAt >= 0 && cells[titleAt] != null ? strip(cells[titleAt]) : null, html: tr, kind: 'TABLE_ROW' });
    }
  }
  return rows;
}

/** Staff BLOCKS from Sidearm list / card markup and Presto cards (no table). */
function blockRows(html) {
  const rows = [];
  const h = String(html);
  const take = (re, nameRe, titleRe, kind) => {
    for (const m of h.matchAll(re)) {
      const b = m[0];
      const name = strip((b.match(nameRe) || [])[1]);
      const title = strip((b.match(titleRe) || [])[1]) || null;
      rows.push({ name, title, html: b, kind });
    }
  };
  take(/<li[^>]+class="[^"]*sidearm-roster-coach[^"]*"[\s\S]*?<\/li>/gi, /sidearm-roster-coach-name[^>]*>([\s\S]*?)<\/(?:div|span|a|p)>/i, /sidearm-roster-coach-title[^>]*>([\s\S]*?)<\/(?:div|span|p)>/i, 'LIST');
  take(/<div[^>]+class="[^"]*s-person-card[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*s-person-card[^"]*"|<\/section>|$)/gi, /(?:s-person-details__personal-single-line)[^>]*>([\s\S]*?)<\/(?:h3|span|a|div)>/i, /s-person-details__position[^>]*>([\s\S]*?)<\/(?:span|div|p)>/i, 'CARD');
  take(/<div[^>]+class="(?:[^"]*\s)?card(?:\s[^"]*)?"[\s\S]*?(?=<div[^>]+class="(?:[^"]*\s)?card(?:\s[^"]*)?"|<\/section>|$)/gi, /card-title[^>]*>([\s\S]*?)<\/(?:h\d|div|a|span)>/i, /card-text[^>]*>([\s\S]*?)<\/(?:p|div|span)>/i, 'CARD');
  return rows.filter((r) => r.name || /mailto:/i.test(r.html));
}

/**
 * Every published address on a staff page, with its slot.
 * -> { addresses: [{ email, slot, person_count, labels[], context_text, rows, recruiting }],
 *      malformed: [{ text, near }], rows: <number of staff rows read>, parser_version }
 */
export function extractAddressSlots(html) {
  const h = String(html ?? '');
  const rows = tableRows(h);
  const fromTables = rows.length > 0;
  if (!fromTables) rows.push(...blockRows(h));
  const by = new Map(); const malformed = [];
  const entry = (email) => by.get(email) || by.set(email, { email, persons: new Set(), labels: new Set(), contexts: [], rows: 0, inRow: false, block: false }).get(email);
  let consumed = h;
  for (const r of rows) {
    const found = mailtos(r.html);
    for (const f of found) {
      if (f.malformed) { malformed.push({ text: f.malformed, near: r.name || r.title || null }); continue; }
      const e = entry(f.email); e.rows++; e.inRow = true;
      if (isPersonName(r.name)) e.persons.add(personKey(r.name));
      else e.labels.add([r.name, r.title].filter(Boolean).join(' — ') || '(unlabelled row)');
      e.contexts.push([r.name, r.title].filter(Boolean).join(' | '));
    }
    consumed = consumed.split(r.html).join(' ');
  }
  // addresses outside every staff row: a CONTACT_BLOCK only when the surrounding text is about the programme
  for (const m of consumed.matchAll(/href\s*=\s*["']?\s*mailto:/gi)) {
    // the enclosing element only: from the nearest block-level opening tag to its first block close
    const before = consumed.slice(Math.max(0, m.index - 2000), m.index);
    const opens = [...before.matchAll(/<(p|div|li|address|td|section|footer|span)\b[^>]*>/gi)];
    const from = opens.length ? opens[opens.length - 1].index : 0;
    const rest = consumed.slice(m.index);
    const close = rest.search(/<\/(p|div|li|address|td|section|footer)>/i);
    const element = before.slice(from) + rest.slice(0, close < 0 ? 400 : close);
    const f = mailtos(rest.slice(0, 400).replace(/^[^h]*/, ''))[0];
    if (!f) continue;
    if (f.malformed) { malformed.push({ text: f.malformed, near: null }); continue; }
    const text = strip(element).slice(0, 300);
    if (!PROGRAMME_TEXT.test(text) && !PROGRAMME_TEXT.test(f.email.split('@')[0])) continue;  // page chrome, a footer
    const e = entry(f.email); e.block = true; e.contexts.push(text);
  }
  const addresses = [...by.values()].map((e) => {
    const labels = [...e.labels];
    const labelText = labels.join(' ');
    let slot;
    if (labels.length) slot = RECRUITING.test(labelText) ? SLOT.RECRUITING_SLOT : SLOT.TEAM_SLOT;
    else if (e.persons.size >= 2) slot = SLOT.SHARED;
    else if (e.persons.size === 1) slot = SLOT.PERSON;
    else slot = SLOT.CONTACT_BLOCK;
    const context = [...new Set(e.contexts)].join(' / ').slice(0, 300);
    // recruiting is read from the ADDRESS or an explicit slot/block, never from a person's job title
    const recruiting = /recruit|prospect/.test(e.email.split('@')[0]) || slot === SLOT.RECRUITING_SLOT || (slot === SLOT.CONTACT_BLOCK && RECRUITING.test(context));
    return { email: e.email, slot, person_count: e.persons.size, labels, context_text: context, rows: e.rows, recruiting };
  }).sort((a, b) => a.email.localeCompare(b.email));
  return { addresses, malformed, rows: rows.length, source: fromTables ? 'TABLE' : 'BLOCKS', parser_version: SLOT_PARSER_VERSION };
}
