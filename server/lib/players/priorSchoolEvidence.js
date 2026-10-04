/**
 * EXPLICIT PRIOR-SCHOOL EVIDENCE — Phase 8B.1A. Pure functions over official roster HTML.
 *
 * A destination roster that prints "Previous School: X" beside a player is the only thing in
 * this dataset that says, in the source's own words, where a player came from. It outranks any
 * inferred match. But the field is not self-describing, and two traps were measured on the
 * cached 2026 pages before a line of this was written:
 *
 *   1. Sidearm's `previous-school` field holds a HIGH SCHOOL for most freshmen ("Mater Dei HS",
 *      "Mt. Spokane"). A field label is never evidence of a prior COLLEGE; only a value that
 *      resolves to a known college programme is.
 *   2. The Nuxt card's "Last School" label sits on the HIGH-SCHOOL item, not the previous-school
 *      item. The element's class decides the field type, never its visible label.
 *
 * So extraction records the STRUCTURED FIELD TYPE exactly as the markup declares it and the raw
 * value verbatim; `resolvePriorInstitution` then decides, against the canonical college names
 * and institution aliases, whether that value names a college programme at all. Free-text bio
 * prose is never read here.
 *
 * Fail-closed: a page with player markup whose players cannot be tied to their fields returns
 * structure UNKNOWN and no records.
 */
import { decodeEntities, headerRole, STRUCTURE } from '../refresh/adapters/rosterStructure.js';
import { HOMETOWN_TABLES } from '../../../shared/lifecycle/hometown.js';

export const FIELD_TYPE = Object.freeze({
  /** A dedicated previous-school / previous-college / transfer field. */
  PREVIOUS_SCHOOL: 'PREVIOUS_SCHOOL',
  /** A dedicated high-school field (Nuxt labels it "Last School"). Never a prior-college claim. */
  HIGH_SCHOOL: 'HIGH_SCHOOL',
  /** "High School / Previous School" in one column: the value may be either. */
  SCHOOL_COMBINED: 'HIGH_SCHOOL_OR_PREVIOUS_COMBINED',
  /** "Hometown / Previous School" in one column; the school is the part after the slash. */
  HOMETOWN_COMBINED: 'HOMETOWN_PREVIOUS_COMBINED',
});

const LABELS = /<span[^>]*class="[^"]*\b(?:sr-only|visually-hidden|label)\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi;
const text = (h) => decodeEntities(String(h ?? '').replace(LABELS, ' ').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' '))
  .replace(/^(previous school|previous college|last school|high school|hometown|transfer(?:red)? from)\s*:\s*/i, '').trim() || null;

/** The full element whose opening tag starts at `at` (balanced on its own tag name). */
function elementAt(h, at) {
  const open = /^<([a-z0-9]+)\b/i.exec(h.slice(at, at + 20));
  if (!open) return '';
  const tag = open[1].toLowerCase();
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = at; let depth = 0; let m;
  while ((m = re.exec(h))) {
    if (/\/>$/.test(m[0])) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return h.slice(at, m.index + m[0].length);
  }
  return h.slice(at);
}
/** Text of the first element in `block` whose class matches `cls`. */
function field(block, cls) {
  const re = new RegExp(`<[a-z0-9]+[^>]*class="[^"]*(?:${cls})[^"]*"[^>]*>`, 'i');
  const m = re.exec(block);
  return m ? text(elementAt(block, m.index)) : null;
}

const FIELDS = {
  previous: 'sidearm-roster-player-previous-school|__previous-school-item|profile-field--previous-school|roster-list-item-previous-school',
  high: 'sidearm-roster-player-highschool|__high-school-item|profile-field--high-school',
  hometown: 'sidearm-roster-player-hometown|__hometown-item|profile-field--hometown',
  height: 'sidearm-roster-player-height|__height-item|profile-field--height',
};

