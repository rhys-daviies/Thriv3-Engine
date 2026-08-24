#!/usr/bin/env node
/**
 * Women's-soccer counterpart to populateConferenceChampions2025.js -- same
 * "Automatic bids" wikitable pattern, but women's conference champions are
 * NOT the same schools as men's (different programs, different results),
 * so this needs its own page fetch rather than reusing the men's data.
 * Source: Wikipedia's "2025 NCAA Division I women's soccer tournament".
 *
 * Usage:
 *   node server/scripts/populateConferenceChampions2025Women.js [--apply]
 *
 * Without --apply, runs as a dry run and prints what would change.
 */
import { College } from '../db/entities/college.js';

const API = 'https://en.wikipedia.org/w/api.php';
const UA = 'RecruitmatchSchoolIdentityBot/1.0 (contact: rhys.davies@cardaxia.ai)';
const PAGE = "2025 NCAA Division I women's soccer tournament";
const SOURCE = `wikipedia:${PAGE}`;
const SPORT = 'womens-soccer';

const APPLY = process.argv.includes('--apply');

// Wikipedia's short display name occasionally differs from our own name for
// the same institution (service academies especially).
const NAME_ALIASES = { 'Army West Point': 'Army' };

async function apiGet(params) {
  const url = new URL(API);
  url.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

function extractLink(cell) {
  const m = cell.match(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/);
  return m ? m[1].trim() : null;
}

function extractShortName(cell) {
  let m = cell.match(/\{\{white\|([^}]+)\}\}/i);
  if (m) return m[1].trim();
  m = cell.match(/\{\{CollegeSecondaryColorLink\|([^}]+)\}\}/i);
  if (m) return m[1].split('|').pop().trim();
  return extractLink(cell) || cell.replace(/style=\{\{[^}]*\}\}\|/, '').trim();
}

/** Parses the "Automatic bids" wikitable into {conference, team} pairs. */
function parseAutomaticBids(wikitext) {
  const start = wikitext.indexOf('Automatic bids');
  if (start === -1) throw new Error('"Automatic bids" table not found on the page -- did the article change?');
  const end = wikitext.indexOf('|}', start);
  const table = wikitext.slice(start, end);

  const rowChunks = table.split('\n|-\n').slice(2); // [0] = heading, [1] = header cells
  const rows = [];
  for (const chunk of rowChunks) {
    const cells = chunk.split(/\n\|(?!\|)/).map((c) => c.replace(/^\|/, '').trim());
    if (cells.length < 2) continue;
    const conference = extractLink(cells[0]) || cells[0];
    const team = extractShortName(cells[1]);
    if (conference && team) rows.push({ conference, team });
  }
  return rows;
}

async function main() {
  const data = await apiGet({ action: 'query', titles: PAGE, prop: 'revisions', rvprop: 'content', rvslots: 'main' });
  const page = Object.values(data.query.pages)[0];
  if (page.missing) throw new Error(`"${PAGE}" does not exist on Wikipedia`);
  const wikitext = page.revisions[0].slots.main['*'];

  const bids = parseAutomaticBids(wikitext);
  console.log(`Parsed ${bids.length} conference champions from "${PAGE}"${APPLY ? '' : ' (dry run)'}.`);

  let matched = 0;
  let unmatched = 0;
  for (const { conference, team } of bids) {
    const rows = College.filter({ division: 'NCAA D1', sport: SPORT, name: NAME_ALIASES[team] || team });
    if (rows.length === 0) {
      unmatched++;
      console.log(`NO MATCH  ${conference} champion "${team}" -- no NCAA D1 womens-soccer college row with this exact name`);
      continue;
    }
    matched++;
    console.log(`OK        ${conference.padEnd(24)} -> ${team}`);
    if (!APPLY) continue;
    for (const row of rows) {
      College.update(row.id, {
        conference_champion_2025: 1,
        conference_champion_name: conference,
        conference_champion_source: SOURCE,
        conference_champion_notes: null,
      });
    }
  }

  console.log(`\nDone. ${matched} matched, ${unmatched} unmatched, out of ${bids.length} conferences.`);
  if (!APPLY) console.log('Dry run only -- re-run with --apply to write these to the database.');
}

main();
