import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const {
  resolveWranglerBin, publisherReadiness, assembleSite, publishSite, redactSecrets, WORKER_BUNDLE,
} = await import('./sitePublisher.js');
const { Player } = await import('../db/entities/player.js');
const db = (await import('../db/client.js')).default;
const { utcNow } = await import('./time.js');

let tmp;
let bundle;
let fakeBin;

/** A minimal environment in which publishing is possible. */
function readyEnv(extra = {}) {
  return {
    CLOUDFLARE_API_TOKEN: 'cf-token-value-long-enough',
    CLOUDFLARE_ACCOUNT_ID: 'acct-123',
    THRIV3_WRANGLER_BIN: fakeBin,
    ...extra,
  };
}

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

beforeEach(() => {
  db.exec('DELETE FROM tracking_events; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches;');
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-pub-'));
  bundle = path.join(tmp, '_worker.js');
  fs.writeFileSync(bundle, '// bundled worker');
  fakeBin = path.join(tmp, 'wrangler');
  fs.writeFileSync(fakeBin, '#!/bin/sh\n');
  vi.stubEnv('THRIV3_TRACK_ENDPOINT', 'https://thriv3-profiles.pages.dev/api/track');
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('resolving wrangler', () => {
  it('prefers an explicit override', () => {
    expect(resolveWranglerBin({ env: { THRIV3_WRANGLER_BIN: '/somewhere/wrangler' } }))
      .toBe('/somewhere/wrangler');
  });

  it('finds the binary in node_modules/.bin rather than trusting PATH', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-root-'));
    fs.mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', '.bin', 'wrangler'), '');
    expect(resolveWranglerBin({ root, env: {} })).toBe(path.join(root, 'node_modules', '.bin', 'wrangler'));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns null rather than a bare name that would fail at spawn time', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-empty-'));
    expect(resolveWranglerBin({ root, env: {} })).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('readiness', () => {
  it('is ready when the binary, bundle and credentials are all present', () => {
    const result = publisherReadiness({ env: readyEnv(), workerBundle: bundle });
    expect(result.problems).toEqual([]);
    expect(result.ready).toBe(true);
  });

  it('names a missing wrangler rather than failing at the click', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-nobin-'));
    const result = publisherReadiness({ env: { CLOUDFLARE_API_TOKEN: 'x', CLOUDFLARE_ACCOUNT_ID: 'y' }, root, workerBundle: bundle });
    expect(result.ready).toBe(false);
    expect(result.problems.join(' ')).toMatch(/wrangler is not installed/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ['CLOUDFLARE_API_TOKEN', { CLOUDFLARE_API_TOKEN: '' }],
    ['CLOUDFLARE_ACCOUNT_ID', { CLOUDFLARE_ACCOUNT_ID: '' }],
  ])('names a missing %s', (name, override) => {
    const result = publisherReadiness({ env: readyEnv(override), workerBundle: bundle });
    expect(result.ready).toBe(false);
    expect(result.problems.join(' ')).toContain(name);
  });

  it('refuses a localhost tracking endpoint — the silent killer', () => {
    vi.stubEnv('THRIV3_TRACK_ENDPOINT', 'http://localhost:8787/api/track');
    const result = publisherReadiness({ env: readyEnv(), workerBundle: bundle });
    expect(result.ready).toBe(false);
    expect(result.problems.join(' ')).toMatch(/no coach's browser can reach/);
  });

  it('reports every gap at once rather than one per attempt', () => {
    vi.stubEnv('THRIV3_TRACK_ENDPOINT', 'http://localhost:8787/api/track');
    const result = publisherReadiness({
      env: readyEnv({ CLOUDFLARE_API_TOKEN: '' }), workerBundle: path.join(tmp, 'absent.js'),
    });
    expect(result.problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe('assembling the site', () => {
  it('writes every eligible athlete, robots.txt and the worker', () => {
    const athlete = makeAthlete();
    const out = path.join(tmp, 'site');

    const result = assembleSite({ outputDir: out, workerBundle: bundle });

    expect(result.written).toHaveLength(1);
    expect(fs.existsSync(path.join(out, 'p', `${Player.get(athlete.id).public_slug}.html`))).toBe(true);
    expect(fs.existsSync(path.join(out, 'robots.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(out, '_worker.js'), 'utf-8')).toBe('// bundled worker');
  });

  it('skips an athlete missing required core rather than publishing a broken page', () => {
    makeAthlete({ email: null });
    const result = assembleSite({ outputDir: path.join(tmp, 'site'), workerBundle: bundle });
    expect(result.written).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it('never publishes an archived athlete', () => {
    const athlete = makeAthlete();
    Player.update(athlete.id, { archived_at: utcNow() });
    const result = assembleSite({ outputDir: path.join(tmp, 'site'), workerBundle: bundle });
    expect(result.written).toHaveLength(0);
  });

  it('keeps the slug stable across regenerations, so sent links keep working', () => {
    const athlete = makeAthlete();
    const slug = Player.get(athlete.id).public_slug;
    const out = path.join(tmp, 'site');

    assembleSite({ outputDir: out, workerBundle: bundle });
    assembleSite({ outputDir: out, workerBundle: bundle });

    expect(Player.get(athlete.id).public_slug).toBe(slug);
    expect(fs.existsSync(path.join(out, 'p', `${slug}.html`))).toBe(true);
  });

  it('bakes the production tracking endpoint into the page, never localhost', () => {
    const athlete = makeAthlete();
    const out = path.join(tmp, 'site');
    assembleSite({ outputDir: out, workerBundle: bundle });

    const html = fs.readFileSync(path.join(out, 'p', `${Player.get(athlete.id).public_slug}.html`), 'utf-8');
    expect(html).toContain('https://thriv3-profiles.pages.dev/api/track');
    expect(html).not.toContain('localhost:8787');
  });

  it('refuses when the worker bundle is absent rather than deploying pages with no collector', () => {
    makeAthlete();
    expect(() => assembleSite({ outputDir: path.join(tmp, 'site'), workerBundle: path.join(tmp, 'gone.js') }))
      .toThrow(/Worker bundle not found/);
  });
});

describe('deploying', () => {
  it('invokes wrangler against the configured project and directory', async () => {
    makeAthlete();
    const calls = [];
    const exec = async (bin, args, opts) => {
      calls.push({ bin, args, opts });
      return { stdout: 'Deployment complete! https://abc123.thriv3-profiles.pages.dev', stderr: '' };
    };

    const result = await publishSite({
      outputDir: path.join(tmp, 'site'), workerBundle: bundle, env: readyEnv(), exec,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].bin).toBe(fakeBin);
    expect(calls[0].args).toEqual([
      'pages', 'deploy', path.join(tmp, 'site'),
      '--project-name', 'thriv3-profiles',
      '--branch', 'main',
      '--commit-dirty=true',
    ]);
    expect(result.deploymentUrl).toBe('https://abc123.thriv3-profiles.pages.dev');
  });

  it('passes credentials in the child environment, never in argv', async () => {
    makeAthlete();
    let seen;
    const exec = async (bin, args, opts) => { seen = { args, opts }; return { stdout: '', stderr: '' }; };

    await publishSite({ outputDir: path.join(tmp, 'site'), workerBundle: bundle, env: readyEnv(), exec });

    expect(seen.args.join(' ')).not.toContain('cf-token-value-long-enough');
    expect(seen.opts.env.CLOUDFLARE_API_TOKEN).toBe('cf-token-value-long-enough');
    expect(seen.opts.env.CLOUDFLARE_ACCOUNT_ID).toBe('acct-123');
  });

  it('refuses before touching the network when not ready', async () => {
    let called = false;
    const exec = async () => { called = true; return { stdout: '', stderr: '' }; };

    await expect(publishSite({
      outputDir: path.join(tmp, 'site'), workerBundle: bundle,
      env: readyEnv({ CLOUDFLARE_API_TOKEN: '' }), exec,
    })).rejects.toThrow(/CLOUDFLARE_API_TOKEN/);
    expect(called).toBe(false);
  });

  it('does not leak the token when wrangler fails', async () => {
    makeAthlete();
    const exec = async () => {
      const err = new Error('failed');
      err.stderr = 'Authentication error using token cf-token-value-long-enough';
      throw err;
    };

    await expect(publishSite({
      outputDir: path.join(tmp, 'site'), workerBundle: bundle, env: readyEnv(), exec,
    })).rejects.toThrow(/\[redacted\]/);
  });
});

describe('redaction', () => {
  it('removes the api token and the sync secret', () => {
    const env = { CLOUDFLARE_API_TOKEN: 'tok-abcdef', THRIV3_SYNC_SECRET: 'sec-abcdef' };
    expect(redactSecrets('saw tok-abcdef and sec-abcdef', env)).toBe('saw [redacted] and [redacted]');
  });

  it('leaves text alone when nothing is configured', () => {
    expect(redactSecrets('nothing secret here', {})).toBe('nothing secret here');
  });
});

describe('the default bundle location', () => {
  it('lives in the build output, so it survives the production prune', () => {
    expect(WORKER_BUNDLE).toMatch(/build[/\\]worker[/\\]_worker\.js$/);
  });
});