function blocksOf(h) {
  const out = [];
  const starts = (re) => [...h.matchAll(re)].map((m) => m.index);
  const classic = starts(/<li[^>]+class="[^"]*\bsidearm-roster-player\b[^"]*"/gi);
  if (classic.length) return { kind: 'sidearm-list', blocks: classic.map((i) => elementAt(h, i)) };
  const vue = starts(/<li[^>]+class="roster-list-item"/gi);
  if (vue.length) return { kind: 'sidearm-vue-list', blocks: vue.map((i) => elementAt(h, i)) };
  const cards = starts(/<div[^>]+class="[^"]*\bs-person-card\b(?![-_])[^"]*"/gi);
  if (cards.length) return { kind: 'sidearm-person-card', blocks: cards.map((i) => elementAt(h, i)) };
  return { kind: null, blocks: out };
}
function nameOf(block) {
  const m = block.match(/sidearm-roster-player-name[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)
    || block.match(/class="[^"]*roster-list-item__title[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
    || block.match(/s-person-details__personal-single-line[^>]*>([\s\S]*?)<\/(?:h3|span|a)>/i)
    || block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  return m ? text(m[1]) : null;
}

/** Which school-ish field a table header declares (null = not a school column). */
export function schoolHeaderType(h) {
  const t = String(h || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const prev = /previous (school|college|institution)|last (school|college)|prior (school|institution)|transfer(red)? from|^transfer$/.test(t);
  const hs = /high school|\bhs\b/.test(t);
  if (/home ?town/.test(t) && (prev || /school|college/.test(t))) return FIELD_TYPE.HOMETOWN_COMBINED;
  if (prev && hs) return FIELD_TYPE.SCHOOL_COMBINED;
  if (prev) return FIELD_TYPE.PREVIOUS_SCHOOL;
  if (hs) return FIELD_TYPE.HIGH_SCHOOL;
  return null;
}

function tableRecords(h) {
  for (const t of h.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const tbl = t[0];
    const head = (tbl.match(/<thead[\s\S]*?<\/thead>/i) || [tbl.match(/<tr[\s\S]*?<\/tr>/i)?.[0] || ''])[0];
    const lastRow = [...head.matchAll(/<tr[\s\S]*?<\/tr>/gi)].pop()?.[0] || head;
    const headers = [...lastRow.matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/gi)].filter((m) => !/aria-hidden="true"/.test(m[1])).map((m) => text(m[2]) || '');
    const roles = headers.map(headerRole); const school = headers.map(schoolHeaderType);
    const ni = roles.indexOf('name');
    if (ni < 0 || roles.filter((r) => r === 'name').length !== 1 || !school.some(Boolean)) continue;
    const records = []; let bad = 0;
    for (const r of tbl.replace(head, '').matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      let cells = [...r[0].matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/gi)].map((c) => ({ attrs: c[1], text: text(c[2]) }));
      if (cells.length > headers.length) cells = cells.filter((c) => !/\bd-(?:sm|md|lg)-none\b/.test(c.attrs));
      if (cells.length === 1 && /colspan/i.test(cells[0].attrs)) continue;
      if (!cells.length) continue;
      if (cells.length !== headers.length) { bad += 1; continue; }
      const name = cells[ni].text;
      if (!name) { bad += 1; continue; }
      const k = school.findIndex((s) => s && s !== FIELD_TYPE.HIGH_SCHOOL);
      const hk = school.indexOf(FIELD_TYPE.HIGH_SCHOOL);
      const hti = roles.findIndex((role, i) => role === 'hometown' && !school[i]);
      const hgt = roles.indexOf('height');
      let raw = k >= 0 ? cells[k].text : null; let hometown = hti >= 0 ? cells[hti].text : null;
      if (k >= 0 && school[k] === FIELD_TYPE.HOMETOWN_COMBINED && raw) {
        const parts = raw.split(/\s+\/\s+/);
        hometown = hometown || parts[0] || null; raw = parts.length > 1 ? parts.slice(1).join(' / ') : null;
      }
      records.push({ player_name: name, hometown, height: hgt >= 0 ? cells[hgt].text : null,
        field_type: k >= 0 ? school[k] : null, raw_value: raw, high_school: hk >= 0 ? cells[hk].text : null });
    }
    if (bad) return { records: [], structure: { code: STRUCTURE.UNKNOWN, detail: `${bad} table row(s) could not be tied to the header` }, kind: 'table' };
    return { records, structure: { code: records.length ? STRUCTURE.OK : STRUCTURE.EMPTY, detail: `table: ${headers.join(' | ')}` }, kind: 'table' };
  }
  return null;
}

/**
 * Every player on an official roster page with the school fields the page itself declares.
 * -> { kind, structure, records: [{ player_name, hometown, height, field_type, raw_value, high_school }] }
 */
export function extractRosterSchoolFields(html) {
  const h = String(html || '');
  const { kind, blocks } = blocksOf(h);
  if (kind) {
    const records = []; let unnamed = 0;
    for (const b of blocks) {
      const name = nameOf(b);
      if (!name) { unnamed += 1; continue; }
      if (kind === 'sidearm-person-card' && /coach|director|trainer/i.test(field(b, 's-person-details__position|s-person-card__content__person__position') || '')) continue;
      const prev = field(b, FIELDS.previous); const hs = field(b, FIELDS.high);
      records.push({ player_name: name, hometown: field(b, FIELDS.hometown), height: field(b, FIELDS.height),
        field_type: prev ? FIELD_TYPE.PREVIOUS_SCHOOL : null, raw_value: prev, high_school: hs });
    }
    if (unnamed && unnamed > blocks.length / 10) return { kind, records: [], structure: { code: STRUCTURE.UNKNOWN, detail: `${unnamed} of ${blocks.length} player blocks have no readable name` } };
    if (records.length) return { kind, records, structure: { code: STRUCTURE.OK, detail: `${kind}: ${records.length} players` } };
  }
  return tableRecords(h) || { kind: null, records: [], structure: { code: STRUCTURE.NONE, detail: 'no player markup with school fields' } };
}

// ------------------------------------------------------------------ institution resolution
const BASE_STOP = new Set(['the', 'of', 'at', 'and', 'university', 'college']);
/** Remove division/association tags and read a bracketed state as its postal code: "Wilmington (Del.)" -> "Wilmington (de)". */
function preclean(s) {
  return String(s ?? '').replace(/\((?:div(?:ision)?\.?\s*(?:i{1,3}|[123])|d[123]|naia|njcaa|ncaa[^)]*)\)/gi, ' ')
    .replace(/\(([^)]+)\)/g, (m, inner) => { const t = inner.toLowerCase().replace(/[.]/g, '').trim(); const st = HOMETOWN_TABLES.US_STATES[t]; return st ? ` (${st})` : m; });
}
/** Institution key: accents folded, punctuation dropped, "&" -> and. */
export const instKey = (s) => preclean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/\buniv\.?(?=\s|$)/g, 'university').replace(/\bcomm\.?\s+coll\.?\b/g, 'community college')
  .replace(/\bcc\b/g, 'community college').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
