import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * PROVING A TRACKING LINK IS LIVE BEFORE THE EMAIL IS SHOWN — R4C.
 *
 * ===========================================================================
 * TWO PROPERTIES CARRY THE WHOLE SLICE, AND THEY PULL OPPOSITE WAYS.
 *
 *   A NEW LINK MUST BE MADE TO WORK. The edge gates every profile on its own
 *   allowlist, and nothing pushed a newly minted token into it. A coach
 *   clicking before a sync saw "Profile unavailable".
 *
 *   NOTHING ELSE MAY MOVE. The narrow call is an UPSERT WITH NO `reconcile`:
 *   sending one token with reconcile would revoke every other live link in
 *   the wild, and a withdrawn link must never come back.
 * ===========================================================================
 */

const edge = vi.hoisted(() => ({
  calls: [],
  reply: { synced: 1, liveAtEdge: 7 },
  throws: null,
  configured: true,
}));

vi.mock('./edgeSync.js', () => ({
  isEdgeConfigured: () => edge.configured,
  activateTokens: async (tokens) => {
    edge.calls.push(tokens);
    if (edge.throws) throw new Error(edge.throws);
    return edge.reply;
  },
}));

const config = vi.hoisted(() => ({ publiclyReachable: true }));
vi.mock('./config.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isPubliclyReachable: () => config.publiclyReachable,
}));

const db = (await import('../db/client.js')).default;
const { ensureTokenLive, activationRequired, ACTIVATION_REFUSAL } = await import('./tokenActivation.js');

/**
 * One relationship, with a coach of its own.
 *
 * A coach each rather than a shared one, because `outreach` is UNIQUE on
 * (athlete_id, coach_id) — the one-token-per-athlete×coach invariant — so two
 * relationships for one athlete need two coaches by definition.
 */
