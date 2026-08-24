#!/usr/bin/env node
/**
 * Backfills colleges.nickname / mascot / primary_color / secondary_color /
 * logo_url from each school's Wikipedia infobox (`{{Infobox university}}`).
 * First step of "individualise emails with visual identity" -- the nickname
 * feeds the {{college_nickname}} email template token (see
 * src/lib/emailTemplate.js).
 *
 * Only fills fields that are currently blank -- never overwrites data
 * already present, and is safe to re-run (schools already fully identified
 * are skipped).
 *
 * Usage:
 *   node server/scripts/populateSchoolIdentity.js [--apply] [--limit N]
 *
 * Without --apply, runs as a dry run and prints what would change.
 */
import fs from 'node:fs';
import { College } from '../db/entities/college.js';
import { isPluralNickname } from '../lib/nicknameGrammar.js';

const API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'RecruitmatchSchoolIdentityBot/1.0 (contact: rhys.davies@cardaxia.ai)';
// Wikipedia etiquette: every API call already sleeps 150ms, so even at 6 workers this
// stays around 20 req/s. Overridable because a full backfill of ~1000 school names is
// otherwise a ~100-minute serial crawl.
const concArg = process.argv.find((a) => a.startsWith('--concurrency'));
export const CONCURRENCY = concArg
  ? Number(concArg.split('=')[1] || process.argv[process.argv.indexOf(concArg) + 1])
  : 2;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const limitArg = args.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg ? Number(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1]) : Infinity;
// Repairs specific schools regardless of their current nickname/mascot state
// (and overwrites rather than only filling blanks) -- for fixing rows that
// got corrupted data from a since-fixed extraction bug, not routine use.
const repairArg = args.find((a) => a.startsWith('--repair-file'));
const REPAIR_NAMES = repairArg
  ? fs.readFileSync((repairArg.split('=')[1] || args[args.indexOf(repairArg) + 1]).trim(), 'utf-8')
      .split('\n').map((s) => s.trim()).filter(Boolean)
  : null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiGet(base, params, attempt = 1) {
  const url = new URL(base);
  url.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt > 6) throw new Error(`HTTP ${res.status} fetching ${url} (gave up after ${attempt} attempts)`);
    const retryAfter = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
    await sleep(wait);
    return apiGet(base, params, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const json = await res.json();
  await sleep(150); // stay well under Wikipedia's unauthenticated rate limit
  return json;
}

async function search(query, limit = 5) {
  const data = await apiGet(API, { action: 'query', list: 'search', srsearch: query, srlimit: String(limit) });
  return (data?.query?.search || []).map((h) => h.title);
}

/** Candidate Wikipedia titles for a school name, most-likely first: an exact
 * title/redirect match (works for e.g. "Stanford" -> "Stanford University",
 * and for abbreviations Wikipedia redirects like "ETSU" -> "East Tennessee
 * State University" -- 'direct' tier, trusted unconditionally, since it's
 * Wikipedia's own redirect graph vouching for the identity), then plain
 * search hits, then search biased toward "university" for names that are
 * common English words or city names and get swamped by unrelated hits
 * ('search' tier -- just a relevance guess, needs corroboration; see
 * isPlausibleMatch). Short bare names like "Duke" or "Charlotte" resolve to
 * an unrelated non-redirect article of the same name in the 'direct' tier,
 * which fails the infobox check and falls through to 'search' harmlessly. */
async function directTitle(schoolName) {
  const direct = await apiGet(API, { action: 'query', titles: schoolName, redirects: '1' });
  const directPages = direct?.query?.pages ? Object.values(direct.query.pages) : [];
  return directPages.find((p) => !p.missing)?.title || null;
}

async function candidateTitles(schoolName, directHit) {
  const seen = new Set();
  const candidates = [];
  const add = (title, tier) => {
    if (title && !seen.has(title)) {
      seen.add(title);
      candidates.push({ title, tier });
    }
  };

  add(directHit, 'direct');
  for (const title of await search(schoolName)) add(title, 'search');
  for (const title of await search(`${schoolName} university`)) add(title, 'search');

  return candidates;
}

const STOPWORDS = new Set(['university', 'college', 'the', 'of', 'community']);