/**
 * A looser key, used only when the strict key is unknown: a leading "the" and ONE trailing
 * "university"/"college" are dropped ("Quinnipiac University" -> "quinnipiac"). A LEADING
 * "University of" is never dropped — "University of Mississippi" is Ole Miss, not Mississippi
 * College — and "State" is never dropped ("Montana State" is not Montana).
 */
const looseKey = (s) => instKey(s).replace(/^the /, '').replace(/ (university|college)$/, '').trim();
/** The bare institution word(s) with any bracketed qualifier removed: the shared-name ambiguity test. */
const baseKey = (s) => instKey(String(s ?? '').replace(/\([^)]*\)/g, ' ')).split(' ').filter((w) => w && !BASE_STOP.has(w)).join(' ');
const hasQualifier = (s) => /\([^)]+\)|\b(campus|at [a-z]+)\b/i.test(preclean(s));

const HIGH_SCHOOL = /\b(hs|h\.s\.|high school|high|secondary|prep|preparatory|academy|ecnl|mls next|next pro|usl|npsl|rl|da|fc|sc|ff|cp|soccer club|united|youth|gymnasium|lycee|colegio|instituto|liceo|escuela|sixth form|grammar|school|homeschool|home school|dynamo|sounders|earthquakes|rapids|rush|fusion|surf)\b/i;
const COLLEGE_WORD = /\b(university|college|univ|community college|cc|institute of technology|state)\b/i;

