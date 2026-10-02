/**
 * =============================================================================
 * A7.46 — the V2 caller contract, enforced mechanically.
 *
 * WHAT WENT WRONG. `v2Opportunity.js` and `v2Recruitability.js` each assembled
 * their own pool context instead of using `poolContext.js`, and each copy
 * drifted. Their roster queries predated the appearance columns, so
 * `buildPositionIndex` threw and NEITHER SCRIPT HAD RUN since 38dc671
 * (2026-09-23). `v2Opportunity.js` additionally held `rosterIndex` and never
 * passed it to `evaluateOpportunity`, which before A7.45B would have scored
 * every programme on rotation alone - a report that looks complete and answers
 * a different question.
 *
 * WHY THESE ARE SOURCE-LEVEL ASSERTIONS. The same idiom as
 * `v2Fixtures.test.js`, which parses two files and fails on any difference.
 * These scripts are CLIs that open a database and call `process.exit`, so the
 * contract that matters - what they PASS - is checked by reading them. A
 * drifted caller is invisible to every behavioural test precisely because it
 * is not on any tested path.
 *
 * WHY NO RUNTIME THROW. A7.46 considered making `rosterIndex` mandatory in
 * `evaluateOpportunity`. It is not added, because the function genuinely
 * cannot tell a caller that forgot it from one that means it - and after
 * A7.45B a caller that omits it already fails loudly in the only way that
 * matters: every programme refuses, and `opportunityRun.test.js` pins that.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const scripts = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

/**
 * The ARGUMENT OBJECT of a call, by brace matching rather than by slicing to
 * the end of the file.
 *
 * An earlier draft sliced from the call site onwards and a mutation test
 * caught it: `v2Opportunity.js` passes `rosterIndex` to a LATER
 * `evaluateRecruitability` call, so removing it from the Opportunity call left
 * the assertion matching the wrong one and the test still passed.
 */
function argumentObject(src, fn) {
  const at = src.indexOf(`${fn}({`);
  if (at < 0) return null;
  let i = src.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < src.length; j += 1) {
    if (src[j] === '{') depth += 1;
    else if (src[j] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  return null;
}

/** Scripts that call a V2 layer runner directly rather than through runPursuit. */
const DIRECT_LAYER_CALLERS = scripts.filter((f) => /\bevaluate(Opportunity|Recruitability)\s*\(/.test(read(f)));

describe('1. every direct Opportunity caller passes the positional evidence', () => {
  it('finds the callers it is meant to be guarding', () => {
    const opp = scripts.filter((f) => /\bevaluateOpportunity\s*\(/.test(read(f)));
    expect(opp).toContain('v2Opportunity.js');
  });

  it.each(scripts.filter((f) => /\bevaluateOpportunity\s*\(/.test(read(f))))(
    '%s passes rosterIndex, entryYear and rosterSeason', (file) => {
      /**
       * Not a style preference. Without `rosterIndex` there is no positional
       * competition; without `entryYear` the eligibility rule cannot be read,
       * so competition refuses anyway; and without `rosterSeason` A7.37 cannot
       * grade horizon depth and a PARTIAL cell is reported MEASURED.
       */
      const call = argumentObject(read(file), 'evaluateOpportunity');
      expect(call, `${file}: no evaluateOpportunity call found`).toBeTruthy();
      expect(call, `${file}: rosterIndex`).toMatch(/rosterIndex\s*:/);
      expect(call, `${file}: entryYear`).toMatch(/entryYear\s*:/);
      expect(call, `${file}: rosterSeason`).toMatch(/rosterSeason\s*:/);
    },
  );
});

describe('2. nobody hand-rolls a pool context any more', () => {
  /**
   * `poolContext.js` exists because a context assembled by hand drifts from
   * the engine silently. Its own header records the first time that happened:
   * a stale SELECT reported MIT as unrankable. These two scripts are the
   * second and third times.
   */
  it.each(DIRECT_LAYER_CALLERS)('%s builds its context with buildPoolContext', (file) => {
    const src = read(file);
    expect(src, `${file} should import the canonical builder`).toMatch(/buildPoolContext/);
    expect(src, `${file} should not build its own position index`).not.toMatch(/rosterIndex\s*:\s*buildPositionIndex\(/);
  });
});

describe('3. any surviving hand-rolled roster query still selects the appearance columns', () => {
  /**
   * The failure that stopped both scripts dead. `assertStarterInputsSelected`
   * throws when a roster query omits them, which is the right behaviour and is
   * only reached when somebody runs the script - so it caught this months
   * after the fact. This catches it in CI instead.
   */
  const handRolled = scripts.filter((f) => {
    const s = read(f);
    return /buildPositionIndex\(/.test(s) && /FROM roster_players/.test(s);
  });

  it.each(handRolled)('%s selects the appearance columns, literally or canonically', (file) => {
    /**
     * TWO WAYS TO BE RIGHT, and interpolating `ROSTER_COLUMNS` is the better
     * one - four scripts already do it, which is why they never broke. An
     * earlier draft of this test read only the literal SQL text and flagged
     * all four, which was the test being wrong rather than the scripts.
     */
    const src = read(file);
    const canonical = /ROSTER_COLUMNS\s*\}?\s*(=|from|await import)/.test(src)
      && /\$\{ROSTER_COLUMNS\}/.test(src);
    if (canonical) {
      expect(src, `${file} should take ROSTER_COLUMNS from poolContext`).toMatch(/poolContext\.js/);
      return;
    }
    expect(src, `${file}: games_started`).toMatch(/\bgames_started\b/);
    expect(src, `${file}: projected_games_started`).toMatch(/\bprojected_games_started\b/);
  });
});

describe('4. the contexts that feed runPursuit carry the roster season', () => {
  /**
   * `pursuitRun.js` reads `ctx.rosterSeason ?? null`, and a null disables
   * A7.37's horizon-depth grading without any error. A caller that assembles a
   * context object for runPursuit must therefore supply it.
   */
  const ctxBuilders = scripts.filter((f) => {
    const s = read(f);
    return /rosterIndex\s*:\s*buildPositionIndex\(/.test(s) && /runPursuit\(/.test(s);
  });

  it('has something to check, or nothing hand-rolls a runPursuit context', () => {
    expect(Array.isArray(ctxBuilders)).toBe(true);
  });

  it.each(ctxBuilders.length ? ctxBuilders : ['(none)'])('%s supplies rosterSeason', (file) => {
    if (file === '(none)') return;
    expect(read(file), `${file}: rosterSeason`).toMatch(/rosterSeason\s*:/);
  });
});

describe('5. the runner reports the field the engine actually returns', () => {
  /**
   * `evaluateOpportunity` returns `playingPathway`. The runner printed
   * `rep.playingOpportunity`, a name the layer had been renamed away from, so
   * the playing line read "nothing scoreable" whatever the data said. A
   * printout that silently reads `undefined` is the same class of defect as a
   * context that silently omits evidence.
   */
  it('v2Opportunity.js reads playingPathway, not a name that no longer exists', () => {
    const src = read('v2Opportunity.js');
    expect(src).toMatch(/rep\.playingPathway/);
    expect(src).not.toMatch(/playingOpportunity/);
  });
});
