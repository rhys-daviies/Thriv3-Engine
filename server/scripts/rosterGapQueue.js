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
function ncaaGaps() {
  const have = db.prepare('SELECT COUNT(*) n FROM roster_players WHERE college_name = ? AND sport = ?');
  const twin = db.prepare('SELECT name FROM colleges WHERE unitid = ? AND sport = ? AND name != ?');
  const ncaa = rosterTargetUniverse().filter((p) => String(p.division).startsWith('NCAA'));
  const withRoster = ncaa.filter((r) => have.get(r.school, r.sport).n);
  const without = ncaa.filter((r) => !have.get(r.school, r.sport).n);
  /*
   * THREE NUMBERS, NOT TWO, AND THEY HAVE TO ADD UP.
   *
   * A registry duplicate holds no roster under its own spelling while its twin
   * holds one under the other — L6 found seven, and counting them as coverage
   * gaps is how 1,744 and 1,751 both get called "programmes with a roster" in
   * the same week. They are a registry-integrity job and not an acquisition
   * one, so they are separated here and reported rather than dropped.
   */
  const duplicates = without.filter((r) => r.unitid != null
    && twin.all(r.unitid, r.sport, r.school).some((t) => have.get(t.name, r.sport).n));
  const dupKeys = new Set(duplicates.map((r) => gapKey(r.school, r.sport)));
  const gaps = without.filter((r) => !dupKeys.has(gapKey(r.school, r.sport)));
  return { ncaa, withRoster, duplicates, gaps };
}

/** Durable acquisition state, if the pipeline has written any for this season. */
function pipelineState(season) {
  const root = process.env.RB_ROOT || `${process.env.HOME}/Documents/Thriv3`;
  const path = `${root}/${season} Roster Sheets/_state/state${season}.json`;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

export function gapQueue({ season = QUEUE_SEASON, now = new Date() } = {}) {
  const { ncaa, withRoster, duplicates, gaps } = ncaaGaps();
  const plan = new Map(candidatePlan().map((p) => [p.key, p]));
  const reviews = reviewsForSeason(season);
  const state = pipelineState(season);

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
      hasRoster: false,
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
      ncaaWithRoster: withRoster.length,
      registryDuplicates: duplicates.length,
      legitimateGaps: gaps.length,
      // ncaaTotal = ncaaWithRoster + registryDuplicates + legitimateGaps
      reconciles: withRoster.length + duplicates.length + gaps.length === ncaa.length,
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
  for (const r of q.rows) {
    const rec = r.recordedStale ? `${r.lastStage ?? '?'} (stale)` : (r.lastStage ?? 'no attempt');
    console.log(`  ${r.division.padEnd(9)} ${r.gender}  ${r.school.slice(0, 36).padEnd(36)} `
      + `${String(r.candidates).padStart(5)}      ${rec.padEnd(19)} `
      + `${r.disposition ?? r.reviewStatus}${r.retryEligible ? '' : ' [held]'}`);
  }
  console.log(`\n  NCAA programmes            ${s.ncaaTotal}`);
  console.log(`  with roster data           ${s.ncaaWithRoster}`);
  console.log(`  registry duplicates        ${s.registryDuplicates}  (a registry job, not an acquisition one)`);
  console.log(`  legitimate active gaps     ${s.legitimateGaps}`);
  console.log(`  reconciles                 ${s.reconciles ? 'yes' : 'NO'}  `
    + `(${s.ncaaWithRoster} + ${s.registryDuplicates} + ${s.legitimateGaps} = ${s.ncaaTotal})`);
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
