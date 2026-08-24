#!/usr/bin/env node
/**
 * Backfills colleges.conference_champion_2025 / conference_champion_name for
 * NCAA Division I men's soccer -- the "congratulations on winning the ACC
 * last year" email personalization. Source: Wikipedia's
 * "2025 NCAA Division I men's soccer tournament" article carries a single
 * "Automatic bids" wikitable listing every conference's 2025 champion
 * (its tournament winner, or for the one conference with no tournament,
 * its regular-season champion) in one place -- one page fetch covers all
 * 22-23 D1 conferences, no per-conference scraping needed.
 *
 * Matches by SCHOOL NAME, not by conference name, deliberately: our own
 * `conference` field can be stale after realignment (Grand Canyon's real
 * 2025 automatic bid was via the WAC even though its row here still says
 * Mountain West), so matching on the team name and trusting Wikipedia's
 * own conference label for that team is what keeps the champion sentence
 * accurate regardless of whatever this table's `conference` column says.
 *
 * Usage:
 *   node server/scripts/populateConferenceChampions2025.js [--apply]
 *
 * Without --apply, runs as a dry run and prints what would change.
 */
import { College } from '../db/entities/college.js';

const API = 'https://en.wikipedia.org/w/api.php';
const UA = 'RecruitmatchSchoolIdentityBot/1.0 (contact: rhys.davies@cardaxia.ai)';
const PAGE = "2025 NCAA Division I men's soccer tournament";
const SOURCE = `wikipedia:${PAGE}`;

const APPLY = process.argv.includes('--apply');

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

/** The "Team" cell uses one of two colored-link templates depending on
 * how that school's Wikipedia infobox is set up; both end with the
 * short display name as their last argument. */
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
    const rows = College.filter({ division: 'NCAA D1', sport: 'mens-soccer', name: team });
    if (rows.length === 0) {
      unmatched++;
      console.log(`NO MATCH  ${conference} champion "${team}" -- no NCAA D1 college row with this exact name`);
      continue;
    }
    matched++;
    console.log(`OK        ${conference.padEnd(20)} -> ${team}`);
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
