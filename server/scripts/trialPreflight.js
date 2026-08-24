/**
 * Checks whether the first real tracked send (ROADMAP §1.1) is worth
 * attempting.
 *
 *   npm run trial:preflight
 *   npm run trial:preflight -- <slug|athlete id>
 *
 * Sends nothing and writes nothing. Exits non-zero if anything would make the
 * trial produce a misleading result — a dead link and an uninterested coach
 * look identical from the engagement score, so the difference has to be ruled
 * out beforehand rather than debugged afterwards.
 */
import 'dotenv/config';
import { runPreflight } from '../lib/trialPreflight.js';

const MARK = { pass: '✓', warn: '!', fail: '✗' };

const result = await runPreflight({ slugOrId: process.argv[2] || null });

const width = Math.max(...result.checks.map((c) => c.name.length));
for (const c of result.checks) {
  console.log(`${MARK[c.status]} ${c.name.padEnd(width)}  ${c.detail}`);
}

console.log('');
if (result.ready) {
  console.log(
    result.warnings
      ? `Ready, with ${result.warnings} warning(s) — nothing blocking the trial send.`
      : 'Ready. Nothing blocking the trial send.'
  );
  console.log('Nothing has been sent; this check is read-only.');
} else {
  console.error(`Not ready — ${result.failures} blocking issue(s) above. Nothing was sent.`);
  process.exit(1);
}
