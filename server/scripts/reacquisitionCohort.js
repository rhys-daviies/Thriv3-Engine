#!/usr/bin/env node
/**
 * The programmes that need re-acquiring, not discovering.
 *
 *   npm run roster-reacquire                 the cohort, its audit, and the pilot
 *   npm run roster-reacquire -- --json       the same, for a caller
 *   npm run roster-reacquire -- --keys <p>   write the pilot's run scope for RB_KEYS
 *
 * Read-only unless `--keys` is given, and that writes one file of `School||Sport`
 * lines outside the repository. No network, no database write, no sheet.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE COHORT FROM THE GAP QUEUE.
 *
 * `rosterGapQueue` answers "what is missing for this season", and the answer is
 * 141 programmes of two completely different kinds. Three have never been
 * fetched: they need a host, a candidate and in two cases an identity decision.
 * The other 138 need none of that — they hold a 2025 roster acquired from a
 * source the pipeline still knows. Treating them as one queue is how "NCAA
 * coverage" came to be quoted as 99.4% when the current-season figure was 91.6%.
 *
 * So the predicate here is deliberately narrow, and every clause is derived:
 *
 *   1. active for the season        `rosterTargetUniverse({ season })`, which
 *                                   applies programme_status and colleges.active
 *   2. a legitimate identity        not one of the seven registry duplicates
 *   3. no roster FOR the season     roster_players.season, and nothing else
 *   4. a roster for season - 1      the same column. "Historically rostered" is
 *                                   not enough: a programme last seen in 2023 is
 *                                   a different engineering question and there
 *                                   are currently none, which this asserts
 *                                   rather than assumes
 *   5. an existing acquisition basis  a non-null `source_roster_url` on one of
 *                                   those rows AND the planner agreeing the
 *                                   programme is EXISTING_CANDIDATE
 *
 * Clause 4 is what excludes the three never-fetched programmes, and with them
 * New Jersey City W and Bryn Athyn M/W — whose unresolved identity and status
 * questions make them the worst possible pilot subjects. They are excluded
 * structurally, by a clause that is about rosters and not about their names.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import db from '../db/client.js';
import { gapQueue } from './rosterGapQueue.js';
import { canonicalHost } from '../../shared/evidence/domainAuthority.js';
import {
  pilotSample, sourceShape, underlyingUrl, archived, PILOT_SIZE,
} from '../../shared/roster/reacquisitionPilot.js';

export const COHORT_SEASON = 2026;

/** The accepted source for a programme's season, and how many rows carry it. */
const SOURCES = `SELECT source_roster_url u, COUNT(*) n FROM roster_players
                  WHERE college_name = ? AND sport = ? AND season = ?
                  GROUP BY u ORDER BY n DESC, u`;

export function reacquisitionCohort({ season = COHORT_SEASON } = {}) {
  const prior = String(season - 1);
  const sources = db.prepare(SOURCES);
  const players = db.prepare(
    'SELECT COUNT(*) n FROM roster_players WHERE college_name = ? AND sport = ? AND season = ?',
  );
  const ledger = new Map(db.prepare('SELECT domain, platform FROM athletics_domains WHERE platform IS NOT NULL')
    .all().map((r) => [canonicalHost(r.domain), r.platform]));
  const conf = db.prepare('SELECT conference FROM colleges WHERE name = ? AND sport = ? LIMIT 1');

  const q = gapQueue({ season });
  const excluded = [];
  const rows = [];
  for (const g of q.rows) {
    // 4. a roster for the PRIOR season specifically, not merely some season.
    if (String(g.latestRosterSeason ?? '') !== prior) {
      excluded.push({ key: g.key, school: g.school, sport: g.sport, division: g.division,
        reason: g.latestRosterSeason == null ? 'NEVER_FETCHED' : `LATEST_ROSTER_${g.latestRosterSeason}`,
        candidateState: g.candidateState });
      continue;
    }
    // 5. an existing acquisition basis.
    const src = sources.all(g.school, g.sport, prior).filter((s) => s.u);
    if (!src.length || g.candidateState !== 'EXISTING_CANDIDATE') {
      excluded.push({ key: g.key, school: g.school, sport: g.sport, division: g.division,
        reason: src.length ? `CANDIDATE_STATE_${g.candidateState}` : 'NO_SOURCE_URL',
        candidateState: g.candidateState });
      continue;
    }
    const url = src[0].u;
    const host = (() => { try { return new URL(underlyingUrl(url)).hostname.toLowerCase(); } catch { return null; } })();
    rows.push({
      key: g.key,
      school: g.school,
      sport: g.sport,
      gender: g.gender,
      division: g.division,
      unitid: g.unitid,
      conference: conf.get(g.school, g.sport)?.conference ?? null,
      priorSeason: prior,
      priorSource: url,
      priorSourceArchived: archived(url),
      priorSourceHost: host,
      sourceShape: sourceShape(url),
      provider: host ? ledger.get(canonicalHost(host)) ?? null : null,
      trustedHost: g.fetchHosts.length > 0,
      fetchHosts: g.fetchHosts,
      priorPlayers: players.get(g.school, g.sport, prior).n,
      distinctPriorSources: src.length,
      // The machine's RECORDED view of the last attempt. L7J: it froze at that
      // attempt and is not a classification of the programme.
      lastStage: g.lastStage,
      lastError: g.lastError,
      lastAttempts: g.lastAttempts,
      candidates: g.candidates,
    });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));

  const tally = (pick) => rows.reduce((m, r) => {
    const v = String(pick(r) ?? 'none'); m[v] = (m[v] ?? 0) + 1; return m;
  }, {});
  return {
    season,
    rows,
    excluded,
    coverage: q.summary,
    audit: {
      cohort: rows.length,
      byDivision: tally((r) => r.division),
      byGender: tally((r) => r.gender),
      bySport: tally((r) => r.sport),
      byStratum: tally((r) => `${r.division}|${r.gender}`),
      bySourceShape: tally((r) => r.sourceShape),
      byProvider: tally((r) => r.provider),
      byHost: tally((r) => r.priorSourceHost),
      archivedSource: rows.filter((r) => r.priorSourceArchived).length,
      trustedHost: rows.filter((r) => r.trustedHost).length,
      priorPlayers: (() => {
        const n = rows.map((r) => r.priorPlayers).sort((a, b) => a - b);
        return n.length ? { min: n[0], median: n[(n.length / 2) | 0], max: n[n.length - 1],
          total: n.reduce((a, b) => a + b, 0) } : null;
      })(),
    },
  };
}

