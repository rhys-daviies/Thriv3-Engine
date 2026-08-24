#!/usr/bin/env node
/**
 * Repair the identity rows the domain check proved wrong.
 *
 * Each of these resolved to a REAL university article that is a DIFFERENT institution
 * sharing our school's name -- the one failure mode populateSchoolIdentity.js's guards
 * cannot see, because the article it landed on is perfectly valid, just not ours. They were
 * found by comparing the stored nickname against the school's own athletics hostname, which
 * both rejects the wrong value and names the right one: "LaGrange" held Hannibal-LaGrange's
 * Trojans while its own domain is lagrangepanthers.com.
 *
 * The fix is an EXPLICIT article per school rather than another guess, and the facts are
 * re-extracted from that article with the same parser the rest of the pipeline uses -- so
 * these rows get a real nickname, mascot, colours and logo, not just a hand-typed nickname.
 *
 * `expect` is an assertion, not a value to write: if the corrected article does not yield
 * the nickname the school's own domain implies, the repair is REPORTED and skipped rather
 * than written. A repair that silently substitutes one wrong answer for another is worse
 * than the error it replaces.
 *
 * Usage: node repair_identity.js [--apply]
 */
import { College } from '../app/server/db/entities/college.js';
import { parseInfobox, readInfoboxFacts } from '../app/server/scripts/populateSchoolIdentity.js';
import { isPluralNickname } from '../app/server/lib/nicknameGrammar.js';

const APPLY = process.argv.includes('--apply');
const API = 'https://en.wikipedia.org/w/api.php';
const UA = 'RecruitmatchSchoolIdentityBot/1.0 (contact: rhys.davies@cardaxia.ai)';

// school -> [correct article, nickname its own athletics domain implies]
const REPAIRS = {
  'Kansas City':          ['University of Missouri–Kansas City', 'Roos'],
  'Lafayette':            ['Lafayette College', 'Leopards'],
  // the bare "University of the Pacific" title carries no infobox; the US school is at
  // the disambiguated title
  'Pacific':              ['University of the Pacific (United States)', 'Tigers'],
  'Northwest University': ['Northwest University (United States)', 'Eagles'],
  'Washington (MO)':      ['Washington University in St. Louis', 'Bears'],
  'Springfield':          ['Springfield College', 'Pride'],
  'Franklin':             ['Franklin College (Indiana)', 'Grizzlies'],
  // The university infobox is no help for these two -- LaGrange College's states no sports
  // nickname at all, and Lander University's is the useless literal "LU". Wikipedia's
  // ATHLETICS article carries it instead, under {{Infobox college athletics}}, which the
  // university-only parser skips. Both agree with the school's own athletics domain.
  // LaGrange has no Wikipedia source for its nickname in EITHER the university or the
  // athletics article, so its own athletics domain (lagrangepanthers.com) is the source,
  // and identity_source says so rather than implying a Wikipedia provenance it never had.
  'LaGrange':             ['lagrangepanthers.com', 'Panthers', 'domain'],
  'Lander':               ['Lander Bearcats', 'Bearcats', 'athletics'],
  // 'Lewis & Clark' is deliberately absent. The domain check flagged its stored "River
  // Otters" against lcpioneers.com -- but that host now 302s to golcathletics.com, so the
  // Pioneers branding is what is stale, not the row. The contradiction resolves in favour
  // of the stored value, and changing it would have been the error.
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wikitext(title) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: 'json', action: 'query', titles: title,
    redirects: '1', prop: 'revisions', rvprop: 'content', rvslots: 'main' })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const q = (await res.json()).query || {};
  const p = Object.values(q.pages || {})[0];
  if (!p || p.missing !== undefined) return { title: null, text: null };
  return { title: p.title, text: p.revisions?.[0]?.slots?.main?.['*'] || null };
}

let ok = 0, skipped = 0;
/** Read {{Infobox college athletics}}, which the university-only parser ignores. Used only
 * where the university article states no usable nickname. */
function parseAthletics(text) {
  const i = text.search(/\{\{\s*infobox\s+college\s+athletics/i);
  if (i === -1) return null;
  const body = text.slice(i, i + 4000);
  // one key per call: passing "teams|nickname" made the "|" an alternation inside the
  // built regex, so the match had no capture group and m[1] came back undefined
  const grab = (k) => {
    const m = body.match(new RegExp('\\|\\s*' + k + '\\s*=\\s*([^\\n|]{1,120})', 'i'));
    if (!m || m[1] == null) return null;
    return m[1].replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
      .replace(/'''?/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
  };
  const nickname = grab('nickname') || grab('teams');
  return { nickname, mascot: grab('mascot'), primary: null, secondary: null };
}

for (const [school, [article, expect, kind]] of Object.entries(REPAIRS)) {
  const rows = College.list().filter((c) => c.name === school);
  if (!rows.length) { console.log(`SKIP  ${school}: no such row`); skipped++; continue; }
  if (kind === 'domain') {
    ok++;
    console.log(`FIX   ${school.padEnd(22)} ${rows.length} row(s): ${JSON.stringify(rows[0].nickname)} ` +
      `-> ${JSON.stringify(expect)}   [athletics domain ${article}]`);
    if (APPLY) {
      for (const row of rows) {
        College.update(row.id, {
          nickname: expect,
          nickname_plural: isPluralNickname(expect) ? 1 : 0,
          identity_source: `athletics-domain:${article}`,
          identity_notes: `nickname taken from the school's own athletics domain; neither `
            + `the university nor the athletics Wikipedia article states one. Previous value `
            + `belonged to a different institution of a similar name.`,
        });
      }
    }
    continue;
  }
  const { title, text } = await wikitext(article);
  if (!text) { console.log(`SKIP  ${school}: article "${article}" not found`); skipped++; continue; }
  let facts;
  if (kind === 'athletics') {
    facts = parseAthletics(text);
  } else {
    const fields = parseInfobox(text);
    facts = fields && readInfoboxFacts(fields);
  }
  if (!facts) { console.log(`SKIP  ${school}: no infobox at "${title}"`); skipped++; continue; }
  let got = facts.nickname || '';
  // articles sometimes name the team with the school in front ("Pacific Tigers")
  for (const w of school.replace(/\s*\([^)]*\)/g, '').split(/\s+/)) {
    if (w.length > 2) got = got.replace(new RegExp('^' + w + '\\s+', 'i'), '').trim();
  }
  // the assertion: the corrected article must agree with the school's own domain
  if (!got.toLowerCase().includes(expect.toLowerCase())) {
    console.log(`SKIP  ${school}: "${title}" gives nickname ${JSON.stringify(got)}, ` +
      `but its domain implies "${expect}" -- not writing a second wrong answer`);
    skipped++;
    continue;
  }
  ok++;
  console.log(`FIX   ${school.padEnd(22)} ${rows.length} row(s): ${JSON.stringify(rows[0].nickname)} ` +
    `-> ${JSON.stringify(got)}   [${title}]`);
  if (!APPLY) continue;
  for (const row of rows) {
    College.update(row.id, {
      nickname: got,
      nickname_plural: isPluralNickname(got) ? 1 : 0,
      mascot: facts.mascot ?? null,
      primary_color: facts.primary ?? null,
      secondary_color: facts.secondary ?? null,
      identity_source: `wikipedia:${title}`,
      identity_notes: `corrected: had been matched to a different institution of a similar `
        + `name; the school's own athletics domain implies "${expect}"`,
    });
  }
  await sleep(400);
}
console.log(`\n${ok} repairable, ${skipped} skipped${APPLY ? ' (applied)' : ' (dry run)'}`);