// Our own school names disambiguate same-named schools with a "(NY)"-style
// postal code -- e.g. "Westminster (UT)" for the one in Utah. That code
// almost never appears verbatim in the Wikipedia title (which spells out
// "Utah"), so it has to be expanded before token-overlap comparison or
// every disambiguated school name fails the guard outright.
export const STATE_ABBR = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california',
  co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia',
  hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa',
  ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland',
  ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri',
  mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'hampshire', nj: 'jersey',
  nm: 'mexico', ny: 'york', nc: 'carolina', nd: 'dakota', oh: 'ohio',
  ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania', ri: 'island', sc: 'carolina',
  sd: 'dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont',
  va: 'virginia', wa: 'washington', wv: 'virginia', wi: 'wisconsin', wy: 'wyoming',
};

/** Expands ONLY a parenthesized 2-letter code, e.g. "Westminster (UT)" ->
 * "Westminster utah" -- deliberately not a blanket abbreviation map applied
 * to every token, since "in", "or", "la", "me" etc. are ordinary English
 * words that would otherwise get corrupted wherever they appear, including
 * inside a Wikipedia title. */
function expandParenState(str) {
  return str.replace(/\(([a-zA-Z]{2})\)/g, (whole, code) => STATE_ABBR[code.toLowerCase()] || whole);
}

function tokenSet(str) {
  const words = expandParenState(str)
    // Apostrophe-like marks INSIDE a word (the Hawaiian ʻokina in
    // "Hawaiʻi", a plain apostrophe in "O'ahu") delete rather than split,
    // so "Hawaiʻi" normalizes to "hawaii" and still matches our own
    // plain-ASCII "Hawaii" -- treating it as a word boundary instead (the
    // generic non-alnum handling below) would have produced "hawai" + "i"
    // as two separate tokens, neither of which is "hawaii".
    .replace(/(\w)['’ʻʼ](\w)/gu, '$1$2')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  // "St." vs "Saint" is the other common spelling split our names and
  // Wikipedia's titles don't agree on ("Saint Lawrence" vs "St. Lawrence
  // University").
  return new Set(words.map((w) => (w === 'st' ? 'saint' : w)).filter((w) => !STOPWORDS.has(w)));
}

/** Abbreviations ("SMU", "CSUN") legitimately expand to a full name sharing
 * no lexical token with the abbreviation itself, so they're exempt from the
 * token-overlap half of the guard below -- the country check still applies. */
function looksLikeAbbreviation(name) {
  return name.length <= 6 && /^[A-Z.&]+$/.test(name);
}

/** A 'search' tier candidate is just a relevance guess and occasionally
 * locks onto a well-documented but entirely unrelated institution (Centre
 * College -> University of Calgary, Alma College -> University of Bologna)
 * purely because it has a populated infobox and the real target's article
 * is a stub. Two corroborating signals before trusting it: the infobox's
 * own `country` field, when present, must be the US; and (unless the school
 * name is abbreviation-like) the resolved title must share a real word with
 * the original name -- a SINGLE shared word isn't enough once the school
 * name has two or more words of its own ("Wallace State" sharing only
 * "Wallace" with the unrelated "Baldwin Wallace University" was exactly
 * this failure mode), so multi-word names need at least two words to
 * overlap.
 *
 * Returns a confidence tier rather than a boolean, because "plausible" and
 * "plausible" aren't equal: a school with an EXPLICIT `country = U.S.` field
 * should always be preferred over one that merely doesn't rule itself out
 * by omitting the field entirely ("La Salle" token-overlap-matches both the
 * real "La Salle University" (U.S., confirmed) and the unrelated "De La
 * Salle University" in the Philippines, which just never states a country
 * at all -- treating that omission as equally trustworthy let the wrong one
 * win purely because it turned up first). 0 = rejected. 1 = accepted, but
 * only for lack of a country field to contradict it. 2 = confirmed --
 * 'direct' tier (Wikipedia's own redirect graph vouches for it) or an
 * explicit `country = United States`. */
export function matchConfidence(schoolName, title, fields, tier) {
  if (tier === 'direct') return 2;

  if (!looksLikeAbbreviation(schoolName)) {
    // The REQUIRED overlap count is based on the school's base name only
    // (its parenthetical disambiguator stripped, e.g. "Trinity" out of
    // "Trinity (TX)") -- real institution titles usually don't spell out
    // the disambiguating state at all ("Trinity University", not "Trinity
    // Texas University"), so requiring it as one of the two overlapping
    // words made a large fraction of our own disambiguated names fail
    // outright even when correct. The full (state-expanded) token set is
    // still used for counting the overlap itself, so a state that DOES
    // appear in the title ("Xavier University of Louisiana") still counts
    // toward it, just isn't mandatory.
    const baseTokens = tokenSet(schoolName.replace(/\([^)]*\)/g, ''));
    if (baseTokens.size > 0) {
      const schoolTokens = tokenSet(schoolName);
      const titleTokens = tokenSet(title);
      const overlap = [...schoolTokens].filter((t) => titleTokens.has(t)).length;
      if (overlap < Math.min(2, baseTokens.size)) return 0;
    }
  }
  // Passed the name-relatedness check (or was exempt as an abbreviation) --
  // the country field is a tie-breaker on TOP of that, never a substitute
  // for it, or an unrelated-but-U.S. namesake would pass just for being
  // American ("Wallace State" sharing one word with the equally-American
  // but unrelated "Baldwin Wallace University").
  const country = extractField(fields, ['country']);
  if (!country) return 1;
  return /united states|\bu\.?s\.?a?\.?\b/i.test(country) ? 2 : 0;
}

export async function fetchSectionZero(title) {
  const data = await apiGet(API, { action: 'parse', page: title, prop: 'wikitext', section: '0' });
  return data?.parse?.wikitext?.['*'] || null;
}

/** Strips `{{...}}` templates, innermost-out, repeating until none remain --
 * a single non-overlapping regex pass only ever collapses the innermost
 * level, so a citation template nested inside a formatting wrapper (e.g.
 * `{{unbulleted|Paws the Lion<ref>{{Cite journal|...}}</ref>|...}}`) would
 * otherwise leave the now-unnested outer wrapper behind as literal text. */
function stripTemplates(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/\{\{[^{}]*\}\}/g, '');
  } while (s !== prev);
  return s;
}

