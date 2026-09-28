import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { boot } from './index.js';

/**
 * D4.6 — RECOVERY HAPPENS BEFORE ANYTHING CAN BE SERVED.
 *
 * Between a crash and the sweep, every abandoned message is still SENDING, and
 * SENDING means "a transport is working on it". A request answered in that
 * window would be answered from a picture of the world that is known to be
 * wrong. There is no execution route yet, so nothing can observe it today —
 * which is exactly why the ordering is fixed now rather than when the route
 * arrives and nobody remembers this was a requirement.
 *
 * ---------------------------------------------------------------------------
 * BEHAVIOURAL, NOT A GREP OVER index.js, and no socket is opened. `boot` takes
 * the two steps as seams, so the test observes the ORDER THEY RAN IN rather
 * than the order they appear in the source — which is the property that
 * matters and the one a source-string test cannot see.
 * ---------------------------------------------------------------------------
 */

/** A runtime configuration with nothing wrong with it, so boot reaches the sweep. */
const CLEAN_ENV = {};
const exit = () => { throw new Error('assertRuntime refused to start'); };
const silent = { log: () => {}, error: () => {}, warn: () => {} };

describe('the boot sequence', () => {
  it('recovers abandoned claims before it begins listening', () => {
    const order = [];
    const recover = vi.fn(() => { order.push('recover'); return { recovered: 0, sendIds: [] }; });
    const listen = vi.fn(() => { order.push('listen'); return { close() {} }; });

    boot({ env: CLEAN_ENV, log: silent, exit, recover, listen });

    expect(order).toEqual(['recover', 'listen']);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledTimes(1);
  });

  /**
   * A SWEEP THAT THROWS MUST NOT LEAVE A PROCESS SERVING. If the database
   * cannot be put into a state anyone can reason about, the honest outcome is
   * a process that did not start — not one that starts and lies.
   */
  it('does not listen at all if recovery fails', () => {
    const listen = vi.fn();
    const recover = () => { throw new Error('the sweep failed'); };

    expect(() => boot({ env: CLEAN_ENV, log: silent, exit, recover, listen }))
      .toThrow(/the sweep failed/);

    expect(listen).not.toHaveBeenCalled();
  });

  it('refuses a broken configuration before it sweeps anything', () => {
    const recover = vi.fn();
    const listen = vi.fn();

    expect(() => boot({
      // Production with no session secret and no mailbox key: two refusals.
      env: { NODE_ENV: 'production', THRIV3_PRODUCTION: '1' },
      log: silent, exit, recover, listen,
    })).toThrow(/refused to start/);

    expect(recover).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });

  it('reports what it recovered', () => {
    const lines = [];
    boot({
      env: CLEAN_ENV,
      log: { ...silent, log: (m) => lines.push(String(m)) },
      exit,
      recover: () => ({ recovered: 2, sendIds: ['s1', 's2'] }),
      listen: () => ({ close() {} }),
    });

    expect(lines.join('\n')).toMatch(/Recovered 2 abandoned execution claim/);
  });

  /**
   * THE SWEEP IS CALLED, NOT TRIGGERED BY AN IMPORT — D4.6 / §B13. A CLI script
   * that reaches the execution modules for its own work must not rewrite
   * SENDING rows as a side effect of starting up, so the only caller is here.
   */
  it('is the only thing in the server that sweeps', () => {
    const source = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
    const calls = source.match(/recoverPriorRunSendingClaims\s*\(/g) ?? [];
    expect(calls.length).toBe(0);
    expect(source).toMatch(/recover\(\)/);
    expect(source).toMatch(/recover = recoverPriorRunSendingClaims/);

    // The module DEFINES the sweep; nothing at its top level runs it.
    const recovery = fs.readFileSync(
      new URL('./lib/executionRecovery.js', import.meta.url), 'utf8',
    );
    expect(recovery).toMatch(/export function recoverPriorRunSendingClaims/);
    expect(recovery).not.toMatch(/^\s*recoverPriorRunSendingClaims\s*\(/m);
  });
});