function main() {
  const season = Number(process.argv[process.argv.indexOf('--season') + 1]) || COHORT_SEASON;
  const c = reacquisitionCohort({ season });
  const pilot = pilotSample(c.rows, { size: PILOT_SIZE });

  const keysAt = process.argv.indexOf('--keys');
  if (keysAt > 0 && process.argv[keysAt + 1]) {
    writeFileSync(process.argv[keysAt + 1], `${pilot.keys.join('\n')}\n`);
    console.log(`wrote ${pilot.keys.length} keys to ${process.argv[keysAt + 1]}  digest ${pilot.digest}`);
    return;
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ ...c, pilot }, null, 2)}\n`);
    return;
  }

  const a = c.audit;
  console.log(`\nNCAA RE-ACQUISITION COHORT — season ${season} (from ${season - 1})\n`);
  console.log(`  missing a ${season} roster        ${c.coverage.currentSeasonMissing}`);
  console.log(`  re-acquisition cohort        ${a.cohort}`);
  console.log(`  excluded from eligibility    ${c.excluded.length}`);
  for (const e of c.excluded) console.log(`    ${e.reason.padEnd(22)} ${e.division} ${e.school} / ${e.sport}`);
  console.log(`\n  division    ${JSON.stringify(a.byDivision)}`);
  console.log(`  gender      ${JSON.stringify(a.byGender)}`);
  console.log(`  stratum     ${JSON.stringify(a.byStratum)}`);
  console.log(`  ${season - 1} players  ${JSON.stringify(a.priorPlayers)}`);
  console.log(`  archived source  ${a.archivedSource}   trusted host  ${a.trustedHost} / ${a.cohort}`);
  console.log('\n  SOURCE SHAPE');
  for (const [k, v] of Object.entries(a.bySourceShape).sort((x, y) => y[1] - x[1])) {
    console.log(`    ${String(v).padStart(4)}  ${k}`);
  }
  console.log('\n  PROVIDER (athletics_domains.platform)');
  for (const [k, v] of Object.entries(a.byProvider).sort((x, y) => y[1] - x[1])) {
    console.log(`    ${String(v).padStart(4)}  ${k}`);
  }
  console.log(`\n  DISTINCT SOURCE HOSTS  ${Object.keys(a.byHost).length}`);

  console.log(`\nPILOT — ${pilot.algorithm}`);
  console.log(`  seats        ${JSON.stringify(pilot.seats)}`);
  console.log(`  cohort       ${pilot.cohortFingerprint.slice(0, 16)}`);
  console.log(`  digest       ${pilot.digest}`);
  console.log('\n   #  division    g  school                              shape / provider');
  pilot.rows.forEach((r, i) => {
    console.log(`  ${String(i + 1).padStart(2)}  ${r.division.padEnd(10)} ${r.gender}  `
      + `${r.school.slice(0, 34).padEnd(34)} ${r.sourceShape} / ${r.provider ?? 'UNKNOWN'}`);
  });
  const pt = (pick) => pilot.rows.reduce((m, r) => { const v = String(pick(r) ?? 'none'); m[v] = (m[v] ?? 0) + 1; return m; }, {});
  console.log(`\n  pilot division   ${JSON.stringify(pt((r) => r.division))}`);
  console.log(`  pilot gender     ${JSON.stringify(pt((r) => r.gender))}`);
  console.log(`  pilot shapes     ${JSON.stringify(pt((r) => r.sourceShape))}`);
  console.log(`  pilot providers  ${JSON.stringify(pt((r) => r.provider))}`);
  console.log(`  pilot hosts      ${Object.keys(pt((r) => r.priorSourceHost)).length} distinct`);
  console.log();
}

if (import.meta.url === `file://${process.argv[1]}`) main();