function cleanWikitext(raw) {
  const withoutRefs = raw
    .replace(/\{\{color box\|(#?[0-9A-Fa-f]{3,8})\}\}/gi, '$1 ')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>.*?<\/ref>/gis, '')
    .replace(/<!--.*?-->/gs, '')
    .replace(/<br\s*\/?>/gi, ' / ')
    // Wikilinks resolved BEFORE the list-formatting templates below get a
    // chance to run, so a "|" inside "[[Fairleigh Dickinson Knights|
    // Knights]]" can never be mistaken for one of hlist's own separators
    // once this step is done.
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
    // {{hlist|A|B|C}} and friends just DISPLAY their args as a list --
    // stripTemplates below would otherwise delete the whole thing outright
    // as unrecognised noise (its content has no curly braces of its own,
    // so it reads as one simple, safely-removable template), losing a
    // real value like a dual men's/women's nickname entirely.
    .replace(/\{\{(?:hlist|unbulleted|plainlist|flatlist)\s*\|([^{}]*)\}\}/gi, (_, inner) => inner.split('|').join(' / '));
  return stripTemplates(withoutRefs)
    .replace(/'''?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits a MediaWiki template body on its top-level "|" characters, so a
 * "|" inside a nested [[wikilink|display]] or {{template|arg}} doesn't get
 * mistaken for the next field's separator. A naive per-field regex that
 * stops only at newlines breaks on the (surprisingly common) stub article
 * whose entire infobox is one unbroken line -- it happily runs past the
 * empty "nickname = " it's looking for and swallows the next several
 * "| param = value" pairs as if they were the value.
 */
function splitTemplateParams(body) {
  const params = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '[[' || two === '{{') {
      depth++;
      current += two;
      i++;
      continue;
    }
    if (two === ']]' || two === '}}') {
      depth = Math.max(0, depth - 1);
      current += two;
      i++;
      continue;
    }
    if (body[i] === '|' && depth === 0) {
      params.push(current);
      current = '';
      continue;
    }
    current += body[i];
  }
  params.push(current);
  return params;
}

/** Parses every `{{Infobox university ...}}` field on the page into a
 * lowercased key -> raw wikitext value map. Returns null if no such
 * infobox is present. */
export function parseInfobox(wikitext) {
  // Real Wikipedia articles occasionally contain a citation with a
  // genuinely malformed inner template -- e.g. College of Wooster's own
  // live page has a `<ref>{{cite web|url=...` whose "{{" is missing its
  // matching "}}" entirely (an editing mistake, not a rendering issue --
  // MediaWiki's own renderer is more forgiving of this than a strict
  // counter is). A single such anomaly anywhere makes a brace-depth walk
  // never find a balanced end for the REST OF THE PAGE, silently
  // truncating every field after it. Citations aren't needed for any
  // field we read, so strip them out (and HTML comments, same story) by
  // their HTML delimiters -- which don't care about brace balance --
  // before doing any curly-brace parsing at all, rather than trying to
  // out-think every way real-world wikitext can be malformed.
  const stripped = wikitext
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>.*?<\/ref>/gis, '')
    .replace(/<!--.*?-->/gs, '')
    // <nowiki> deliberately displays template/link syntax as literal text
    // (e.g. Fairleigh Dickinson's own infobox has a literal
    // "<nowiki>{{hlist|</nowiki>" as a label) -- exactly the same
    // false-brace problem as an unclosed citation, by design this time.
    .replace(/<nowiki>.*?<\/nowiki>/gis, '');

  const start = stripped.search(/\{\{\s*infobox\s+university/i);
  if (start === -1) return null;

  // Now that refs/comments/nowiki are stripped, walking the braces to find
  // the infobox's real, balanced end is safe again and matters: without
  // it, a field near the end of the infobox (mascot often is) has no
  // terminator to stop at other than the next top-level "|", so if the
  // infobox's true close isn't recognized, that field's value silently
  // swallows everything up to the next "|" ANYWHERE after it -- often the
  // page's entire lead paragraph of prose (seen on Samford, Stephen F.
  // Austin, and others). A fixed window without this check would need to
  // be small enough to never reach a following paragraph, but small
  // enough for that is too small for some legitimately long infoboxes.
  let depth = 0;
  let end = -1;
  for (let i = start; i < stripped.length - 1; i++) {
    const two = stripped.slice(i, i + 2);
    if (two === '{{') { depth++; i++; continue; }
    if (two === '}}') { depth--; i++; if (depth === 0) { end = i + 1; break; } }
  }
  // Rare fallback if the braces still never balance (some other malformed
  // construct this file doesn't know about yet): a bounded window beats
  // failing outright, even though it carries the same swallow risk.
  const WINDOW = 4000;
  const body = end === -1 ? stripped.slice(start + 2, start + WINDOW) : stripped.slice(start + 2, end - 2);
  const params = splitTemplateParams(body).slice(1); // drop the "Infobox university" head

  const fields = {};
  for (const param of params) {
    const eq = param.indexOf('=');
    if (eq === -1) continue;
    const key = param.slice(0, eq).trim().toLowerCase();
    fields[key] = param.slice(eq + 1);
  }
  return fields;
}

// A real nickname/mascot/logo-filename/country value is always a short
// phrase. Defense in depth against the field-boundary-detection bug class
// (a value that swallows unrelated trailing content ends up hundreds of
// characters long) -- treat an implausibly long result as a parsing
// failure rather than writing it as fact.
const MAX_FIELD_LENGTH = 120;

function extractField(fields, keys) {
  for (const key of keys) {
    const raw = fields[key];
    if (raw == null) continue;
    const cleaned = cleanWikitext(raw);
    if (cleaned && cleaned.length <= MAX_FIELD_LENGTH) return cleaned;
  }
  return null;
}

function extractColors(fields) {
  const raw = extractField(fields, ['colors', 'colours']);
  if (!raw) return { primary: null, secondary: null };
  const hexes = raw.match(/#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}\b/g) || [];
  return { primary: hexes[0] || null, secondary: hexes[1] || null };
}

export async function resolveLogoUrl(filename) {
  if (!filename) return null;
  const title = `File:${filename.replace(/^File:/i, '').trim()}`;
  for (const base of [COMMONS_API, API]) {
    try {
      const data = await apiGet(base, { action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url' });
      const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
      const page = pages.find((p) => p.imageinfo);
      if (page) return page.imageinfo[0].url;
    } catch {
      // try the next source
    }
  }
  return null;
}

export function readInfoboxFacts(fields) {
  // The Infobox university template renamed `nickname` to `sports_nickname`
  // at some point; older/unmigrated articles may still use the plain name.
  const nickname = extractField(fields, ['sports_nickname', 'nickname']);
  const mascot = extractField(fields, ['mascot']);
  const logoFile = extractField(fields, ['logo']);
  const { primary, secondary } = extractColors(fields);
  // `website` is not written anywhere -- it is used to VERIFY that the article we
  // resolved really is this school, by comparing it against domains we already hold
  // from the coaching-contact CSVs. See individualisation/verify_mappings.py.
  const website = extractField(fields, ['website']);
  return { nickname, mascot, logoFile, primary, secondary, website };
}

/** Full lookup for one school: title resolution -> infobox -> fields.
 *
 * Every candidate that has an infobox AND passes isPlausibleMatch gets
 * collected (not just the first) -- among those, the first one that
 * actually carries a nickname or mascot wins; if none do, we fall back to
 * the first plausible one anyway (still useful for colors/logo).
 *
 * Collecting the full plausible set rather than stopping at the first hit
 * matters both ways: a school's flagship article (e.g. "Indiana
 * University") sometimes lacks the sports nickname that a more specific,
 * equally plausible campus article carries ("Indiana University
 * Bloomington") -- so we want to keep looking past a blank plausible
 * match. But stopping at the very first plausible match without collecting
 * the rest breaks the opposite way: "Rocky Mountain" plausibly matches
 * BOTH "Rocky Mountain University of Health Professions" (search ranks it
 * first, has no athletics nickname) and "Rocky Mountain College" (has
 * "Battlin' Bears") -- locking onto whichever is plausible *first* would
 * have permanently shadowed the real target. Scanning the whole plausible
 * set and preferring the ones with actual identity data gets both cases
 * right without needing to know in advance which candidate is "the same
 * institution, just more specific" versus "a different institution
 * entirely" -- matchConfidence already excludes the latter. Within that,
 * confidence tier 2 (confirmed) always wins over tier 1 (merely not ruled
 * out), so a confirmed-U.S. match can't lose to an unrelated foreign
 * namesake just for turning up first and also having a nickname. */
export async function lookupIdentity(schoolName) {
  // The direct probe is tried BEFORE the two search queries. A 'direct' hit is
  // Wikipedia's own redirect graph vouching for the identity (confidence 2, trusted
  // unconditionally), and the selection below already prefers it over every search hit --
  // so when it carries a nickname, fetching the other ten candidates cannot change the
  // answer, only the runtime. Skipping them takes a full backfill from ~4 hours to ~25
  // minutes. Anything less certain still gets the complete candidate sweep.
  const directHit = await directTitle(schoolName);
  if (directHit) {
    const wikitext = await fetchSectionZero(directHit);
    const fields = wikitext && parseInfobox(wikitext);
    if (fields) {
      const facts = readInfoboxFacts(fields);
      if (facts.nickname) {
        return {
          title: directHit,
          nickname: facts.nickname,
          mascot: facts.mascot,
          primary_color: facts.primary,
          secondary_color: facts.secondary,
          logo_url: await resolveLogoUrl(facts.logoFile),
        };
      }
    }
  }

  const candidates = await candidateTitles(schoolName, directHit);
  const plausible = [];

  for (const { title, tier } of candidates) {
    const wikitext = await fetchSectionZero(title);
    const fields = wikitext && parseInfobox(wikitext);
    if (!fields) continue;
    const confidence = matchConfidence(schoolName, title, fields, tier);
    if (confidence === 0) continue;
    plausible.push({ title, confidence, facts: readInfoboxFacts(fields) });
  }
  if (plausible.length === 0) return null;

  const byPreference = [...plausible].sort((a, b) => b.confidence - a.confidence);
  const chosen = byPreference.find((p) => p.facts.nickname || p.facts.mascot) || byPreference[0];
  const { nickname, mascot, logoFile, primary, secondary } = chosen.facts;
  if (!nickname && !mascot && !primary && !logoFile) return null;

  const logo_url = await resolveLogoUrl(logoFile);
  return { title: chosen.title, nickname, mascot, primary_color: primary, secondary_color: secondary, logo_url };
}

export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i).catch((err) => ({ error: err.message }));
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  const allColleges = College.list();
  const pending = REPAIR_NAMES
    ? allColleges.filter((c) => REPAIR_NAMES.includes(c.name))
    : allColleges.filter((c) => !c.nickname);
  const byName = new Map();
  for (const c of pending) {
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  }
  const names = [...byName.keys()].slice(0, LIMIT);

  console.log(`${allColleges.length} colleges total, ${pending.length} ${REPAIR_NAMES ? 'targeted for repair' : 'missing a nickname'}, ` +
    `${names.length} unique school names to look up${APPLY ? '' : ' (dry run)'}.`);

  let filled = 0;
  let noMatch = 0;
  let errors = 0;
  let done = 0;

  await mapWithConcurrency(names, CONCURRENCY, async (name) => {
    let identity;
    try {
      identity = await lookupIdentity(name);
    } catch (err) {
      errors++;
      console.log(`ERROR  ${name}: ${err.stack}`);
      return;
    }
    done++;
    if (done % 50 === 0) console.log(`... ${done}/${names.length} looked up`);

    if (!identity) {
      noMatch++;
      if (APPLY) {
        const force = !!REPAIR_NAMES;
        for (const row of byName.get(name)) {
          const patch = {};
          if (!row.identity_notes) patch.identity_notes = 'No usable Wikipedia infobox found for this name';
          // In force mode there may be corrupted data left over from a
          // since-fixed extraction bug on a row whose fresh lookup this
          // time found nothing plausible at all -- clear it rather than
          // leave the corruption behind just because nothing replaced it.
          if (force) {
            if (row.nickname) { patch.nickname = null; patch.nickname_plural = null; }
            if (row.mascot) patch.mascot = null;
            if (row.primary_color) patch.primary_color = null;
            if (row.secondary_color) patch.secondary_color = null;
            if (row.logo_url) patch.logo_url = null;
          }
          if (Object.keys(patch).length > 0) College.update(row.id, patch);
        }
      }
      return;
    }

    filled++;
    console.log(`OK     ${name} -> ${identity.title}: nickname=${identity.nickname || '—'} mascot=${identity.mascot || '—'} colors=${identity.primary_color || '—'}/${identity.secondary_color || '—'} logo=${identity.logo_url ? 'yes' : 'no'}`);

    if (!APPLY) return;
    const force = !!REPAIR_NAMES;
    for (const row of byName.get(name)) {
      const patch = {};
      // In force mode a field that comes back genuinely empty this time
      // still needs writing as null, to clear out whatever corrupted value
      // is sitting there -- not just skipped because it's falsy.
      if (force || (!row.nickname && identity.nickname)) {
        patch.nickname = identity.nickname ?? null;
        patch.nickname_plural = identity.nickname ? (isPluralNickname(identity.nickname) ? 1 : 0) : null;
      }
      if (force || (!row.mascot && identity.mascot)) patch.mascot = identity.mascot ?? null;
      if (force || (!row.primary_color && identity.primary_color)) patch.primary_color = identity.primary_color ?? null;
      if (force || (!row.secondary_color && identity.secondary_color)) patch.secondary_color = identity.secondary_color ?? null;
      if (force || (!row.logo_url && identity.logo_url)) patch.logo_url = identity.logo_url ?? null;
      if (Object.keys(patch).length > 0) {
        patch.identity_source = `wikipedia:${identity.title}`;
        College.update(row.id, patch);
      }
    }
  });

  console.log(`\nDone. ${filled} identified, ${noMatch} no usable infobox, ${errors} errors, ` +
    `out of ${names.length} unique names.`);
  if (!APPLY) console.log('Dry run only -- re-run with --apply to write these to the database.');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
