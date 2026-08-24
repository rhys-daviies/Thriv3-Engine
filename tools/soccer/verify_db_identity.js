#!/usr/bin/env node
/**
 * Verify every identity row already IN the database against the school's known web domain.
 *
 * The full per-school crawl has run and written 2167 rows. Its own guards are good, but one
 * failure mode they cannot catch is a name that legitimately resolves to a REAL university
 * article that happens to be a different institution sharing our school's name: "Amherst"
 * -> University of Massachusetts Amherst (Minutemen) when our Amherst is Amherst College
 * (Mammoths); "Army" -> Army University rather than West Point.
 *
 * The check is evidence collected independently of Wikipedia -- each school's athletics host
 * and coaches' email domain from the coaching-contact CSVs, plus athletics_domains.json.
 * The article's infobox `website` must share a registrable domain with something we already
 * knew. Amherst College publishes amherst.edu, UMass publishes umass.edu.
 *
 * The website is read with populateSchoolIdentity.js's own parseInfobox, NOT a regex over
 * the page: "|website=" also matches the website parameter of every {{cite web}} citation,
 * which in a first attempt made East Carolina, Kansas State and Illinois State all appear
 * to publish iu.edu and produced 135 false rejections.
 *
 * Read-only. Writes a verdict file; repairs are a separate, reviewable step.
 */
import fs from 'node:fs';
import { College } from '../app/server/db/entities/college.js';
import { parseInfobox, readInfoboxFacts } from '../app/server/scripts/populateSchoolIdentity.js';

const BASE = '/Users/rhysdavies/Documents/Recruitmatch/individualisation';
const API = 'https://en.wikipedia.org/w/api.php';
const UA = 'RecruitmatchIdentityCheck/1.0 (contact: rhys.davies@cardaxia.ai)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TWO_LEVEL = new Set(['ac.uk', 'edu.au', 'co.uk', 'com.au', 'edu.ph']);
const GENERIC = new Set(['sidearmsports.com', 'prestosports.com', 'wordpress.com',
  'wixsite.com', 'archive.org', 'gmail.com', 'facebook.com', 'twitter.com', 'x.com',
  'instagram.com', 'youtube.com']);

function registrable(host) {
  let h = String(host || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  h = h.split('?')[0].split(':')[0].replace(/^www\d?\./, '');
  const p = h.split('.').filter(Boolean);
  if (p.length < 2) return null;
  if (TWO_LEVEL.has(p.slice(-2).join('.')) && p.length >= 3) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}

function domainsIn(v) {
  const out = [];
  const re = /(?:https?:\/\/)?(?:www\d?\.)?([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi;
  let m;
  while ((m = re.exec(String(v || '')))) {
    const d = registrable(m[1]);
    if (d && !GENERIC.has(d)) out.push(d);
  }
  return [...new Set(out)];
}

async function api(params, attempt = 1) {
  const url = new URL(API);
  url.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt > 7) throw new Error(`HTTP ${res.status}`);
    const w = Math.min(90000, 2000 * 2 ** attempt);
    console.log(`   (${res.status}; waiting ${Math.round(w / 1000)}s)`);
    await sleep(w);
    return api(params, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchBatch(titles) {
  const d = await api({ action: 'query', titles: titles.join('|'),
    prop: 'revisions', rvprop: 'content', rvslots: 'main' });
  const q = d.query || {};
  const alias = new Map(titles.map((t) => [t, t]));
  for (const n of q.normalized || []) for (const [k, v] of alias) if (v === n.from) alias.set(k, n.to);
  for (const r of q.redirects || []) for (const [k, v] of alias) if (v === r.from) alias.set(k, r.to);
  const text = new Map();
  for (const p of Object.values(q.pages || {})) {
    if (p.missing !== undefined) continue;
    const t = p.revisions?.[0]?.slots?.main?.['*'];
    if (t) text.set(p.title, t);
  }
  const out = new Map();
  for (const t of titles) out.set(t, text.get(alias.get(t)) || null);
  return out;
}

const known = JSON.parse(fs.readFileSync(`${BASE}/known_domains.json`, 'utf-8'));
const knownDom = new Map(Object.entries(known).map(([k, v]) =>
  [k, new Set(v.flatMap(domainsIn))]));

const rows = College.list().filter((c) => c.identity_source?.startsWith('wikipedia:'));
const titles = [...new Set(rows.map((c) => c.identity_source.slice('wikipedia:'.length)))];
console.log(`${rows.length} rows, ${titles.length} distinct articles, ${Math.ceil(titles.length / 50)} requests`);

const info = new Map();
for (let i = 0; i < titles.length; i += 50) {
  const chunk = titles.slice(i, i + 50);
  let got;
  try { got = await fetchBatch(chunk); } catch (e) { console.log(`  batch ${i} failed: ${e.message}`); continue; }
  for (const [t, wt] of got) {
    if (!wt) { info.set(t, { missing: true }); continue; }
    const fields = parseInfobox(wt);
    if (!fields) { info.set(t, { noInfobox: true }); continue; }
    const facts = readInfoboxFacts(fields);
    info.set(t, { website: facts.website, nickname: facts.nickname, mascot: facts.mascot });
  }
  if ((i / 50) % 5 === 0) console.log(`... ${Math.min(i + 50, titles.length)}/${titles.length}`);
  await sleep(700);
}

const tally = {};
const out = [];
for (const c of rows) {
  const title = c.identity_source.slice('wikipedia:'.length);
  const art = info.get(title) || {};
  const arts = domainsIn(art.website);
  const mine = knownDom.get(c.name) || new Set();
  let verdict;
  if (art.missing) verdict = 'article_missing';
  else if (art.noInfobox) verdict = 'no_infobox';
  else if (!mine.size) verdict = 'unknown_school';
  else if (!arts.length) verdict = 'unknown_article';
  else if (arts.some((d) => mine.has(d))) verdict = 'match';
  else verdict = 'MISMATCH';
  tally[verdict] = (tally[verdict] || 0) + 1;
  out.push({ id: c.id, name: c.name, sport: c.sport, division: c.division,
    nickname: c.nickname, title, article_domains: arts,
    known_domains: [...mine], verdict });
}
fs.writeFileSync(`${BASE}/db_identity_verdicts.json`, JSON.stringify(out, null, 1));
console.log('\n' + JSON.stringify(tally));
const bad = out.filter((o) => o.verdict === 'MISMATCH');
const byName = new Map();
for (const b of bad) if (!byName.has(b.name)) byName.set(b.name, b);
console.log(`\n--- ${bad.length} mismatching rows (${byName.size} distinct schools) ---`);
for (const b of [...byName.values()].slice(0, 60)) {
  console.log(`  ${b.division.padEnd(8)} ${b.name.slice(0, 26).padEnd(26)} -> ${b.title.slice(0, 34).padEnd(34)} ` +
    `nick=${String(b.nickname || '-').slice(0, 16).padEnd(16)} article=${b.article_domains.slice(0, 2)} ours=${b.known_domains.slice(0, 2)}`);
}
