#!/usr/bin/env node
/**
 * The NCAA roster residual queue: what is missing, what the machine knows, and
 * what a person has decided.
 *
 *   npm run roster-gaps                 the queue and the foundation summary
 *   npm run roster-gaps -- --json       the same, for a caller
 *
 * Read-only. It writes nothing, attempts nothing and touches no network.
 *
 * ---------------------------------------------------------------------------
 * THE POINT IS THAT THE THREE LAYERS STAY APART ON THE SCREEN TOO.
 *
 * Each row carries the machine's live view, the machine's recorded view, and
 * the operator's conclusion, in three groups that are never merged into one
 * "status" column. Every stage since L6D has had to rebuild this by hand out of
 * prose, and each rebuild quietly promoted one layer into another — a stage
 * document's label became a fact, a stale error became a diagnosis.
 *
 * WHAT THE MACHINE KNOWS NOW vs WHAT IT RECORDED. These differ, and the
 * difference is the interesting column. L7J proved that durable failure reasons
 * froze at the first attempt: all ten gaps still say `no candidate` from L6D,
 * and the planner offers seven of them twenty-four candidates today. So the
 * queue derives the live candidate state and flags a recorded reason it can
 * prove is out of date, rather than presenting either as the truth.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import db from '../db/client.js';
import { rosterTargetUniverse } from './rosterTargetUniverse.js';
import { candidatePlan } from './rosterCandidatePlan.js';
import { reviewsForSeason, gapKey } from '../lib/rosterGapReview.js';
import { retryEligible, reviewStatus, REVIEW_STATUS } from '../../shared/roster/gapReview.js';

export const QUEUE_SEASON = 2026;

/**
 * NCAA only, and derived from the registry the same way acquisition scopes a
 * run — `rosterTargetUniverse --gap-keys`. A programme is a gap when it holds
 * no roster at all and no duplicate twin of it does; that second clause is L6's
 * finding that seven registry duplicates read as coverage gaps and were a
 * registry job instead.
 */
/**
 * TWO COVERAGE QUESTIONS, ASKED SEPARATELY.
 *
 * Until L7P this file asked one, and it was the wrong one. `withRoster` counted
 * `roster_players WHERE college_name = ? AND sport = ?` with **no season
 * filter**, so a programme last fetched in 2024 counted as covered for 2026.
 * That is how "NCAA coverage 1,745" came to read as a 2026 number when the 2026
 * figure was 1,607 and 138 programmes were being carried by an older season.
 *
 *   CURRENT-SEASON COVERAGE  does this programme have a roster for the season
 *                            being asked about? This is the completeness metric.
 *
 *   HISTORICAL COVERAGE      does it have a usable roster in the dataset at all?
 *                            This is the old measurement, kept because knowing
 *                            a programme from 2024 is genuinely useful — it is
 *                            simply not the same claim.
 *
 * A roster's season is read from `roster_players.season` and from nothing else:
 * not a scrape timestamp, not the newest row, not the programme's status, not
 * whether a website exists. The season a roster is FOR is a property of the
 * roster.
 */
function ncaaGaps(season) {
  const current = db.prepare(
    'SELECT COUNT(*) n FROM roster_players WHERE college_name = ? AND sport = ? AND season = ?',
  );
  const any = db.prepare('SELECT COUNT(*) n FROM roster_players WHERE college_name = ? AND sport = ?');
  const twin = db.prepare('SELECT name FROM colleges WHERE unitid = ? AND sport = ? AND name != ?');
  const yr = String(season);
  const hasCurrent = (r) => current.get(r.school, r.sport, yr).n > 0;
  const hasAny = (r) => any.get(r.school, r.sport).n > 0;

  // The universe for THIS season: a programme that is not fielded is not a gap.
  const ncaa = rosterTargetUniverse({ season }).filter((p) => String(p.division).startsWith('NCAA'));
  const withCurrent = ncaa.filter(hasCurrent);
  const withAny = ncaa.filter(hasAny);
  const without = ncaa.filter((r) => !hasCurrent(r));

  /*
   * A registry duplicate holds no roster under its own spelling while its twin
   * holds one under the other — L6 found seven. They are a registry-integrity
   * job and not an acquisition one, so they are separated and reported rather
   * than dropped. Season-aware for the same reason as everything else here.
   */
  const duplicates = without.filter((r) => r.unitid != null
    && twin.all(r.unitid, r.sport, r.school).some((t) => current.get(t.name, r.sport, yr).n));
  const dupKeys = new Set(duplicates.map((r) => gapKey(r.school, r.sport)));
  const gaps = without.filter((r) => !dupKeys.has(gapKey(r.school, r.sport)));

  // The programmes carried by an older season: covered historically, missing now.
  const historicalOnly = gaps.filter(hasAny);
  return { ncaa, withCurrent, withAny, duplicates, gaps, historicalOnly };
}

