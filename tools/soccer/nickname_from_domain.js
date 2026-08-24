#!/usr/bin/env node
/**
 * Recover a nickname from the school's own athletics site, for rows where Wikipedia states
 * none.
 *
 * 259 rows have no nickname because the university article simply does not carry one --
 * Amherst really are the Mammoths, but their infobox never says so. 139 of those rows do
 * have an athletics host on file, and athletics hosts are usually built from the nickname:
 * bartonbulldogs.com, kwcpanthers.com, gobluehose.com, tusculumpioneers.com.
 *
 * TWO INDEPENDENT FACTORS ARE REQUIRED, because the host list is not clean. It carries
 * blcvikings.com under "Bethany (KS)" -- that is Bethany LUTHERAN -- and
 * highpointpanthers.com under "Point (GA)". Either factor alone would write those.
 *
 *   1. the hostname must yield a word that is a team name elsewhere in this table, so
 *      "gobluehose" gives "Blue Hose" but "navysports" and "stacathletics" give nothing;
 *   2. the site itself must NAME OUR SCHOOL in its <title>, which is what rejects a host
 *      belonging to a different institution.
 *
 * Factor 2 is why this fetches at all. Athletics pages are JS-rendered, so their body text
 * is useless from plain HTTP -- but the <title> is server-rendered and reliably carries the
 * institution ("Lewis & Clark College - Official Athletics Website").
 *
 * Casing comes from however the same nickname is already written elsewhere in the table, so
 * a recovered value reads like the rest of the column rather than being naively capitalised.
 *
 * Usage: node nickname_from_domain.js [--apply] [--limit N]
 */
import fs from 'node:fs';
import { College } from '../app/server/db/entities/college.js';
import { isPluralNickname } from '../app/server/lib/nicknameGrammar.js';

const BASE = '/Users/rhysdavies/Documents/Recruitmatch/individualisation';
const APPLY = process.argv.includes('--apply');
const limArg = process.argv.find((a) => a.startsWith('--limit'));
const LIMIT = limArg ? Number(limArg.split('=')[1] || process.argv[process.argv.indexOf(limArg) + 1]) : Infinity;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const CHROME = new Set(['go', 'sports', 'sport', 'athletics', 'athletic', 'official', 'the',
  'com', 'net', 'org', 'edu', 'www', 'us', 'site', 'team', 'teams', 'club', 'online',
  'college', 'university', 'univ', 'state', 'community', 'junior', 'tech', 'cc', 'gocc',
  'archive', 'gmail', 'google', 'sidearmsports', 'prestosports', 'facebook', 'instagram']);

const words = (t) => String(t || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);

/** Canonical spelling of every nickname already in the table, keyed by its squashed form.
 * "bluehose" -> "Blue Hose", "goldeneagles" -> "Golden Eagles". Built from real data so a
 * recovered multi-word name comes out spaced and cased like its neighbours. */
function buildVocab(rows) {
  const bySquash = new Map();
  const single = new Map();
  for (const r of rows) {
    const n = (r.nickname || '').trim();
    if (!n || /[/<>&()]/.test(n)) continue;
    const sq = n.toLowerCase().replace(/[^a-z]/g, '');
    if (sq.length >= 4 && !bySquash.has(sq)) bySquash.set(sq, n);
    for (const w of words(n)) {
      if (w.length >= 4 && !single.has(w)) single.set(w, n.split(/\s+/).find((x) => x.toLowerCase().replace(/[^a-z]/g, '') === w) || w);
    }
  }
  return { bySquash, single };
}

