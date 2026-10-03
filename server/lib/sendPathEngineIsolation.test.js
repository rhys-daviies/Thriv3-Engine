/**
 * =============================================================================
 * THE SEND PATH DOES NOT LOAD THE MATCHMAKING ENGINE — A9.7.
 *
 * A9.7 wires `attachSelectionToSend` into the two real send paths. That is a
 * provenance write, and it must stay one: the send path records WHICH
 * selection caused a message, and must never acquire the ability to work out
 * what a selection would say today.
 *
 * The risk is not hypothetical and it is not about style. `matchmakingService.js`
 * imports the frozen engine at module scope - `pursuitRun`, `poolContext`,
 * `validationUniverse`, `financialRules` - so a single convenience import of
 * `serviceError` from it would pull the whole scoring model into
 * `confirmSends.js` and `draftOutreach.js`: two standalone CLI tools whose job
 * is to record mail an operator already sent by hand.
 *
 * It would also put the engine's module-load cost on every process that
 * confirms a send, which is the opposite of what §P asks for.
 *
 * So this walks the ACTUAL transitive import graph from each send entry point
 * and asserts the engine is not in it.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The send path's entry points — the modules A9.7 touched, and their tools. */
const SEND_ENTRY_POINTS = [
  'server/lib/executionClaim.js',
  'server/routes/sendOutreach.js',
  'server/lib/outreachSend.js',
  'server/lib/confirmSends.js',
  'server/scripts/draftOutreach.js',
];

/**
 * THE SCORING MACHINERY — what must stay out.
 *
 * Deliberately NOT the whole of `shared/matching/v2/`, and the distinction is
 * one this repository already drew rather than one invented here. The send
 * path reaches exactly two modules under that directory:
 *
 *   shared/matching/v2/athletePreferences.js
 *   shared/matching/v2/financialRules.js
 *
 * Both arrive through `server/db/entities/player.js`, which `MAY_IMPORT_V2`
 * admits by name with A7.9.2's reason: the Player entity validates a
 * contribution pair ON WRITE using the same rule the Financial layer reads it
 * with, because "restating the legal combinations in the route would let the
 * database and the model disagree about what an athlete said."
 *
 * Both are LEAF MODULES WITH NO IMPORTS OF THEIR OWN - asserted below, so this
 * exemption cannot quietly become a door into the pipeline. They are
 * vocabulary and validation, not scoring: neither can rank anything.
 *
 * What this list holds is everything that CAN produce a ranking.
 */
const ENGINE = [
  'shared/matching/v2/index.js',
  'shared/matching/v2/pipeline.js',
  'shared/matching/v2/pursuitRules.js',
  'shared/matching/v2/opportunityRules.js',
  'shared/matching/v2/recruitingRules.js',
  'shared/matching/v2/layers/',
  'server/lib/v2/matchmakingService.js',
  'server/lib/v2/poolContext.js',
  'server/lib/v2/pursuitRun.js',
  'server/lib/v2/matchmakingRuns.js',
  'server/lib/v2/matchmakingSelection.js',
];

/** The two leaf modules the send path is allowed to reach, and nothing else. */
const PERMITTED_V2_LEAVES = [
  'shared/matching/v2/athletePreferences.js',
  'shared/matching/v2/financialRules.js',
];

const SPECIFIER = /(?:^|[^\w.])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveRel(fromRel, spec) {
  if (spec.startsWith('@shared/')) return path.join('shared', spec.slice('@shared/'.length));
  if (!spec.startsWith('.')) return null;
  const abs = path.resolve(path.dirname(path.join(ROOT, fromRel)), spec);
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

function importsOf(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return [];
  const src = fs.readFileSync(abs, 'utf8');
  const out = [];
  for (const m of src.matchAll(SPECIFIER)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    const resolved = resolveRel(rel, spec);
    if (resolved) out.push(resolved);
  }
  return out;
}

/** Every module reachable from `start`, with the path that got there. */
function transitiveClosure(start) {
  const seen = new Map([[start, [start]]]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    for (const next of importsOf(current)) {
      if (seen.has(next)) continue;
      seen.set(next, [...seen.get(current), next]);
      queue.push(next);
    }
  }
  return seen;
}

describe('A9.7. the send path is provenance-only', () => {
  for (const entry of SEND_ENTRY_POINTS) {
    it(`${entry} does not reach the matchmaking engine`, () => {
      expect(fs.existsSync(path.join(ROOT, entry))).toBe(true);
      const closure = transitiveClosure(entry);
      const offenders = [...closure.keys()]
        .filter((m) => ENGINE.some((e) => m === e || m.startsWith(e)))
        .map((m) => `${m}\n      via ${closure.get(m).join('\n       -> ')}`);
      expect(offenders).toEqual([]);
    });
  }

  /**
   * THE EXEMPTION IS BOUNDED BY FACT, NOT BY PROMISE.
   *
   * The two permitted modules are admitted because they cannot score anything,
   * and the only durable way to say that is that they import nothing. If
   * either ever grows an import, this fails and the exemption is re-argued.
   */
  it('the permitted V2 leaves import nothing at all', () => {
    for (const leaf of PERMITTED_V2_LEAVES) {
      expect(fs.existsSync(path.join(ROOT, leaf))).toBe(true);
      expect({ [leaf]: importsOf(leaf) }).toEqual({ [leaf]: [] });
    }
  });

  it('the send path reaches no V2 module beyond those two leaves', () => {
    for (const entry of SEND_ENTRY_POINTS) {
      const reached = [...transitiveClosure(entry).keys()]
        .filter((m) => m.startsWith('shared/matching/v2/'))
        .filter((m) => !PERMITTED_V2_LEAVES.includes(m));
      expect({ [entry]: reached }).toEqual({ [entry]: [] });
    }
  });

  /**
   * The guard is only worth having if it would notice. `outreachProvenance.js`
   * is the module A9.7 added to the send path, and the import it deliberately
   * does NOT make is the one this proves would be caught.
   */
  it('the guard would catch the import it exists to prevent', () => {
    const closure = transitiveClosure('server/lib/v2/outreachProvenance.js');
    expect([...closure.keys()]).not.toContain('server/lib/v2/matchmakingService.js');

    // And the engine IS reachable from the service, so the ENGINE list is live.
    const fromService = transitiveClosure('server/lib/v2/matchmakingService.js');
    const reachesEngine = [...fromService.keys()]
      .some((m) => m.startsWith('shared/matching/v2/'));
    expect(reachesEngine).toBe(true);
  });
});
