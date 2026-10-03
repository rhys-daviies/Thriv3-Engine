#!/usr/bin/env node
/**
 * IS THE EVIDENCE THE A8 BASELINE RESTS ON STILL THE EVIDENCE IT WAS?
 *
 * The CLI. A9.1 moved the computation to `server/lib/v2/corpusIdentity.js` so
 * that the production matchmaking service and this guard cannot drift apart
 * about what "the corpus" means; this file re-exports it unchanged, and every
 * digest it has printed since A8.0 still reproduces.
 *
 *   node server/scripts/a8CorpusGuard.js
 *   node server/scripts/a8CorpusGuard.js --expect=<supported digest>
 */
import { UNIVERSE } from '../lib/v2/validationUniverse.js';
import { corpusDigests, GUARD_SEASON } from '../lib/v2/corpusIdentity.js';

export { corpusDigests, GUARD_SEASON };

async function main() {
  const { default: db } = await import('../db/client.js');
  const expect = process.argv.slice(2).find((a) => a.startsWith('--expect='))?.split('=')[1] ?? null;
  const d = corpusDigests(db);
  for (const [universe, v] of Object.entries(d)) {
    console.log(`${universe.padEnd(12)} colleges ${String(v.colleges).padStart(5)}  `
      + `roster ${String(v.rosterRows).padStart(6)}  arrivals ${String(v.arrivals).padStart(6)}`);
    console.log(`${''.padEnd(12)} ${v.digest}`);
  }
  if (expect) {
    const ok = d[UNIVERSE.SUPPORTED].digest === expect;
    console.log(ok
      ? '\nSUPPORTED universe unchanged: the A8 baseline still describes this corpus.'
      : `\nSUPPORTED universe MOVED.\n  expected ${expect}\n  actual   ${d[UNIVERSE.SUPPORTED].digest}\n`
        + '  The A8 baseline no longer describes this corpus and must be rebuilt.');
    process.exit(ok ? 0 : 1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('a8CorpusGuard.js')) await main();