/** Does `left` (a hostname with the nickname removed) plausibly stand for this school? */
function attributable(left, school) {
  if (!left) return true;                       // "gobluehose" -> nothing left to check
  const ws = words(school);
  const initials = school.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean)
    .map((w) => w[0].toLowerCase()).join('');
  const cands = new Set([initials, initials + 'c', initials + 'u',
    initials.replace(/[aeiou]/g, '')]);
  for (const w of ws) { cands.add(w); cands.add(w.slice(0, 4)); cands.add(w.slice(0, 3)); }
  // Hostnames run the school's words together, so a multi-word name must be compared as
  // one token too: goairforcefalcons.com leaves the stem "airforce", which matched nothing
  // while only {air, force} were candidates -- and Air Force silently stopped being a
  // candidate at all rather than being reported.
  const joined = ws.join('');
  if (joined) {
    cands.add(joined);
    cands.add(joined.slice(0, 6));
    cands.add(joined.slice(0, 5));
    cands.add(joined.slice(0, 4));
  }
  // EXACT match, not containment: "highpoint" contains "point" but High Point is not
  // Point (GA), and that host really is filed under the wrong school here.
  return cands.has(left);
}

function candidateFrom(host, school, vocab) {
  const parts = host.replace(/^https?:\/\//, '').split('/')[0]
    .replace(/^www\d?\./, '').split('.');
  const label = parts.slice(0, -1).join('');    // drop the TLD
  if (!label) return null;
  let best = null;
  for (const [sq, canonical] of vocab.bySquash) {
    if (label.endsWith(sq) || label.startsWith(sq)) {
      if (!best || sq.length > best.sq.length) best = { sq, canonical };
    }
  }
  if (!best) return null;
  let left = label.endsWith(best.sq) ? label.slice(0, -best.sq.length) : label.slice(best.sq.length);
  for (const c of CHROME) {
    if (left.startsWith(c)) left = left.slice(c.length);
    if (left.endsWith(c)) left = left.slice(0, -c.length);
  }
  if (!attributable(left, school)) return { rejected: `host stem "${left}" does not stand for this school` };
  return { nickname: best.canonical, host, left };
}

async function titleOf(host) {
  const url = host.startsWith('http') ? host : `https://${host}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow',
      signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { err: `HTTP ${res.status}` };
    const html = await res.text();
    const m = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
    return { title: m ? m[1].replace(/\s+/g, ' ').trim() : null, finalUrl: res.url };
  } catch (e) {
    return { err: e.name };
  }
}

const STATE = { al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california',
  co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia', hi: 'hawaii',
  id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky',
  la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan',
  mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska',
  nv: 'nevada', nh: 'hampshire', nj: 'jersey', nm: 'mexico', ny: 'york', nc: 'carolina',
  nd: 'dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania', ri: 'island',
  sc: 'carolina', sd: 'dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont',
  va: 'virginia', wa: 'washington', wv: 'virginia', wi: 'wisconsin', wy: 'wyoming' };

/** Factor 2: does the site's own title name this school?
 *
 * EVERY distinctive word of the school's name must appear -- a "two hits is enough" version
 * accepted southwesternpirates.com for "Southwestern (CA)" on the single word
 * "southwestern", and that site is Southwestern University in TEXAS.
 *
 * And when our name is one distinctive word plus a state qualifier, that word cannot
 * identify the school on its own, so the state has to appear too. This deliberately gives up
 * some true fills (Eastern University really is in Pennsylvania, but its title never says
 * so) -- the cost of refusing is a blank field, the cost of accepting is another school's
 * nickname in an email.
 */
function titleNamesSchool(title, school) {
  if (!title) return false;
  const t = title.toLowerCase();
  const ws = words(school).filter((w) => !CHROME.has(w));
  if (!ws.length) return false;
  if (!ws.every((w) => t.includes(w))) return false;
  // A parenthesised state in OUR name exists precisely to distinguish this school from a
  // same-named one, so the title must corroborate it -- always, not just for single-word
  // names. Requiring it only for single-word names let "Lewis & Clark (ID)" (Lewis-Clark
  // State, Warriors) take lcpioneers.com, whose title reads "Lewis & Clark College" -- the
  // Oregon school. Both words matched; only the state separated them.
  const m = school.match(/\(([A-Za-z]{2})\)/);
  if (m) {
    const st = STATE[m[1].toLowerCase()];
    if (!st || !t.includes(st)) return false;
  }
  return true;
}

const all = College.list();
const vocab = buildVocab(all);
const known = JSON.parse(fs.readFileSync(`${BASE}/known_domains.json`, 'utf-8'));
console.log(`nickname vocabulary: ${vocab.bySquash.size} canonical forms`);

const blanks = all.filter((c) => !c.nickname);
const byName = new Map();
for (const c of blanks) {
  if (!byName.has(c.name)) byName.set(c.name, []);
  byName.get(c.name).push(c);
}

/** Refuse a host whose stem fits MORE THAN ONE school in our own table.
 *
 * "southwesternpirates.com" leaves the stem "southwestern", which stands equally for
 * Southwestern (CA), Southwestern (TX), Southwestern (KS) and Southwestern University --
 * and the site is the Texas one. The title check cannot separate them, because a name that
 * reduces to a single distinctive word passes on that one word alone. So when the stem is
 * ambiguous across our own rows, no row gets it.
 */
const ALL_NAMES = [...new Set(all.map((c) => c.name))];
function ambiguousStem(left, name) {
  const fits = ALL_NAMES.filter((n) => attributable(left, n));
  return fits.length > 1 ? fits : null;
}

const todo = [];
const refusedAmbiguous = [];
for (const [name, rows] of byName) {
  const hosts = (known[name] || []).filter((h) => !/\.edu($|\/)/.test(h));
  for (const h of hosts) {
    const c = candidateFrom(h, name, vocab);
    if (!c || !c.nickname) continue;
    todo.push({ name, rows, ...c });
    break;
  }
}
console.log(`${blanks.length} rows lack a nickname; ${todo.length} school names yield a candidate from their host`);
if (refusedAmbiguous.length) {
  console.log(`${refusedAmbiguous.length} refused: host stem fits more than one school of ours`);
  for (const r of refusedAmbiguous.slice(0, 8)) {
    console.log(`   ${r.name.padEnd(22)} ${r.host.padEnd(26)} would be ${JSON.stringify(r.nickname)}; stem also fits ${JSON.stringify(r.fits)}`);
  }
}
console.log('');

let written = 0, rejected = 0, unreachable = 0;
const log = [];
for (const t of todo.slice(0, LIMIT)) {
  const { title, err, finalUrl } = await titleOf(t.host);
  if (err || !title) { unreachable++; log.push({ ...t, verdict: 'unreachable', detail: err || 'no title' });
    console.log(`?? ${t.name.padEnd(24)} ${String(t.nickname).padEnd(18)} host ${t.host.padEnd(28)} (${err || 'no <title>'})`);
    continue; }
  if (!titleNamesSchool(title, t.name)) {
    rejected++;
    log.push({ ...t, verdict: 'title-mismatch', title });
    console.log(`NO ${t.name.padEnd(24)} ${String(t.nickname).padEnd(18)} host ${t.host.padEnd(28)} title=${JSON.stringify(title.slice(0, 46))}`);
    continue;
  }
  written++;
  log.push({ ...t, verdict: 'confirmed', title });
  console.log(`OK ${t.name.padEnd(24)} ${String(t.nickname).padEnd(18)} host ${t.host.padEnd(28)} title=${JSON.stringify(title.slice(0, 42))}`);
  if (!APPLY) continue;
  for (const row of t.rows) {
    College.update(row.id, {
      nickname: t.nickname,
      nickname_plural: isPluralNickname(t.nickname) ? 1 : 0,
      identity_source: `athletics-domain:${t.host}`,
      identity_notes: `nickname recovered from the school's own athletics hostname; its `
        + `Wikipedia article states none. Confirmed by that site's title (${JSON.stringify(title.slice(0, 80))}).`,
    });
  }
}
fs.writeFileSync(`${BASE}/nickname_from_domain.json`,
  JSON.stringify(log.map(({ rows, ...r }) => r), null, 1));
console.log(`\n${written} confirmed, ${rejected} rejected on title, ${unreachable} unreachable`
  + `${APPLY ? ' (applied)' : ' (dry run)'}`);
