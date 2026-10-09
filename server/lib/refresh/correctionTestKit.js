/**
 * Shared inputs for the correction-engine regression tests (DI-03D). Not used by production code.
 * The reviewer is the allow-listed DISPOSABLE_ONLY rehearsal identity (shared/correctionReviewers.json):
 * tests run on in-memory or temporary databases, which are disposable targets.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const TEST_REVIEWER = Object.freeze({ reviewer_id: 'data-integrity-rehearsal', approved_by: 'Data Integrity rehearsal (Claude)' });
/** Reviewer + dates for an approval valid at `now` (ISO), expiring 7 days later. */
export function approvalFields(now) {
  const d = new Date(now); const day = d.toISOString().slice(0, 10);
  return { ...TEST_REVIEWER, approved_at: day, expires_at: new Date(d.getTime() + 7 * 86_400_000).toISOString().slice(0, 10) };
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'correction-kit-'));
let n = 0;
/**
 * A well-formed activation-holds file holding `ids`. -> { file, sha256 }
 * An empty holds list is unreadable by design (fail closed), so "no holds" holds a sentinel.
 */
export function holdsFile(ids, hold = 'PENDING_SEND_TIME_VERIFICATION') {
  const file = path.join(dir, `holds-${++n}.json`);
  const list = ids.length ? ids.map((coach_id) => ({ coach_id, hold })) : [{ coach_id: '__nobody__', hold }];
  const body = JSON.stringify({ kind: 'COACH_ACTIVATION_HOLDS', version: 't', counts: { [hold]: list.length }, holds: list });
  fs.writeFileSync(file, body);
  return { file, sha256: crypto.createHash('sha256').update(body).digest('hex') };
}
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
