/**
 * L7ZJ — the historical trust records, in the form an operator would review.
 *
 *   node server/scripts/seasonTrustQueue.js
 *   node server/scripts/seasonTrustQueue.js --json
 *
 * READ-ONLY. It writes nothing and cannot: there is no disposition path here,
 * deliberately. Recording what was measured and deciding what to do about it
 * are different acts, and the second one needs a person.
 *
 * ---------------------------------------------------------------------------
 * ORDERED BY FACTS, NEVER BY A SCORE. Every field below is something measured
 * or recorded — whether the season sits inside the window Evidence reads, which
 * association it belongs to, how many rows it holds, what route it came from.
 * None of them is a judgement about which finding is worse, because a number
 * that ranked them would be this file inventing an opinion the audits never
 * formed, and an operator would reasonably read it as one.
 *
 * The order is: Evidence-exposed first, then NCAA before other associations,
 * then programme identity. It is total and deterministic, so two runs produce
 * the same queue and a reviewer can work down it across sittings.
 */
import db from '../db/client.js';
import { SEASONS } from '../../shared/philosophy.js';
import { DIAGNOSIS, isExcluded } from '../../shared/roster/seasonTrust.js';

const line = (s = '') => console.log(s);

/**
 * One row per trust record, joined to the facts a reviewer needs beside it.
 *
 * `rows` and `division` come from the roster and registry rather than from the
 * trust record: duplicating them into the record would be two places for the
 * same fact to disagree, and the record is about a season's identity rather
 * than its size.
 */
export function trustQueue() {
  const recs = db.prepare(`
    SELECT t.season, t.college_name, t.sport, t.diagnosis, t.diagnosis_evidence, t.diagnosed_at,
           t.disposition, t.disposition_evidence, t.reviewed_at, t.reviewed_by_operator_id,
           t.next_action, t.previous_disposition, t.previous_reviewed_at
    FROM roster_season_trust t`).all();

  const countRows = db.prepare(
    'SELECT COUNT(*) n FROM roster_players WHERE college_name = ? AND sport = ? AND season = ?');
  const division = db.prepare('SELECT division FROM colleges WHERE name = ? AND sport = ?');
  const window = new Set(SEASONS.map(String));

  return recs.map((r) => {
    const div = division.get(r.college_name, r.sport)?.division ?? null;
    return {
      ...r,
      rows: countRows.get(r.college_name, r.sport, r.season).n,
      division: div,
      association: div ? String(div).split(' ')[0] : null,
      // Whether the season sits in the window roster-derived Evidence reads.
      evidenceExposed: window.has(String(r.season)),
      // What the record currently does to Evidence. Always false here, and
      // stated rather than assumed so a reader never has to infer it.
      excludedFromEvidence: isExcluded(r),
      reviewState: r.disposition ? 'DISPOSITIONED' : 'PENDING_REVIEW',
    };
  }).sort((a, b) =>
    Number(b.evidenceExposed) - Number(a.evidenceExposed)
    || Number(b.association === 'NCAA') - Number(a.association === 'NCAA')
    || a.college_name.localeCompare(b.college_name)
    || a.sport.localeCompare(b.sport)
    || String(a.season).localeCompare(String(b.season)));
}

function main(argv = process.argv) {
  const q = trustQueue();
  if (argv.includes('--json')) { process.stdout.write(`${JSON.stringify(q, null, 2)}\n`); return; }

  const pending = q.filter((r) => r.reviewState === 'PENDING_REVIEW');
  const done = q.filter((r) => r.reviewState === 'DISPOSITIONED');

  line();
  line('HISTORICAL SEASON TRUST');
  line();
  line(`  records ${q.length}   pending review ${pending.length}   dispositioned ${done.length}`);
  line(`  removed from Evidence  ${q.filter((r) => r.excludedFromEvidence).length}`);
  line();

  if (done.length) {
    line('  DISPOSITIONED — a person has decided, and the decision stands');
    line();
    for (const r of done) {
      line(`  ${r.college_name} / ${r.sport} / ${r.season}   ${r.division}   ${r.rows} rows`);
      line(`     diagnosis    ${r.diagnosis}`);
      line(`     disposition  ${r.disposition}   reviewed ${r.reviewed_at}`
        + `   by ${r.reviewed_by_operator_id ?? '(no operator signed in)'}`);
      line(`     why          ${r.disposition_evidence}`);
      if (r.next_action) line(`     next         ${r.next_action}`);
      line();
    }
  }

  line('  PENDING REVIEW — measured, not decided');
  line('  Ordered by Evidence exposure, then NCAA first, then programme identity.');
  line('  Nothing here ranks one finding above another; the order is the order to read in.');
  line();
  line('   #  exposed  assoc  programme                                      sport          season  rows');
  pending.forEach((r, i) => {
    line(`  ${String(i + 1).padStart(2)}  ${r.evidenceExposed ? '  yes  ' : '  no   '}  `
      + `${(r.association ?? '?').padEnd(6)} ${r.college_name.slice(0, 44).padEnd(46)} `
      + `${r.sport.padEnd(14)} ${r.season}    ${String(r.rows).padStart(3)}`);
  });
  line();
  line('  Each pending record carries its own diagnosis evidence; --json prints it in full.');
  line();
  /*
   * The distinction the whole model rests on, restated where a reviewer will
   * read it: a diagnosis is a measurement and changes nothing. Only an explicit
   * EXCLUDE_FROM_EVIDENCE removes a season, and nothing here has one.
   */
  const unproven = q.filter((r) => r.diagnosis === DIAGNOSIS.SEASON_IDENTITY_UNPROVEN).length;
  line(`  ${unproven} of these are SEASON_IDENTITY_UNPROVEN: nothing surviving establishes which`);
  line('  season the rows represent. That is not a finding that they are wrong, and none of');
  line('  them has been removed from Evidence.');
  line();
}

if (import.meta.url === `file://${process.argv[1]}`) main();
