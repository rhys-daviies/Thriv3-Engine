#!/usr/bin/env node
/**
 * Bulk version of populateSchoolIdentity.js's 'direct' tier.
 *
 * WHY THIS EXISTS. The per-school script issues ~4-15 API calls per name. Across the ~1000
 * schools still missing an identity that is enough traffic to trip Wikipedia's anonymous
 * rate limit, and once tripped every call returns 429 and the script's own exponential
 * backoff (up to 64s) makes it slower the harder it tries -- measured at 1.3 schools per
 * minute, i.e. days rather than hours.
 *
 * action=query accepts up to 50 titles at once AND returns page content in the same
 * response, so the 'direct' probe and the section fetch collapse into ONE request per 50
 * schools. Same source, same guards, ~50x fewer requests.
 *
 * WHAT IT IS ALLOWED TO DECIDE. Only the 'direct' tier -- Wikipedia's own redirect graph
 * resolving a name to an article, which populateSchoolIdentity.js already trusts
 * unconditionally at confidence 2. Two extra checks, because a bulk pass gets no second
 * look:
 *   - the article must actually be a university/college infobox, not a same-named town,
 *     person or band that happens to occupy the title;
 *   - the resolved title must still pass matchConfidence at the STRICTEST tier, so a
 *     redirect that lands somewhere unrelated is rejected rather than written.
 * Anything it will not decide is left for the per-school script's full search sweep.
 *
 * Usage:
 *   node server/scripts/populateIdentityBatched.js [--apply] [--batch 50] [--sport X]
 */
import fs from 'node:fs';
import { College } from '../db/entities/college.js';
import { isPluralNickname } from '../lib/nicknameGrammar.js';
import { parseInfobox, readInfoboxFacts, matchConfidence, resolveLogoUrl, STATE_ABBR } from './populateSchoolIdentity.js';

