import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Deleting a player, end to end.
 *
 * The headline test reproduces the historical failure directly: two athletes
 * were hard-deleted during testing, their rows went, their Cloudflare pages
 * did not, and the permanence gate then refused every publish until each slug
 * was retired by name. Archiving has to reach the same visible outcome — the
 * athlete gone from the operator's list, their page gone from the next build —
 * while leaving the record behind so the gate can account for the absence.
 */

const { Player } = await import('../db/entities/player.js');
const { createOutreach } = await import('../lib/outreach.js');
const { findOrCreateCoach } = await import('../lib/coaches.js');
const { deactivateAthlete } = await import('../lib/athleteLifecycle.js');
const { sendOutreach } = await import('./sendOutreach.js');
const { assembleSite } = await import('../lib/sitePublisher.js');
const { validateCandidate, writeLedger, readLedger } = await import('../lib/publishManifest.js');
const { readRetirements, retirementRegistryPath } = await import('../lib/orphanRetirement.js');
const db = (await import('../db/client.js')).default;
const { utcNow } = await import('../lib/time.js');

let tmp; let site; let bundle;
const ENDPOINT = 'https://thriv3-profiles.pages.dev/api/track';

function makeAthlete(overrides = {}) {
  const ts = utcNow();
  return Player.create({
    full_name: `Athlete ${randomUUID().slice(0, 6)}`,
    position: 'Left Winger',
    graduation_year: 2027,
    email: 'athlete@example.com',
    highlights_url: 'https://youtu.be/aqz-KE-bpKQ',
    sport: 'mens-soccer',
    created_date: ts,
    updated_date: ts,
    ...overrides,
  });
}

const makeCoach = (label) => findOrCreateCoach({
  full_name: `Coach ${label}`, email: `${randomUUID()}@example.edu`,
  school: `School ${label}`, sport: 'mens-soccer',
});

beforeEach(() => {
  db.exec('DELETE FROM tracking_events; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches;');
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-del-'));
  site = path.join(tmp, 'profiles');
  bundle = path.join(tmp, '_worker.js');
  fs.writeFileSync(bundle, '// bundled worker');
  vi.stubEnv('THRIV3_TRACK_ENDPOINT', ENDPOINT);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe('the historical failure, reproduced end to end', () => {
  it('a published athlete is archived, not erased, and the gate accepts the absence', () => {
    // A published athlete with a coach already holding their link.
    const athlete = makeAthlete();
    const contacted = makeCoach('Contacted');
    const outreach = createOutreach({ athleteId: athlete.id, coachId: contacted.id });
    Player.update(athlete.id, { published_at: utcNow() });

    const staying = makeAthlete();
    Player.update(staying.id, { published_at: utcNow() });
    writeLedger(site, { slugs: [athlete.public_slug, staying.public_slug] });

    // The operator presses Delete.
    deactivateAthlete(athlete.id);

    // 1. THE ROW STILL EXISTS. This is the whole difference from before.
    const row = Player.get(athlete.id);
    expect(row).toBeTruthy();
    expect(row.archived_at).toBeTruthy();
    expect(row.public_slug).toBe(athlete.public_slug);

    // 2. Every link already sent is revoked.
    expect(db.prepare('SELECT revoked_at FROM outreach WHERE id = ?').get(outreach.id).revoked_at)
      .toBeTruthy();

    // 3. Gone from the active list; still reachable by id.
    expect(Player.listActive().map((p) => p.id)).not.toContain(athlete.id);
    expect(Player.listActive().map((p) => p.id)).toContain(staying.id);

    // 4. A coach never written to before is refused — the case archiving alone
    //    could not cover, because there was no row to revoke.
    expect(() => createOutreach({ athleteId: athlete.id, coachId: makeCoach('Fresh').id }))
      .toThrow(/deleted from Thriv3/);

    // 5. The next build leaves them out.
    const built = assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });
    expect(built.written.map((w) => w.slug)).toEqual([staying.public_slug]);

    // 6. The permanence gate accepts the disappearance THROUGH archived_at.
    const verdict = validateCandidate({
      dir: site, endpoint: ENDPOINT, ledger: readLedger(site), retirements: readRetirements(site),
    });
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);

    // 7. And orphan retirement was never involved.
    expect(fs.existsSync(retirementRegistryPath(site))).toBe(false);
    expect(readRetirements(site).entries).toEqual([]);
  });

  it('refuses a direct send for the archived athlete', async () => {
    const athlete = makeAthlete();
    deactivateAthlete(athlete.id);
    await expect(sendOutreach({
      athleteId: athlete.id,
      coaches: [{ id: makeCoach('X').id, email: 'x@example.edu', full_name: 'Coach X' }],
      subject: 'Recruiting', body: 'Hello', collegeName: 'School X',
    })).rejects.toThrow(/deleted from Thriv3[\s\S]*no further recruitment email/i);
  });

  it('the athlete the old hard delete would have ERASED archives cleanly', () => {
    // No outreach at all: the exact shape that used to succeed and leave an
    // orphaned page behind, because the foreign keys had nothing to object to.
    const athlete = makeAthlete();
    Player.update(athlete.id, { published_at: utcNow() });
    writeLedger(site, { slugs: [athlete.public_slug] });

    deactivateAthlete(athlete.id);

    expect(Player.get(athlete.id)).toBeTruthy();
    expect(Player.get(athlete.id).archived_at).toBeTruthy();
    expect(Player.listActive()).toEqual([]);

    // The candidate is empty, so publishing is refused — but for the empty-site
    // reason, never for an unexplained disappearance.
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });
    const verdict = validateCandidate({
      dir: site, endpoint: ENDPOINT, ledger: readLedger(site), retirements: readRetirements(site),
    });
    expect(verdict.failures.join(' ')).toMatch(/no profile pages at all/);
    expect(verdict.failures.join(' ')).not.toMatch(/belongs to no athlete|deliberate archive/);
  });
});

