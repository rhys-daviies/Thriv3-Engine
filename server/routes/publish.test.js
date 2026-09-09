import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

const { publishStatus, regenerate, publish } = await import('./publish.js');
const { Player } = await import('../db/entities/player.js');
const db = (await import('../db/client.js')).default;
const { utcNow } = await import('../lib/time.js');

/** Enough of an Express request for the preview URL to be built. */
const req = { protocol: 'https', get: () => 'thriv3-operator.onrender.com' };

function makeAthlete(overrides = {}) {
  const ts = utcNow();
  return Player.create({
    full_name: 'Nikau Brennan',
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

/** A deploy that records the call instead of reaching Cloudflare. */
function fakeDeploy(result = {}) {
  const calls = [];
  const fn = async () => {
    calls.push(true);
    return { written: [{ name: 'Nikau Brennan', slug: 'abc' }], skipped: [], deploymentUrl: 'https://x.pages.dev', ...result };
  };
  fn.calls = calls;
  return fn;
}

beforeEach(() => {
  db.exec('DELETE FROM tracking_events; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches;');
});

describe('publishStatus', () => {
  it('reports a complete athlete as publishable, with the coach-facing URL', () => {
    const athlete = makeAthlete();
    const status = publishStatus(athlete.id, req);

    expect(status.canPublish).toBe(true);
    expect(status.missing).toEqual([]);
    // PUBLIC_BASE_URL is read once at import, so the host here is whatever the
    // process booted with — asserting the path is what this test can honestly
    // claim. The base URL itself is covered by the readiness checks.
    expect(status.url).toBe(`${status.baseUrl}/p/${Player.get(athlete.id).public_slug}.html`);
    expect(status.url).toMatch(/\/p\/[A-Za-z0-9]+\.html$/);
    expect(status.publishedAt).toBeNull();
  });

  it('names what is missing rather than only refusing', () => {
    const athlete = makeAthlete({ email: null });
    const status = publishStatus(athlete.id, req);
    expect(status.canPublish).toBe(false);
    expect(status.missing.join(' ')).toContain('contact email');
  });

  it('refuses an archived athlete whose links are revoked', () => {
    const athlete = makeAthlete();
    Player.update(athlete.id, { archived_at: utcNow() });
    const status = publishStatus(athlete.id, req);
    expect(status.canPublish).toBe(false);
    expect(status.archived).toBe(true);
  });

  it('reports whether the host can publish at all, separately from the athlete', () => {
    const status = publishStatus(makeAthlete().id, req);
    expect(status).toHaveProperty('publisherReady');
    expect(Array.isArray(status.publisherProblems)).toBe(true);
  });

  it('gives a preview URL on this host, distinct from the public one', () => {
    const status = publishStatus(makeAthlete().id, req);
    expect(status.previewUrl).toContain('https://thriv3-operator.onrender.com/p/');
    expect(status.previewUrl).not.toBe(status.url);
  });

  it('throws for an unknown athlete', () => {
    expect(() => publishStatus(randomUUID(), req)).toThrow(/Unknown athlete/);
  });
});

describe('publish', () => {
  it('deploys and records when it was published', async () => {
    const athlete = makeAthlete();
    const deploy = fakeDeploy();

    const result = await publish(athlete.id, req, { deploy });

    expect(deploy.calls).toHaveLength(1);
    expect(result.deploymentUrl).toBe('https://x.pages.dev');
    expect(result.published).toBe(1);
    expect(Player.get(athlete.id).published_at).toBe(result.publishedAt);
  });

  it('refuses an incomplete athlete without deploying', async () => {
    const athlete = makeAthlete({ email: null });
    const deploy = fakeDeploy();

    await expect(publish(athlete.id, req, { deploy })).rejects.toThrow(/missing/);
    expect(deploy.calls).toHaveLength(0);
  });

  it('refuses an archived athlete without deploying', async () => {
    const athlete = makeAthlete();
    Player.update(athlete.id, { archived_at: utcNow() });
    const deploy = fakeDeploy();

    await expect(publish(athlete.id, req, { deploy })).rejects.toThrow(/archived/);
    expect(deploy.calls).toHaveLength(0);
  });

  it('does not mark an athlete published when the deploy fails', async () => {
    const athlete = makeAthlete();
    const deploy = async () => { throw new Error('Cannot publish — CLOUDFLARE_API_TOKEN is not set.'); };

    await expect(publish(athlete.id, req, { deploy })).rejects.toThrow(/CLOUDFLARE_API_TOKEN/);
    expect(Player.get(athlete.id).published_at).toBeFalsy();
  });

  it('leaves the slug untouched, so links already sent keep working', async () => {
    const athlete = makeAthlete();
    const slug = Player.get(athlete.id).public_slug;

    await publish(athlete.id, req, { deploy: fakeDeploy() });
    await publish(athlete.id, req, { deploy: fakeDeploy() });

    expect(Player.get(athlete.id).public_slug).toBe(slug);
  });

  it('does not touch outreach or revocation state', async () => {
    const athlete = makeAthlete();
    const before = db.prepare('SELECT COUNT(*) c FROM outreach').get().c;

    await publish(athlete.id, req, { deploy: fakeDeploy() });

    expect(db.prepare('SELECT COUNT(*) c FROM outreach').get().c).toBe(before);
  });
});

describe('regenerate', () => {
  it('writes the page locally without deploying anything', () => {
    const athlete = makeAthlete();
    const result = regenerate(athlete.id, req);
    expect(result.generated).toBe(true);
    expect(Player.get(athlete.id).published_at).toBeFalsy();
  });

  it('refuses an incomplete athlete', () => {
    const athlete = makeAthlete({ email: null });
    expect(() => regenerate(athlete.id, req)).toThrow(/Cannot generate/);
  });
});