const API = 'https://en.wikipedia.org/w/api.php';
const UA = 'RecruitmatchSchoolIdentityBot/1.0 (contact: rhys.davies@cardaxia.ai)';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const num = (flag, dflt) => {
  const a = args.find((x) => x.startsWith(flag));
  return a ? Number(a.split('=')[1] || args[args.indexOf(a) + 1]) : dflt;
};
const BATCH = num('--batch', 50);
const PAUSE = num('--pause', 1200);          // ms between batches; deliberately generous
const sportArg = args.find((a) => a.startsWith('--sport'));
const SPORT = sportArg ? (sportArg.split('=')[1] || args[args.indexOf(sportArg) + 1]) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiGet(params, attempt = 1) {
  const url = new URL(API);
  url.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt > 7) throw new Error(`HTTP ${res.status} after ${attempt} attempts`);
    const wait = Math.min(90_000, 2000 * 2 ** attempt);
    console.log(`   (${res.status}; waiting ${Math.round(wait / 1000)}s)`);
    await sleep(wait);
    return apiGet(params, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** One request: resolve up to BATCH names through redirects AND pull their wikitext. */
async function fetchBatch(names) {
  const data = await apiGet({
    action: 'query', redirects: '1', titles: names.join('|'),
    prop: 'revisions', rvprop: 'content', rvslots: 'main',
  });
  const q = data?.query || {};
  // requested name -> final title, following normalisation then redirects
  const map = new Map(names.map((n) => [n, n]));
  for (const n of q.normalized || []) {
    for (const [k, v] of map) if (v === n.from) map.set(k, n.to);
  }
  for (const r of q.redirects || []) {
    for (const [k, v] of map) if (v === r.from) map.set(k, r.to);
  }
  const byTitle = new Map();
  for (const p of Object.values(q.pages || {})) {
    if (p.missing !== undefined) continue;
    const text = p.revisions?.[0]?.slots?.main?.['*'];
    if (text) byTitle.set(p.title, text);
  }
  return { map, byTitle };
}

const UNI_INFOBOX = /infobox\s+(university|college|school|secondary school)/i;

/** Titles to try for one of our school names, most-likely first.
 *
 * Our names are athletics short forms -- "Adrian", "Albion", "Alma" -- and a bare redirect
 * for those lands on the TOWN, not the college, which is why a direct-only bulk pass
 * filled just 9 of the first 140. Appending the suffix Wikipedia actually uses in the
 * article title recovers them, and since every round is still batched 50-at-a-time the
 * extra passes cost a handful of requests, not a thousand.
 *
 * Parenthesised disambiguators ("Westminster (UT)") are expanded to the spelled-out state
 * Wikipedia titles use, and also tried with the paren dropped entirely. */
function variantsFor(name) {
  const out = [name];
  const paren = name.match(/\(([A-Za-z. ]{2,20})\)/);
  const base = name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const state = paren
    ? (STATE_ABBR[paren[1].trim().toLowerCase()] || paren[1].trim().toLowerCase())
    : null;
  const cap = (w) => w.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const hasSuffix = /\b(university|college|institute|academy|seminary|school)\b/i.test(base);
  if (base !== name) out.push(base);
  if (!hasSuffix) {
    out.push(`${base} University`, `${base} College`);
    if (state) out.push(`${base} University (${cap(state)})`, `${base} College (${cap(state)})`);
  } else if (state) {
    out.push(`${base} (${cap(state)})`);
  }
  return [...new Set(out)];
}

async function main() {
  const all = College.list();
  const pool = SPORT ? all.filter((c) => c.sport === SPORT) : all;
  const pending = pool.filter((c) => !c.nickname);
  const byName = new Map();
  for (const c of pending) {
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  }
  let names = [...byName.keys()];
  const variants = new Map(names.map((n) => [n, variantsFor(n)]));
  const maxRounds = Math.max(...[...variants.values()].map((v) => v.length));
  console.log(`${pending.length} rows missing a nickname, ${names.length} unique names, ` +
    `up to ${maxRounds} title variants each${APPLY ? '' : ' (dry run)'}`);

  const logoCache = new Map();
  const resolved = new Map();
  const reasons = { noArticle: 0, notASchool: 0, rejected: 0, noFacts: 0 };

  for (let round = 0; round < maxRounds; round++) {
    const todo = names.filter((n) => !resolved.has(n) && variants.get(n)[round]);
    if (!todo.length) continue;
    console.log(`\n--- round ${round + 1}: ${todo.length} names, trying "${variants.get(todo[0])[round]}"-style titles`);
    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH);
      const titles = chunk.map((n) => variants.get(n)[round]);
      let res;
      try {
        res = await fetchBatch(titles);
      } catch (err) {
        console.log(`   batch failed: ${err.message}`);
        continue;
      }
      for (let j = 0; j < chunk.length; j++) {
        const name = chunk[j];
        const title = res.map.get(titles[j]);
        const wikitext = title && res.byTitle.get(title);
        if (!wikitext) { reasons.noArticle++; continue; }
        if (!UNI_INFOBOX.test(wikitext.slice(0, 6000))) { reasons.notASchool++; continue; }
        const fields = parseInfobox(wikitext);
        if (!fields) { reasons.notASchool++; continue; }
        if (matchConfidence(name, title, fields, 'search') === 0) { reasons.rejected++; continue; }
        const facts = readInfoboxFacts(fields);
        if (!facts.nickname && !facts.mascot && !facts.primary && !facts.logoFile) {
          reasons.noFacts++; continue;
        }
        resolved.set(name, { title, facts, round: round + 1, tried: titles[j] });
      }
      await sleep(PAUSE);
    }
    console.log(`   resolved so far: ${resolved.size}/${names.length}`);
  }

  let written = 0, withNickname = 0;
  for (const [name, { title, facts }] of resolved) {
    let logo = null;
    if (facts.logoFile) {
      if (!logoCache.has(facts.logoFile)) logoCache.set(facts.logoFile, await resolveLogoUrl(facts.logoFile));
      logo = logoCache.get(facts.logoFile);
    }
    if (facts.nickname) withNickname++;
    if (!APPLY) continue;
    for (const row of byName.get(name)) {
      const patch = { identity_source: `wikipedia:${title}` };
      if (facts.nickname) {
        patch.nickname = facts.nickname;
        patch.nickname_plural = isPluralNickname(facts.nickname) ? 1 : 0;
      }
      if (facts.mascot) patch.mascot = facts.mascot;
      if (facts.primary) patch.primary_color = facts.primary;
      if (facts.secondary) patch.secondary_color = facts.secondary;
      if (logo) patch.logo_url = logo;
      College.update(row.id, patch);
      written++;
    }
  }

  // Dump every mapping with the ROUND that produced it. Round 1 is Wikipedia's own
  // redirect for our exact name -- the tier the per-school script already trusts. Later
  // rounds are titles WE constructed, which is precisely how a short name lands on the
  // wrong institution ("Miami" -> Miami University in Ohio), so they get reviewed before
  // anything is written.
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  fs.writeFileSync('/Users/rhysdavies/Documents/Recruitmatch/individualisation/identity_mappings.csv',
    ['school,round,tried_title,resolved_title,nickname,mascot,primary_color,article_website',
     ...[...resolved].map(([n, r]) => [n, r.round, r.tried, r.title, r.facts.nickname,
       r.facts.mascot, r.facts.primary, r.facts.website].map(esc).join(','))].join('\n'));

  const unresolved = names.filter((n) => !resolved.has(n));
  console.log(`\nresolved ${resolved.size}/${names.length} names (${withNickname} with a nickname), ` +
    `${written} rows written`);
  console.log('misses:', reasons);
  fs.writeFileSync('/Users/rhysdavies/Documents/Recruitmatch/individualisation/unresolved_names.json',
    JSON.stringify(unresolved, null, 1));
  if (!APPLY) console.log('Dry run -- re-run with --apply to write.');
}

main();
