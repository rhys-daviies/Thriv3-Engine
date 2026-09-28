import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { RUN_ID } from './executionRun.js';

/**
 * D4.6 — THE PROCESS'S OWN NAME FOR ITSELF.
 *
 * Four properties, and every one of them is load-bearing for recovery. If the
 * value were empty, a claim could not be attributed. If it changed during a
 * run, this process would declare its own in-flight messages abandoned. If two
 * processes shared it, each would believe it owned the other's claims — and the
 * sweep, which exists to resolve dead claims, would resolve live ones instead.
 */

describe('the run id', () => {
  it('exists and is a usable string', () => {
    expect(typeof RUN_ID).toBe('string');
    expect(RUN_ID.trim()).not.toBe('');
  });

  /**
   * SHAPED LIKE SOMETHING `claim_run_id` CAN HOLD. `claimSendForExecution`
   * refuses whitespace and anything over 64 characters, so a run id that
   * violated either would fail at the claim rather than here.
   */
  it('is shaped the way an execution claim requires', () => {
    expect(RUN_ID.length).toBeLessThanOrEqual(64);
    expect(RUN_ID).not.toMatch(/\s/);
  });

  it('does not change while the process is running', () => {
    const readings = [RUN_ID, RUN_ID, RUN_ID];
    expect(new Set(readings).size).toBe(1);
  });

  /**
   * RE-IMPORTING IS NOT RE-MINTING. A second import of the module inside one
   * process must return the same value, or two callers in the same run would
   * hold different identities and each would disown the other's claims.
   */
  it('is the same value on a second import', async () => {
    const again = await import('./executionRun.js');
    expect(again.RUN_ID).toBe(RUN_ID);
  });

  /**
   * A SEPARATE PROCESS IS A SEPARATE RUN, which is the whole property recovery
   * turns on — a restart must not inherit the identity of the process that
   * died. Measured by actually starting one rather than reasoning about it.
   */
  it('is different in a different process', () => {
    const read = () => execFileSync(process.execPath, [
      '--input-type=module', '-e',
      "import { RUN_ID } from './server/lib/executionRun.js'; process.stdout.write(RUN_ID);",
    ], { cwd: process.cwd(), encoding: 'utf8' }).trim();

    const first = read();
    const second = read();

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
    expect(first).not.toBe(RUN_ID);
  });

  /** No environment, no file, no table: three ways for two runs to collide. */
  it('is minted here rather than read from anywhere', () => {
    const source = fs.readFileSync(new URL('./executionRun.js', import.meta.url), 'utf8');
    expect(source).toMatch(/randomUUID\(\)/);
    expect(source).not.toMatch(/process\.env|readFileSync|db\.|prepare\(/);
    expect(source).not.toMatch(/process\.pid|Date\.now/);
  });
});