describe('no new outreach after deletion', () => {
  it('refuses a coach who was never contacted', () => {
    const athlete = makeAthlete();
    deactivateAthlete(athlete.id);
    expect(() => createOutreach({ athleteId: athlete.id, coachId: makeCoach('New').id }))
      .toThrow(/deleted from Thriv3/);
  });

  it('refuses a coach who WAS contacted, rather than returning the revoked row', () => {
    const athlete = makeAthlete();
    const coach = makeCoach('Old');
    createOutreach({ athleteId: athlete.id, coachId: coach.id });
    deactivateAthlete(athlete.id);
    expect(() => createOutreach({ athleteId: athlete.id, coachId: coach.id }))
      .toThrow(/deleted from Thriv3/);
  });

  it('carries a machine-readable code as well as a sentence', () => {
    const athlete = makeAthlete();
    deactivateAthlete(athlete.id);
    try {
      createOutreach({ athleteId: athlete.id, coachId: makeCoach('C').id });
      throw new Error('should have refused');
    } catch (err) {
      expect(err.code).toBe('ATHLETE_ARCHIVED');
    }
  });

  it('writes nothing when it refuses', () => {
    const athlete = makeAthlete();
    deactivateAthlete(athlete.id);
    const before = db.prepare('SELECT count(*) AS n FROM outreach').get().n;
    expect(() => createOutreach({ athleteId: athlete.id, coachId: makeCoach('C').id })).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM outreach').get().n).toBe(before);
  });

  it('leaves an ACTIVE athlete entirely alone', () => {
    const athlete = makeAthlete();
    const outreach = createOutreach({ athleteId: athlete.id, coachId: makeCoach('C').id });
    expect(outreach.token).toBeTruthy();
    expect(outreach.revoked_at).toBeNull();
  });
});