/**
 * Index of every name a college programme is known by, for one sport:
 *   colleges.name, the athletics entity's display name, the institution's aliases.
 * Keys map to Sets of canonical `college_name`; `family` maps a college_name to its institution
 * family (parent unitid, else own federal unitid, else entity), so two campuses of one institution
 * and duplicate rows of one programme compare as one.
 */
export function buildInstitutionIndex(db, sport) {
  const strict = new Map(); const loose = new Map(); const base = new Map(); const family = new Map();
  const put = (label, name) => {
    if (!label || !name) return;
    for (const [m, k] of [[strict, instKey(label)], [loose, looseKey(label)], [base, baseKey(label)]]) {
      if (!k || k.length < 3) continue;
      (m.get(k) || m.set(k, new Set()).get(k)).add(name);
    }
  };
  const cols = db.prepare('SELECT c.name, c.unitid, c.athletics_entity_id e, e.display_name, e.federal_unitid fu, e.parent_unitid pu FROM colleges c LEFT JOIN athletics_entities e ON e.athletics_entity_id = c.athletics_entity_id WHERE c.sport = ?').all(sport);
  const byUnit = new Map(); const byEnt = new Map();
  for (const c of cols) {
    put(c.name, c.name); put(c.display_name, c.name);
    if (!family.has(c.name)) family.set(c.name, String(c.pu || c.fu || c.e || c.unitid || c.name));
    if (c.unitid) (byUnit.get(c.unitid) || byUnit.set(c.unitid, new Set()).get(c.unitid)).add(c.name);
    if (c.e) (byEnt.get(c.e) || byEnt.set(c.e, new Set()).get(c.e)).add(c.name);
  }
  const hasAliases = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='institution_aliases'").get();
  if (hasAliases) {
    for (const a of db.prepare("SELECT alias_raw, unitid, athletics_entity_id e FROM institution_aliases WHERE confidence IN ('CERTAIN','HIGH') OR confidence IS NULL").all()) {
      for (const n of new Set([...(byUnit.get(a.unitid) || []), ...(byEnt.get(a.e) || [])])) put(a.alias_raw, n);
    }
  }
  return { strict, loose, base, family, sport, familyOf: (name) => family.get(name) || String(name) };
}

export const RESOLUTION = Object.freeze({ COLLEGE: 'COLLEGE', HIGH_SCHOOL: 'HIGH_SCHOOL_OR_CLUB', AMBIGUOUS: 'AMBIGUOUS_INSTITUTION', UNRESOLVED: 'UNRESOLVED', BLANK: 'BLANK' });
const families = (names, index) => new Set([...names].map((n) => index.familyOf(n)));

/**
 * What ONE raw school value names.
 * -> { kind, programmes: [college_name], families: [family], method }
 * COLLEGE only when every matching programme belongs to ONE institution family, and the bare name
 * is not shared by another institution (unless the value carries a qualifier). Matching is exact on
 * a key; there is no edit distance and no token overlap.
 */
export function resolvePriorInstitution(raw, index) {
  const v = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!v || /^(n\/?a|none|-+|—)$/i.test(v)) return { kind: RESOLUTION.BLANK, programmes: [], families: [], method: null };
  const tryKey = (k, m, method) => { const s = m.get(k); return s ? { set: [...s].sort(), method } : null; };
  const hit = tryKey(instKey(v), index.strict, 'STRICT_NAME') || tryKey(looseKey(v), index.loose, 'LOOSE_NAME');
  if (hit) {
    const fam = families(hit.set, index);
    const shared = !hasQualifier(v) && index.base.get(baseKey(v)) && families(index.base.get(baseKey(v)), index).size > 1;
    if (fam.size === 1 && !shared) return { kind: RESOLUTION.COLLEGE, programmes: hit.set, families: [...fam], method: hit.method };
    return { kind: RESOLUTION.AMBIGUOUS, programmes: hit.set, families: [...fam], method: shared ? 'NAME_SHARED_BY_INSTITUTIONS' : hit.method };
  }
  if (HIGH_SCHOOL.test(v) && !COLLEGE_WORD.test(v)) return { kind: RESOLUTION.HIGH_SCHOOL, programmes: [], families: [], method: 'HIGH_SCHOOL_MARKER' };
  return { kind: RESOLUTION.UNRESOLVED, programmes: [], families: [], method: null };
}

