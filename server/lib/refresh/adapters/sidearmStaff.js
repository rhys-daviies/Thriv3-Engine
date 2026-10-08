/**
 * SIDEARM STAFF PAGE — `sidearm-staff-2` (Phase 8D.3E). A PERSON-CENTRED reading of a coaching-staff
 * page: every person, every address printed against that person, and whether the reading is a
 * complete staff list. It exists because `sidearm-staff-1` (parseSidearmStaff) reads only the older
 * class-named list/card markup and returns zero people on every current Sidearm staff page measured
 * in 8D.3D (61/61), which made the refresh pipeline blind and positive email absence unprovable.
 *
 * Readers, all over markup Sidearm serves today (measured on 63 official pages, 2026-10-07):
 *   STAFF_TABLE     a <table> with a Name header (s-table and sidearm-table views) — the rows come
 *                   from the repository's existing parseTables (presto.js), not a second table reader
 *   STAFF_TABLE_ID  the sidearm-table whose header cells are EMPTY and carry the column only in their
 *                   id (col-coaches-fullname / col-coaches-staff_title / col-coaches-staff_email)
 *   STAFF_CARDS     the older list/card markup, read by the existing parseSidearmStaff
 *   PROFILE         one coach's bio page (<h1> name + a <dt>Email</dt> field) — one person, never a list
 *
 * COMPLETE means: a staff list (not a profile) was recognised; every row with an address has a
 * name; no two readings of the page disagree about who is on it; no person appears twice with
 * different addresses. Anything else is INCOMPLETE with a reason, and an incomplete or profile
 * reading can show an address is published, never that one is absent.
 *
 * Only a well-formed mailto address counts as published against a person (never one completed from
 * the page's domain). Every address anywhere on the page — mailto or printed text — is also listed in
 * `emails_on_page`, so a caller can tell "not against this person" from "nowhere on the page".
 * A label row ("Team Email", "Recruiting Inquiries") is a label, not a person; an address printed
 * against two or more distinct people is marked shared.
 */
import { parseTables } from './presto.js';
import { parseSidearmStaff } from './sidearm.js';
import { decodeEntities } from './rosterStructure.js';

export const SIDEARM_STAFF_PARSER_VERSION = 'sidearm-staff-2';
export const STAFF_STRUCTURE = Object.freeze({ STAFF_TABLE: 'STAFF_TABLE', STAFF_TABLE_ID: 'STAFF_TABLE_ID', STAFF_CARDS: 'STAFF_CARDS', PROFILE: 'PROFILE', NONE: 'NONE' });
export const STAFF_LISTS = Object.freeze([STAFF_STRUCTURE.STAFF_TABLE, STAFF_STRUCTURE.STAFF_TABLE_ID, STAFF_STRUCTURE.STAFF_CARDS]);