function outreachRow({ revoked = false } = {}) {
  const id = randomUUID();
  const coachId = `coach-${randomUUID().slice(0, 8)}`;
  const token = randomUUID().replace(/-/g, '').slice(0, 32);
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, sport)
    VALUES (?, '2026-09-22T00:00:00.000Z', 'A Coach', ?, 'Duke', 'mens-soccer')
  `).run(coachId, `${coachId}@example.test`);
  db.prepare(`
    INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, revoked_at)
    VALUES (?, 'athlete-x', ?, ?, '2026-09-22T00:00:00.000Z', ?)
  `).run(id, coachId, token, revoked ? '2026-09-22T01:00:00.000Z' : null);
  return { id, token, coachId };
}

/** The athlete `outreach` has a foreign key to. Nothing here is under test. */
function fixtures() {
  db.prepare(`
    INSERT OR IGNORE INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES ('athlete-x', '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z', 'A Athlete',
            'Midfield', 'mens-soccer')
  `).run();
}

beforeEach(() => {
  edge.calls.length = 0;
  edge.reply = { synced: 1, liveAtEdge: 7 };
  edge.throws = null;
  edge.configured = true;
  config.publiclyReachable = true;
  db.exec('DELETE FROM outreach_send; DELETE FROM outreach; DELETE FROM coaches;');
  fixtures();
});

/* ========================================================================== */
/*  The happy path                                                            */
/* ========================================================================== */

describe('activating a new token', () => {
  it('sends exactly that one token, live, and confirms it', async () => {
    const { id, token } = outreachRow();
    const result = await ensureTokenLive(id);

    expect(result).toMatchObject({ ok: true, reason: null, required: true, synced: 1 });
    expect(edge.calls).toEqual([[{ token, revoked: 0 }]]);
  });

  /**
   * THE SAFETY PROPERTY OF THE WHOLE DESIGN. `pushTokens` sends the entire
   * allowlist with `reconcile: true`, which revokes anything the edge holds
   * that the list omits. One token plus reconcile would take down every
   * other coach's link. The narrow call must never carry it.
   */
  it('never asks the edge to reconcile', async () => {
    const { id } = outreachRow();
    await ensureTokenLive(id);

    // The payload is a plain token list. Nothing in it can revoke anything.
    for (const call of edge.calls) {
      expect(Array.isArray(call)).toBe(true);
      for (const t of call) expect(Object.keys(t).sort()).toEqual(['revoked', 'token']);
    }
  });

  it('asks for one token per relationship, not the whole allowlist', async () => {
    outreachRow(); outreachRow();
    const { id } = outreachRow();
    await ensureTokenLive(id);

    expect(edge.calls).toHaveLength(1);
    expect(edge.calls[0]).toHaveLength(1);
  });

  it('gives two relationships their own token each', async () => {
    const a = outreachRow();
    const b = outreachRow();
    await ensureTokenLive(a.id);
    await ensureTokenLive(b.id);

    expect(edge.calls[0][0].token).toBe(a.token);
    expect(edge.calls[1][0].token).toBe(b.token);
    expect(a.token).not.toBe(b.token);
  });
});

/* ========================================================================== */
/*  Refusals                                                                  */
/* ========================================================================== */

describe('when the link must not or cannot be made live', () => {
  /**
   * A REVOKED LINK IS NEVER RESURRECTED. The edge call is an upsert, so
   * sending `revoked: 0` for a withdrawn relationship would put the page back
   * up while the local database still said revoked. Refused before the
   * network is touched at all.
   */
  it('refuses a revoked relationship without calling the edge', async () => {
    const { id } = outreachRow({ revoked: true });
    const result = await ensureTokenLive(id);

    expect(result).toMatchObject({ ok: false, reason: ACTIVATION_REFUSAL.OUTREACH_REVOKED });
    expect(edge.calls).toEqual([]);
  });

  it('refuses when the edge is not configured on a deployment that needs it', async () => {
    edge.configured = false;
    const { id } = outreachRow();
    const result = await ensureTokenLive(id);

    expect(result).toMatchObject({ ok: false, reason: ACTIVATION_REFUSAL.EDGE_NOT_CONFIGURED });
    expect(edge.calls).toEqual([]);
  });

  it('refuses when the edge cannot be reached', async () => {
    edge.throws = 'ECONNREFUSED';
    const { id } = outreachRow();
    const result = await ensureTokenLive(id);

    expect(result).toMatchObject({ ok: false, reason: ACTIVATION_REFUSAL.EDGE_UNREACHABLE });
  });

  /**
   * A 2xx THAT LANDED NOWHERE IS NOT A SUCCESS. This is the exact shape the
   * 2026-08-20 wipe took: calls that looked fine while the edge held nothing.
   */
  it('refuses when the edge accepted the call but synced nothing', async () => {
    edge.reply = { synced: 0, liveAtEdge: 0 };
    const { id } = outreachRow();
    const result = await ensureTokenLive(id);

    expect(result).toMatchObject({ ok: false, reason: ACTIVATION_REFUSAL.NOT_CONFIRMED });
  });

  it('refuses an outreach row that does not exist', async () => {
    expect(await ensureTokenLive('no-such-row')).toMatchObject({ ok: false });
  });

  /** It reports. It never throws — one coach's link must not abort a run. */
  it('never throws, whatever the edge does', async () => {
    edge.throws = 'total collapse';
    const { id } = outreachRow();
    await expect(ensureTokenLive(id)).resolves.toBeTruthy();
  });
});

/* ========================================================================== */
/*  Development                                                               */
/* ========================================================================== */

describe('a link no coach could open', () => {
  /**
   * `isPubliclyReachable()` is already this product's definition of "a real
   * link" — `sitePublisher` refuses to publish without it. On a localhost
   * base URL there is no edge, no coach and nothing to prove, and requiring
   * a round trip would make every local draft fail on a machine with no
   * secrets.
   */
  it('needs no activation when the base URL is localhost', async () => {
    config.publiclyReachable = false;
    const { id } = outreachRow();
    const result = await ensureTokenLive(id);

    expect(result).toMatchObject({ ok: true, required: false });
    expect(edge.calls).toEqual([]);
  });

  it('still refuses a revoked link locally', async () => {
    config.publiclyReachable = false;
    const { id } = outreachRow({ revoked: true });
    expect((await ensureTokenLive(id)).ok).toBe(false);
  });

  it('reports whether activation is required at all', () => {
    config.publiclyReachable = true;
    expect(activationRequired()).toBe(true);
    config.publiclyReachable = false;
    expect(activationRequired()).toBe(false);
  });
});
