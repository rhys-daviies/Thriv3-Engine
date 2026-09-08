#!/usr/bin/env node
/**
 * WHO must be considered for roster acquisition, according to the registry.
 *
 *   npm run roster-targets                     the NCAA universe, as a table
 *   npm run roster-targets -- --csv            the same, for the acquisition pipeline
 *   npm run roster-targets -- --csv --out PATH write it somewhere
 *
 * ---------------------------------------------------------------------------
 * PREVIOUS ROSTER SUCCESS IS NO LONGER THE AUTHORITY FOR TARGET MEMBERSHIP.
 *
 * The acquisition pipeline built its worklist by scanning the roster files of
 * adjacent seasons, so a programme's membership depended on already having a
 * roster. L6 measured what that costs: a programme absent once is never asked
 * for again, never earns a known-good URL, and is therefore missing forever.
 * The 2025 D3 women's sheet held 394 schools against 418 in the registry, and
 * the 24-school shortfall was carried into 2026 unchanged — not because those
 * sources were hard, but because nobody looked.
 *
 * The split this file establishes:
 *
 *   the REGISTRY decides WHO must be considered     <- here
 *   prior source history suggests WHERE to look     <- the pipeline
 *
 * Prior success remains an optimisation and stops being a membership rule. A
 * programme with no history is a target with no candidate URL, which is a
 * discovery job rather than an exclusion.
 *
 * READ-ONLY. It selects; it writes no database row.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import db from '../db/client.js';

/**
 * Divisions in scope, and why it is a list rather than "everything".
 *
 * Stage L's target is NCAA D1/D2/D3 done well. NAIA, NJCAA and USCAA are
 * deferred expansion targets and are deliberately absent — including them here
 * would quietly re-scope an acquisition run. Adding one is a one-line product
 * decision, which is the right size for that decision.
 */
export const TARGET_DIVISIONS = Object.freeze(['NCAA D1', 'NCAA D2', 'NCAA D3']);

/** Sports the roster pipeline knows how to acquire. */
export const TARGET_SPORTS = Object.freeze(['mens-soccer', 'womens-soccer']);

/**
 * Every programme the registry says exists and is active, in scope.
 *
 * Ordered so two runs over the same registry produce the same file: a worklist
 * that reshuffles cannot be diffed, and the whole point of this one is that a
 * human can see what changed between seasons.
 *
 * `active = 0` is excluded because a discontinued programme has no current
 * roster to find, and asking for one turns a correct absence into a recorded
 * failure. Nothing else is excluded. In particular DUPLICATE REGISTRY ROWS ARE
 * NOT FILTERED HERE: L6 found seven whose twin already holds the roster, two of
 * which carry it under the wrong name, and suppressing them by name would be
 * exactly the ad-hoc identity guess that L4 got wrong and L5 had to undo. They
 * are a registry-integrity job, and until that job runs they are targets that
 * will resolve to a source their twin already has.
 */
export function rosterTargetUniverse({
  divisions = TARGET_DIVISIONS, sports = TARGET_SPORTS, includeInactive = false,
} = {}) {
  const divs = divisions.map(() => '?').join(', ');
  const sps = sports.map(() => '?').join(', ');
  return db.prepare(`
    SELECT name AS school, sport, division, COALESCE(conference, '') AS conference,
           unitid, active
    FROM colleges
    WHERE division IN (${divs}) AND sport IN (${sps})
      ${includeInactive ? '' : 'AND active = 1'}
    ORDER BY division, sport, name
  `).all(...divisions, ...sports);
}

/** The universe as the pipeline's worklist columns. Membership only — no URLs. */
export function toCsv(rows) {
  const head = ['School', 'Sport', 'Division', 'Conference', 'Unitid'];
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head.join(','), ...rows.map((r) => [r.school, r.sport, r.division, r.conference, r.unitid ?? '']
    .map(cell).join(','))].join('\r\n') + '\r\n';
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
  const rows = rosterTargetUniverse();

  /*
   * The RUN SCOPE for one acquisition, as 'School||Sport' lines — the key
   * `state.key()` builds. Emitting it from the registry rather than pasting a
   * list into the pipeline keeps the cohort derived rather than declared: it is
   * "active NCAA programmes with no roster", recomputed each time, not 34 names
   * somebody typed. It is a run argument and never membership.
   */
  if (argv.includes('--gap-keys')) {
    const have = db.prepare('SELECT COUNT(*) n FROM roster_players WHERE college_name = ? AND sport = ?');
    const twin = db.prepare('SELECT name FROM colleges WHERE unitid = ? AND sport = ? AND name != ?');
    const gaps = rows.filter((r) => !have.get(r.school, r.sport).n)
      // A duplicate registry row whose twin already holds the roster is a
      // registry-integrity job, not an acquisition one. L6 identified seven.
      .filter((r) => !(r.unitid != null
        && twin.all(r.unitid, r.sport, r.school).some((t) => have.get(t.name, r.sport).n)));
    const body = `${gaps.map((r) => `${r.school}||${r.sport}`).join('\n')}\n`;
    const out = arg('out');
    if (out) { writeFileSync(out, body, 'utf8'); console.log(`wrote ${out} — ${gaps.length} keys`); }
    else process.stdout.write(body);
    return;
  }

  if (argv.includes('--csv')) {
    const csv = toCsv(rows);
    const out = arg('out');
    if (out) { writeFileSync(out, csv, 'utf8'); console.log(`wrote ${out} — ${rows.length} programmes`); }
    else process.stdout.write(csv);
    return;
  }

  const have = db.prepare('SELECT COUNT(*) n FROM roster_players WHERE college_name = ? AND sport = ?');
  console.log(`\nROSTER TARGET UNIVERSE — ${rows.length} active programmes\n`);
  console.log('  division    sport     programmes   with roster   to discover');
  const by = new Map();
  for (const r of rows) {
    const k = `${r.division}|${r.sport}`;
    if (!by.has(k)) by.set(k, { n: 0, withRoster: 0 });
    const e = by.get(k);
    e.n += 1;
    if (have.get(r.school, r.sport).n) e.withRoster += 1;
  }
  for (const [k, e] of by) {
    const [d, s] = k.split('|');
    console.log(`  ${d.padEnd(11)}${s.replace('-soccer', '').padEnd(10)}${String(e.n).padStart(10)}`
      + `${String(e.withRoster).padStart(14)}${String(e.n - e.withRoster).padStart(14)}`);
  }
  const gaps = rows.filter((r) => !have.get(r.school, r.sport).n);
  console.log(`\n  ${gaps.length} programmes have no roster and would be discovered from scratch.`);
  console.log('  Membership comes from the registry, so this number can only fall.\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