const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const strip = (s) => decodeEntities(String(s ?? '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
export const nameKey = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const LABEL = /\b(e-?mails?|recruit\w*|inquir\w*|enquir\w*|team|office|contact|general|info\w*|questions?|program(me)?|department|main|prospective|camps?)\b/i;
/** A name cell that is a person: two or more words, no address, not a label. */
export const isPersonName = (n) => { const s = String(n ?? '').trim(); return !!s && !/@/.test(s) && !LABEL.test(s) && s.split(/\s+/).filter((w) => /[a-z]/i.test(w)).length >= 2; };

/** Every well-formed mailto address in a fragment, lower case, in order, de-duplicated. */
export function mailtos(fragment) {
  const out = [];
  for (const m of String(fragment ?? '').matchAll(/href\s*=\s*["']?\s*mailto:([^"'?>]*)/gi)) {
    let raw = m[1]; try { raw = decodeURIComponent(raw); } catch { /* keep raw */ }
    const e = decodeEntities(raw).trim().toLowerCase();
    if (EMAIL.test(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

/** Every address on the page: mailto targets and addresses printed in the text. */
export function emailsOnPage(html) {
  const set = new Set(mailtos(html));
  for (const m of strip(html).toLowerCase().matchAll(/[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/g)) set.add(m[0]);
  return [...set].sort();
}

function namedHeaderRows(html) {
  const rows = [];
  for (const t of parseTables(html)) {
    const nameKeyOf = t.headers.find((h) => h === 'name');
    if (!nameKeyOf) continue;
    const titleKey = t.headers.find((h) => /title|position/.test(h));
    for (const r of t.rows) {
      const cellsHtml = Object.values(r).map((c) => c.html).join(' ');
      rows.push({ name: r[nameKeyOf]?.text?.trim() || '', role: titleKey ? r[titleKey]?.text?.trim() || null : null, emails: mailtos(cellsHtml) });
    }
  }
  return rows;
}

function idKeyedRows(html) {
  const rows = [];
  for (const tm of String(html).matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const tbl = tm[0];
    const ids = [...((tbl.match(/<thead[\s\S]*?<\/thead>/i) || [''])[0]).matchAll(/<th[^>]*\bid="col-coaches-([a-z_]+)"/gi)].map((m) => m[1].toLowerCase());
    const nameAt = ids.indexOf('fullname'); if (nameAt < 0) continue;
    const titleAt = ids.indexOf('staff_title');
    const body = tbl.replace(/<thead[\s\S]*?<\/thead>/i, '');
    for (const tr of body.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const cells = [...tr[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => c[1]);
      if (!cells.length) continue;
      rows.push({ name: strip(cells[nameAt] ?? ''), role: titleAt >= 0 ? strip(cells[titleAt] ?? '') || null : null, emails: mailtos(tr[0]) });
    }
  }
  return rows;
}

function profile(html) {
  const h = String(html);
  const field = h.match(/<dt>\s*Email\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i);
  // the bio page's <h1> is often the site name; its <title> starts with the person ("Jo Bloggs - Head Coach - ...")
  const fromTitle = strip((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').split(/\s+-\s+/)[0];
  const fromH1 = strip((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
  const name = isPersonName(fromTitle) ? fromTitle : fromH1;
  if (!field || !isPersonName(name)) return null;
  const role = strip((h.match(/<dt>\s*Title\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i) || [])[1] || '') || null;
  return { name, role, emails: mailtos(field[1]) };
}

/**
 * Read one staff page.
 * -> { parser_version, structure, complete, incomplete_reason, people: [{ full_name, role, emails[], shared_emails[] }],
 *      labels: [{ label, emails[] }], emails_on_page[], rows }
 */
export function parseSidearmStaffPage(html) {
  const h = String(html ?? '');
  const base = { parser_version: SIDEARM_STAFF_PARSER_VERSION, emails_on_page: emailsOnPage(h) };
  let structure = STAFF_STRUCTURE.NONE; let rows = [];
  const named = namedHeaderRows(h); const keyed = named.length ? [] : idKeyedRows(h);
  if (named.length) { structure = STAFF_STRUCTURE.STAFF_TABLE; rows = named; }
  else if (keyed.length) { structure = STAFF_STRUCTURE.STAFF_TABLE_ID; rows = keyed; }
  const cards = parseSidearmStaff(h).map((p) => ({ name: p.full_name, role: p.role, emails: p.email ? [p.email] : [] }));
  if (!rows.length && cards.length) { structure = STAFF_STRUCTURE.STAFF_CARDS; rows = cards; }
  const prof = rows.length ? null : profile(h);
  if (prof) { structure = STAFF_STRUCTURE.PROFILE; rows = [prof]; }
  if (!rows.length) return { ...base, structure, complete: false, incomplete_reason: 'NO_STAFF_STRUCTURE', people: [], labels: [], rows: 0 };

  const reasons = [];
  const byName = new Map(); const labels = [];
  for (const r of rows) {
    if (!r.name) { if (r.emails.length) reasons.push('UNNAMED_ROW_WITH_ADDRESS'); continue; }
    if (!isPersonName(r.name)) { labels.push({ label: [r.name, r.role].filter(Boolean).join(' — '), emails: r.emails }); continue; }
    const k = nameKey(r.name); const cur = byName.get(k);
    if (!cur) { byName.set(k, { full_name: r.name, role: r.role, emails: [...r.emails] }); continue; }
    // the same person printed twice (table + hidden mobile copy): one person, unless the addresses disagree
    if (r.emails.length && cur.emails.length && r.emails.join() !== cur.emails.join()) reasons.push('DUPLICATE_PERSON_CONFLICT');
    for (const e of r.emails) if (!cur.emails.includes(e)) cur.emails.push(e);
  }
  // a table and a card view of the same page must agree about who is on it
  if (STAFF_LISTS.includes(structure) && structure !== STAFF_STRUCTURE.STAFF_CARDS && cards.length) {
    const a = new Set([...byName.keys()]); const b = new Set(cards.map((c) => nameKey(c.name)).filter((k) => isPersonName(k)));
    if (b.size && ([...a].some((k) => !b.has(k)) || [...b].some((k) => !a.has(k)))) reasons.push('VIEWS_DISAGREE');
  }
  const people = [...byName.values()];
  const owners = new Map(); for (const p of people) for (const e of p.emails) owners.set(e, (owners.get(e) || 0) + 1);
  for (const p of people) p.shared_emails = p.emails.filter((e) => owners.get(e) > 1);
  if (!people.length) reasons.push('NO_PERSON');
  if (structure === STAFF_STRUCTURE.PROFILE) reasons.push('PROFILE_IS_NOT_A_STAFF_LIST');
  const uniq = [...new Set(reasons)];
  return { ...base, structure, complete: uniq.length === 0, incomplete_reason: uniq.join(',') || null, people, labels, rows: rows.length };
}
