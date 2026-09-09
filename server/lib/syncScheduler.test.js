import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const syncWithEdge = vi.fn();
const isEdgeConfigured = vi.fn(() => true);
vi.mock('./edgeSync.js', () => ({
  syncWithEdge: (...a) => syncWithEdge(...a),
  isEdgeConfigured: (...a) => isEdgeConfigured(...a),
}));

const { runOnce, syncStatus, startSyncScheduler, stopSyncScheduler, resetSyncScheduler } =
  await import('./syncScheduler.js');

const quiet = { log: () => {}, warn: () => {}, error: () => {} };
// The shape `pullEvents` actually returns. This fixture previously said
// `{ pulled: 2 }`, which is the key the scheduler was reading and the reason
// the bug survived: the test agreed with the mistake.
const okResult = {
  tokens: { pushed: 3, liveAtEdge: 3 },
  events: { fetched: 2, inserted: 2, unresolved: 0 },
  suppressions: { added: 0, unresolved: [] },
};

beforeEach(() => { resetSyncScheduler(); syncWithEdge.mockReset(); isEdgeConfigured.mockReturnValue(true); });
afterEach(() => stopSyncScheduler());

describe('what the log reports', () => {
  it('reports the number of events actually pulled', async () => {
    syncWithEdge.mockResolvedValue(okResult);
    const lines = [];
    await runOnce({ log: { ...quiet, log: (m) => lines.push(m) } });
    expect(lines.join(' ')).toContain('2 event(s) pulled');
    expect(lines.join(' ')).not.toContain('0 event(s) pulled');
  });

  it('distinguishes fetched from newly inserted when a replay is absorbed', async () => {
    syncWithEdge.mockResolvedValue({ ...okResult, events: { fetched: 5, inserted: 1, unresolved: 0 } });
    const lines = [];
    await runOnce({ log: { ...quiet, log: (m) => lines.push(m) } });
    expect(lines.join(' ')).toContain('5 event(s) pulled, 1 new');
  });

  it('says when events could not be attributed to a coach', async () => {
    syncWithEdge.mockResolvedValue({ ...okResult, events: { fetched: 4, inserted: 4, unresolved: 2 } });
    const lines = [];
    await runOnce({ log: { ...quiet, log: (m) => lines.push(m) } });
    expect(lines.join(' ')).toContain('2 unattributable');
  });

  it('reports zero honestly when nothing arrived', async () => {
    syncWithEdge.mockResolvedValue({ ...okResult, events: { fetched: 0, inserted: 0, unresolved: 0 } });
    const lines = [];
    await runOnce({ log: { ...quiet, log: (m) => lines.push(m) } });
    expect(lines.join(' ')).toContain('0 event(s) pulled');
  });
});

describe('runOnce', () => {
  it('records a success and clears the failure count', async () => {
    syncWithEdge.mockResolvedValue(okResult);
    await runOnce({ log: quiet });
    const s = syncStatus();
    expect(s.lastSuccessAt).toBeTruthy();
    expect(s.lastError).toBeNull();
    expect(s.consecutiveFailures).toBe(0);
    expect(s.minutesSinceSuccess).toBe(0);
  });

  it('holds the error and rethrows rather than swallowing it', async () => {
    syncWithEdge.mockRejectedValue(new Error('edge unreachable'));
    await expect(runOnce({ log: quiet })).rejects.toThrow('edge unreachable');
    const s = syncStatus();
    expect(s.lastError.message).toBe('edge unreachable');
    expect(s.consecutiveFailures).toBe(1);
    // Never succeeded is a different thing from "a while ago".
    expect(s.minutesSinceSuccess).toBeNull();
  });

  it('counts consecutive failures and resets on recovery', async () => {
    syncWithEdge.mockRejectedValue(new Error('down'));
    await runOnce({ log: quiet }).catch(() => {});
    await runOnce({ log: quiet }).catch(() => {});
    expect(syncStatus().consecutiveFailures).toBe(2);
    syncWithEdge.mockResolvedValue(okResult);
    await runOnce({ log: quiet });
    expect(syncStatus().consecutiveFailures).toBe(0);
  });

  it('warns when the edge disagrees about how many tokens are live', async () => {
    const warn = vi.fn();
    syncWithEdge.mockResolvedValue({ ...okResult, tokens: { pushed: 18, liveAtEdge: 0 } });
    await runOnce({ log: { ...quiet, warn } });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/MISMATCH/));
  });

  it('warns about opt-outs it could not attribute', async () => {
    const warn = vi.fn();
    syncWithEdge.mockResolvedValue({ ...okResult, suppressions: { added: 0, unresolved: ['tok'] } });
    await runOnce({ log: { ...quiet, warn } });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/could not be matched/));
  });

  it('does not overlap itself', async () => {
    let release;
    syncWithEdge.mockImplementation(() => new Promise((r) => { release = () => r(okResult); }));
    const first = runOnce({ log: quiet });
    const second = await runOnce({ log: quiet });
    expect(second).toEqual({ skipped: 'already running' });
    release();
    await first;
    expect(syncWithEdge).toHaveBeenCalledTimes(1);
  });
});

describe('startSyncScheduler', () => {
  it('stays off unless an interval is configured, and says why', () => {
    const r = startSyncScheduler({ log: quiet });
    expect(r.started).toBe(false);
    expect(r.reason).toMatch(/THRIV3_SYNC_INTERVAL_MINUTES/);
  });

  it('reports never running as a state, not as an error', () => {
    expect(syncStatus().running).toBe(false);
    expect(syncStatus().lastSuccessAt).toBeNull();
  });
});

describe('an edge deployed before opt-outs existed', () => {
  it('warns loudly rather than failing the whole run', async () => {
    const warn = vi.fn();
    syncWithEdge.mockResolvedValue({
      ...okResult,
      suppressions: { pulled: 0, added: 0, already: 0, unresolved: [], endpointMissing: true },
    });
    await runOnce({ log: { ...quiet, warn } });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/NOT being collected/));
    // Tokens and events still synced, so the run counts as a success.
    expect(syncStatus().lastSuccessAt).toBeTruthy();
    expect(syncStatus().lastError).toBeNull();
  });
});