/** Durable acquisition state, if the pipeline has written any for this season. */
function pipelineState(season) {
  const root = process.env.RB_ROOT || `${process.env.HOME}/Documents/Thriv3`;
  const path = `${root}/${season} Roster Sheets/_state/state${season}.json`;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

export function gapQueue({ season = QUEUE_SEASON, now = new Date() } = {}) {
  const { ncaa, withCurrent, withAny, duplicates, gaps, historicalOnly } = ncaaGaps(season);
  const plan = new Map(candidatePlan().map((p) => [p.key, p]));
  const reviews = reviewsForSeason(season);
  const state = pipelineState(season);

  /*
   * A programme missing this season splits in two, and the difference is the
   * whole shape of the remaining work: 138 are known from an earlier season and
   * need re-acquiring, and the rest have never been fetched at all.
   */
  const latest = db.prepare(
    'SELECT MAX(season) s FROM roster_players WHERE college_name = ? AND sport = ?',
  );
  const rows = gaps.map((g) => {
    const key = gapKey(g.school, g.sport);
    const p = plan.get(key);
    const s = state[key] ?? null;
    const review = reviews.get(key) ?? null;
    const candidates = p?.candidates?.length ?? 0;
    /*
     * A recorded reason the live machine contradicts. Only claims made where
     * the contradiction is deterministic and network-free: state says nothing
     * was there to try, and the planner is offering candidates right now.
     */
    const recordedStale = Boolean(
      s && s.status !== 'done' && candidates > 0
      && /no candidate|no trusted host|not attempted/i.test(String(s.err ?? '')),
    );
    return {
      key,
      school: g.school,
      sport: g.sport,
      gender: g.sport === 'mens-soccer' ? 'M' : 'W',
      division: g.division,
      unitid: g.unitid ?? null,
      hasCurrentSeasonRoster: false,
      latestRosterSeason: latest.get(g.school, g.sport).s ?? null,
      historicalOnly: latest.get(g.school, g.sport).s != null,
      // --- machine, live ---
      candidateState: p?.state ?? 'UNKNOWN',
      candidates,
      fetchHosts: p?.fetchHosts ?? [],
      // --- machine, recorded (may be stale; L7J) ---
      lastStatus: s?.status ?? null,
      lastStage: s?.stage ?? null,
      lastFailureClass: s?.failure_class ?? null,
      lastError: s?.err ?? null,
      lastAttempts: (s?.tried ?? []).length,
      recordedStale,
      // --- operator ---
      reviewStatus: reviewStatus(review),
      disposition: review?.disposition ?? null,
      nextAction: review?.nextAction ?? null,
      retryAfter: review?.retryAfter ?? null,
      reviewedAt: review?.reviewedAt ?? null,
      reviewEvidence: review?.evidence ?? null,
      reviewedByOperatorId: review?.reviewedByOperatorId ?? null,
      // L7K keeps exactly one step of history. The detail view shows it as a
      // single line, so it has to travel with the row or it cannot be shown.
      previousDisposition: review?.previousDisposition ?? null,
      previousReviewedAt: review?.previousReviewedAt ?? null,
      // --- derived ---
      ...(() => { const r = retryEligible(review, now); return { retryEligible: r.eligible, retryReason: r.reason }; })(),
    };
  }).sort((a, b) => a.division.localeCompare(b.division) || a.sport.localeCompare(b.sport)
    || a.school.localeCompare(b.school));

  const tally = (pick) => rows.reduce((m, r) => {
    const v = pick(r) ?? 'none';
    m[v] = (m[v] ?? 0) + 1; return m;
  }, {});

  return {
    season,
    rows,
    summary: {
      ncaaTotal: ncaa.length,
      // CURRENT-SEASON: the completeness metric. Named so it cannot be misread.
      currentSeasonRostered: withCurrent.length,
      currentSeasonMissing: gaps.length,
      registryDuplicates: duplicates.length,
      legitimateGaps: gaps.length,
      // HISTORICAL: the old measurement, under a name that says what it is.
      historicallyRostered: withAny.length,
      historicalOnly: historicalOnly.length,
      // ncaaTotal = currentSeasonRostered + registryDuplicates + currentSeasonMissing
      reconciles: withCurrent.length + duplicates.length + gaps.length === ncaa.length,
      neverRostered: rows.filter((r) => !r.historicalOnly).length,
      reviewed: rows.filter((r) => r.reviewStatus === REVIEW_STATUS.REVIEWED).length,
      unreviewed: rows.filter((r) => r.reviewStatus === REVIEW_STATUS.UNREVIEWED).length,
      byCandidateState: tally((r) => r.candidateState),
      byFailureClass: tally((r) => r.lastFailureClass),
      byDisposition: tally((r) => r.disposition),
      retryEligible: rows.filter((r) => r.retryEligible).length,
      retryHeld: rows.filter((r) => !r.retryEligible).length,
      recordedReasonStale: rows.filter((r) => r.recordedStale).length,
    },
  };
}

function main() {
  const q = gapQueue();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(q, null, 2)}\n`);
    return;
  }
  const s = q.summary;
  console.log(`\nNCAA ROSTER RESIDUAL QUEUE — season ${q.season}\n`);
  console.log('  division  g  school                                 candidates  recorded            review');
  const shown = process.argv.includes('--all') ? q.rows : q.rows.filter((r) => !r.historicalOnly);
  if (shown.length !== q.rows.length) {
    console.log(`  (showing ${shown.length} never-rostered; --all adds ${q.rows.length - shown.length} `
      + 'known from an earlier season)\n');
  }
  for (const r of shown) {
    const rec = r.recordedStale ? `${r.lastStage ?? '?'} (stale)` : (r.lastStage ?? 'no attempt');
    console.log(`  ${r.division.padEnd(9)} ${r.gender}  ${r.school.slice(0, 36).padEnd(36)} `
      + `${String(r.candidates).padStart(5)}      ${rec.padEnd(19)} `
      + `${r.disposition ?? r.reviewStatus}${r.retryEligible ? '' : ' [held]'}`);
  }
  console.log(`\n  NCAA programmes active for ${q.season}   ${s.ncaaTotal}`);
  console.log(`  with a ${q.season} roster              ${s.currentSeasonRostered}   `
    + `(${(100 * s.currentSeasonRostered / s.ncaaTotal).toFixed(1)}% current-season coverage)`);
  console.log(`  missing a ${q.season} roster           ${s.currentSeasonMissing}`);
  console.log(`  registry duplicates             ${s.registryDuplicates}  (a registry job, not an acquisition one)`);
  console.log(`  reconciles                      ${s.reconciles ? 'yes' : 'NO'}  `
    + `(${s.currentSeasonRostered} + ${s.registryDuplicates} + ${s.currentSeasonMissing} = ${s.ncaaTotal})`);
  console.log(`\n  with a roster in ANY season     ${s.historicallyRostered}   `
    + `(${(100 * s.historicallyRostered / s.ncaaTotal).toFixed(1)}% historical coverage — NOT a ${q.season} number)`);
  console.log(`  historical only                 ${s.historicalOnly}  `
    + `(known from an earlier season, missing for ${q.season})`);
  console.log(`  never rostered                  ${s.neverRostered}  (no roster in any season)`);
  console.log(`  reviewed / unreviewed      ${s.reviewed} / ${s.unreviewed}`);
  console.log(`  retry eligible / held      ${s.retryEligible} / ${s.retryHeld}`);
  console.log(`  candidate state            ${JSON.stringify(s.byCandidateState)}`);
  console.log(`  recorded failure class     ${JSON.stringify(s.byFailureClass)}`);
  console.log(`  operator disposition       ${JSON.stringify(s.byDisposition)}`);
  if (s.recordedReasonStale) {
    console.log(`\n  ${s.recordedReasonStale} recorded reason(s) say nothing was there to try, and the planner`);
    console.log('  offers candidates today. L7J: durable reasons froze at the first attempt and');
    console.log('  are rediagnosed on the next real one. Do not read them as a classification.');
  }
  console.log();
}

if (import.meta.url === `file://${process.argv[1]}`) main();