describe('archiving is idempotent', () => {
  it('a second archive changes nothing and keeps the first timestamp', () => {
    const athlete = makeAthlete();
    createOutreach({ athleteId: athlete.id, coachId: makeCoach('C').id });

    const first = deactivateAthlete(athlete.id);
    const stamp = Player.get(athlete.id).archived_at;
    const second = deactivateAthlete(athlete.id);

    expect(Player.get(athlete.id).archived_at).toBe(stamp);
    expect(first.revokedOutreach).toBe(1);
    expect(second.revokedOutreach).toBe(0);
  });
});

describe('the active listing is narrow, not destructive', () => {
  it('hides archived athletes from listActive', () => {
    const active = makeAthlete();
    const archived = makeAthlete();
    deactivateAthlete(archived.id);
    expect(Player.listActive().map((p) => p.id)).toEqual([active.id]);
  });

  it('still returns them from list() and get(), so the model layer can reason about them', () => {
    const archived = makeAthlete();
    deactivateAthlete(archived.id);
    expect(Player.list().map((p) => p.id)).toContain(archived.id);
    expect(Player.get(archived.id).full_name).toBe(archived.full_name);
  });

  it('honours sort and limit like the generic list does', () => {
    const a = makeAthlete({ full_name: 'Aaa' });
    makeAthlete({ full_name: 'Bbb' });
    expect(Player.listActive('full_name', 1).map((p) => p.id)).toEqual([a.id]);
  });
});

// ---------------------------------------------------------------------------
// Over HTTP, because the route is the surface the operator actually reaches.

describe('over HTTP', () => {
  let baseUrl;

  beforeAll(async () => {
    const express = (await import('express')).default;
    const { playerLifecycleRouter, blockPlayerHardDelete } = await import('./playerLifecycle.js');

    const app = express();
    app.use(express.json());
    app.use('/api', playerLifecycleRouter);
    // The generic entity delete, wearing the REAL guard rather than a copy of
    // it — the shipped middleware is what this test exercises.
    app.delete('/api/entities/:table/:id', blockPlayerHardDelete, (req, res) => {
      res.json({ success: true, deleted: req.params.table });
    });

    await new Promise((resolve) => {
      const server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
      server.unref();
    });
  });

  it('archives through the endpoint and reports what it revoked', async () => {
    const athlete = makeAthlete();
    createOutreach({ athleteId: athlete.id, coachId: makeCoach('H').id });

    const res = await fetch(`${baseUrl}/api/players/${athlete.id}/archive`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ athleteId: athlete.id, revokedOutreach: 1, fullName: athlete.full_name });
    expect(Player.get(athlete.id).archived_at).toBeTruthy();
  });

  it('404s an unknown athlete rather than pretending', async () => {
    const res = await fetch(`${baseUrl}/api/players/nope/archive`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('is idempotent over HTTP too', async () => {
    const athlete = makeAthlete();
    await fetch(`${baseUrl}/api/players/${athlete.id}/archive`, { method: 'POST' });
    const stamp = Player.get(athlete.id).archived_at;
    const res = await fetch(`${baseUrl}/api/players/${athlete.id}/archive`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(Player.get(athlete.id).archived_at).toBe(stamp);
  });

  it('serves only active athletes from /players/active', async () => {
    const active = makeAthlete();
    const archived = makeAthlete();
    await fetch(`${baseUrl}/api/players/${archived.id}/archive`, { method: 'POST' });

    const rows = await (await fetch(`${baseUrl}/api/players/active`)).json();
    expect(rows.map((r) => r.id)).toEqual([active.id]);
  });

  it('REFUSES the raw delete for players — the door that erased two athletes', async () => {
    const athlete = makeAthlete();
    const res = await fetch(`${baseUrl}/api/entities/players/${athlete.id}`, { method: 'DELETE' });

    expect(res.status).toBe(405);
    expect((await res.json()).error).toMatch(/archived, not deleted/);
    expect(Player.get(athlete.id)).toBeTruthy();   // still there
  });

  it('leaves the other entities deletable', async () => {
    const res = await fetch(`${baseUrl}/api/entities/colleges/anything`, { method: 'DELETE' });
    expect(res.status).toBe(200);
  });
});