/** A value may list several schools ("FAU/Iona", "Tacoma CC / Park University"): one resolution per part. */
export function resolvePriorSchools(raw, index) {
  const parts = String(raw ?? '').split(/\s*\/\s*|\s*;\s*|\s*,\s*(?=[A-Z])|\s+&\s+(?=[A-Z][a-z]+ (?:University|College))/).map((x) => x.trim()).filter(Boolean);
  return (parts.length ? parts : [String(raw ?? '')]).map((p) => ({ part: p, ...resolvePriorInstitution(p, index) }));
}

/**
 * The page-level safeguard for trap 1: a PREVIOUS_SCHOOL field is "college-aware" on a page only
 * when at least one of its values on that page resolves to a college. On a page that fills the
 * field with high schools for everyone, a high-school value says nothing about a prior college.
 */
export function pageIsCollegeAware(records, index) {
  return records.some((r) => r.raw_value && resolvePriorSchools(r.raw_value, index).some((x) => x.kind === RESOLUTION.COLLEGE));
}

/**
 * The structured prior-school reading for one destination player against a claimed prior programme.
 *   AGREES                some part resolves to the prior programme's institution family
 *   NAMES_OTHER_COLLEGE   EVERY part resolves to a college and none is the prior family (a conflict
 *                         to review, never proof: bios list earlier schools and go stale)
 *   HIGH_SCHOOL_ON_COLLEGE_AWARE_PAGE  a dedicated previous-school field holding only a high
 *                         school, on a page whose field names colleges for other players
 *   UNINFORMATIVE         anything else (unresolved parts, ambiguous names, high-school-only pages)
 */
export function readExplicitPrior({ record, pageRecords, priorProgramme, destinationProgramme, index }) {
  if (!record?.raw_value || !record.field_type || record.field_type === FIELD_TYPE.HIGH_SCHOOL) return { explicit: 'NONE', parts: [] };
  const parts = resolvePriorSchools(record.raw_value, index)
    .filter((x) => !(x.kind === RESOLUTION.COLLEGE && x.families.includes(index.familyOf(destinationProgramme))));
  const priorFam = priorProgramme ? index.familyOf(priorProgramme) : null;
  if (priorFam && parts.some((x) => (x.kind === RESOLUTION.COLLEGE || x.kind === RESOLUTION.AMBIGUOUS) && x.families.length === 1 && x.families[0] === priorFam)) return { explicit: 'AGREES', parts };
  if (priorFam && parts.some((x) => x.kind === RESOLUTION.COLLEGE && x.families.includes(priorFam))) return { explicit: 'AGREES', parts };
  const colleges = parts.filter((x) => x.kind === RESOLUTION.COLLEGE);
  const schoolish = parts.filter((x) => x.kind !== RESOLUTION.HIGH_SCHOOL && x.kind !== RESOLUTION.BLANK);
  if (colleges.length && colleges.length === schoolish.length) return { explicit: 'NAMES_OTHER_COLLEGE', parts };
  if (parts.length && parts.every((x) => x.kind === RESOLUTION.HIGH_SCHOOL) && record.field_type === FIELD_TYPE.PREVIOUS_SCHOOL && pageIsCollegeAware(pageRecords, index)) return { explicit: 'HIGH_SCHOOL_ON_COLLEGE_AWARE_PAGE', parts };
  return { explicit: 'UNINFORMATIVE', parts };
}
