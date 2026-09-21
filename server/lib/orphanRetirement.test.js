import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Retiring an orphaned slug is the second sanctioned way for a page to leave
 * the public site, and the only one that works when the athlete row is gone.
 * Every test here asks the same question: can this grant permission the
 * operator did not actually give?
 */

const {
  retireOrphanSlug, readRetirements, retiredSlugs, retirementRegistryPath,
} = await import('./orphanRetirement.js');
const { validateCandidate, writeLedger, readLedger } = await import('./publishManifest.js');
const { assembleSite, publishSite, stagingDirFor } = await import('./sitePublisher.js');
const { Player } = await import('../db/entities/player.js');
const { findOrCreateCoach } = await import('./coaches.js');
const { createOutreach } = await import('./outreach.js');
const { deactivateAthlete } = await import('./athleteLifecycle.js');
const db = (await import('../db/client.js')).default;
const { utcNow } = await import('./time.js');

let tmp; let site; let bundle; let fakeBin;

const ENDPOINT = 'https://thriv3-profiles.pages.dev/api/track';
const readyEnv = (extra = {}) => ({
  CLOUDFLARE_API_TOKEN: 'cf-token-value-long-enough',
  CLOUDFLARE_ACCOUNT_ID: 'acct-123',
  THRIV3_WRANGLER_BIN: fakeBin,
  ...extra,
});
const okDeploy = async () => ({ stdout: 'https://abc.thriv3-profiles.pages.dev', stderr: '' });

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

function makePublicAthlete(overrides = {}) {
  const athlete = makeAthlete(overrides);
  Player.update(athlete.id, { published_at: utcNow() });
  const coach = findOrCreateCoach({
    full_name: 'Coach', email: `${randomUUID()}@example.edu`, school: 'S', sport: 'mens-soccer',
  });
  createOutreach({ athleteId: athlete.id, coachId: coach.id });
  return Player.get(athlete.id);
}

/** Exactly the production situation: deployed, then the row was DELETED. */
function orphanedSlugFromLastDeployment(otherSlugs = []) {
  const athlete = makePublicAthlete();
  const slug = athlete.public_slug;
  db.prepare('DELETE FROM outreach WHERE athlete_id = ?').run(athlete.id);
  db.prepare('DELETE FROM players WHERE id = ?').run(athlete.id);
  writeLedger(site, { slugs: [slug, ...otherSlugs] });
  return slug;
}

const validate = (dir = site) => validateCandidate({
  dir, endpoint: ENDPOINT, ledger: readLedger(site), retirements: readRetirements(site),
});

beforeEach(() => {
  db.exec('DELETE FROM tracking_events; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches;');
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-orphan-'));
  site = path.join(tmp, 'profiles');
  bundle = path.join(tmp, '_worker.js');
  fs.writeFileSync(bundle, '// bundled worker');
  fakeBin = path.join(tmp, 'wrangler');
  fs.writeFileSync(fakeBin, '#!/bin/sh\n');
  vi.stubEnv('THRIV3_TRACK_ENDPOINT', ENDPOINT);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe('an orphaned slug stays blocked until it is retired by name', () => {
  it('1. refuses while there is no retirement record', () => {
    const slug = orphanedSlugFromLastDeployment();
    makePublicAthlete();
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });

    const verdict = validate();
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(' ')).toContain(slug);
    expect(verdict.failures.join(' ')).toMatch(/belongs to no athlete/);
  });

  it('names the command that would fix it, rather than only the problem', () => {
    const slug = orphanedSlugFromLastDeployment();
    makePublicAthlete();
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });
    expect(validate().failures.join(' ')).toContain(`retire-profile -- ${slug}`);
  });

  it('2. passes once that slug is explicitly retired', () => {
    const slug = orphanedSlugFromLastDeployment();
    makePublicAthlete();
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });

    retireOrphanSlug({ slug, reason: 'old test athlete', outputDir: site });

    expect(validate()).toMatchObject({ ok: true, failures: [] });
  });

  it('5. retiring orphan A does not authorise orphan B to disappear', () => {
    const a = orphanedSlugFromLastDeployment();
    const b = orphanedSlugFromLastDeployment([a]);
    makePublicAthlete();
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });

    retireOrphanSlug({ slug: a, reason: 'retired A', outputDir: site });

    const verdict = validate();
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(' ')).toContain(b);
    expect(verdict.failures.join(' ')).not.toContain(a);
  });

  it('6. a slug nobody has said anything about stays fail-closed', () => {
    orphanedSlugFromLastDeployment();
    makePublicAthlete();
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });
    retireOrphanSlug({ slug: 'somethingelse', reason: 'unrelated', outputDir: site });

    expect(validate().ok).toBe(false);
  });
});

describe('it cannot be used on an athlete who still exists', () => {
  it('3. refuses a slug owned by an active athlete, and says to archive instead', () => {
    const athlete = makePublicAthlete();
    expect(() => retireOrphanSlug({
      slug: athlete.public_slug, reason: 'trying to shortcut', outputDir: site,
    })).toThrow(/active athlete[\s\S]*[Aa]rchive/);
    expect(readRetirements(site).entries).toEqual([]);
  });

  it('refuses a slug owned by an archived athlete — archive already covers it', () => {
    const athlete = makePublicAthlete();
    deactivateAthlete(athlete.id);
    expect(() => retireOrphanSlug({
      slug: athlete.public_slug, reason: 'belt and braces', outputDir: site,
    })).toThrow(/already archived/);
  });

  it('4. the archive path still works untouched', () => {
    const staying = makePublicAthlete();
    const going = makePublicAthlete();
    writeLedger(site, { slugs: [staying.public_slug, going.public_slug] });
    deactivateAthlete(going.id);
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });

    const verdict = validate();
    expect(verdict.ok).toBe(true);
    expect(verdict.slugs).toEqual([staying.public_slug]);
  });
});

describe('the record itself', () => {
  it('requires a reason', () => {
    expect(() => retireOrphanSlug({ slug: 'abc123', reason: '  ', outputDir: site }))
      .toThrow(/reason is required/);
  });

  it('refuses anything that is not slug-shaped', () => {
    for (const bad of ['../../etc/passwd', 'has-a-dash', '', 'x'.repeat(33)]) {
      expect(() => retireOrphanSlug({ slug: bad, reason: 'r', outputDir: site })).toThrow();
    }
  });

  it('stores slug, retiredAt and reason', () => {
    retireOrphanSlug({ slug: 'IS3VBFXYtd', reason: 'old test athlete Brendon', outputDir: site });
    expect(readRetirements(site).entries).toEqual([
      { slug: 'IS3VBFXYtd', retiredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/), reason: 'old test athlete Brendon' },
    ]);
  });

  it('is idempotent, and a rerun does not rewrite who decided what and when', () => {
    const first = retireOrphanSlug({ slug: 'abc123', reason: 'first reason', outputDir: site });
    const second = retireOrphanSlug({ slug: 'abc123', reason: 'DIFFERENT reason', outputDir: site });

    expect(second.alreadyRetired).toBe(true);
    expect(second.retiredAt).toBe(first.retiredAt);
    expect(second.reason).toBe('first reason');
    expect(readRetirements(site).entries).toHaveLength(1);
  });

  it('7. survives a reload from disk, which is the whole point of it', () => {
    retireOrphanSlug({ slug: 'abc123', reason: 'durable', outputDir: site });
    // A fresh read is what a restarted Render process does.
    expect(retiredSlugs(readRetirements(site)).has('abc123')).toBe(true);
    expect(fs.existsSync(retirementRegistryPath(site))).toBe(true);
  });

  it('lives beside the site, never inside it, so it is never published', () => {
    retireOrphanSlug({ slug: 'abc123', reason: 'r', outputDir: site });
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });
    expect(fs.existsSync(retirementRegistryPath(site))).toBe(true);
    expect(retirementRegistryPath(site).startsWith(`${site}${path.sep}`)).toBe(false);
  });
});

describe('8. malformed state fails closed and says so', () => {
  it.each([
    ['unparseable JSON', '{not json'],
    ['no retirements array', '{"foo":1}'],
    ['an entry with no reason', '{"retirements":[{"slug":"abc123","retiredAt":"2026-01-01T00:00:00Z"}]}'],
    ['an entry with no slug', '{"retirements":[{"retiredAt":"2026-01-01T00:00:00Z","reason":"r"}]}'],
    ['a slug that is not slug-shaped', '{"retirements":[{"slug":"../x","retiredAt":"2026-01-01T00:00:00Z","reason":"r"}]}'],
  ])('reports %s rather than treating it as no retirements', (_label, body) => {
    const slug = orphanedSlugFromLastDeployment();
    makePublicAthlete();
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });
    fs.writeFileSync(retirementRegistryPath(site), body);

    const result = readRetirements(site);
    expect(result.error).toBeTruthy();
    expect(retiredSlugs(result).size).toBe(0);

    const verdict = validate();
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(' ')).toMatch(/retirement register could not be read/);
    expect(verdict.failures.join(' ')).toContain(slug);
  });

  it('refuses to add a retirement while the register is unreadable', () => {
    fs.mkdirSync(path.dirname(retirementRegistryPath(site)), { recursive: true });
    fs.writeFileSync(retirementRegistryPath(site), '{broken');
    expect(() => retireOrphanSlug({ slug: 'abc123', reason: 'r', outputDir: site }))
      .toThrow(/register is unreadable/);
  });

  it('a corrupt register cannot make an otherwise-fine candidate publish', async () => {
    makePublicAthlete();
    fs.mkdirSync(site, { recursive: true });
    fs.writeFileSync(retirementRegistryPath(site), '{"retirements":"all of them"}');
    await expect(publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: okDeploy }))
      .rejects.toThrow(/retirement register could not be read/);
  });
});

describe('it does not disturb the rest of the gate', () => {
  it('9. an empty candidate is still refused, retirements or not', () => {
    const slug = orphanedSlugFromLastDeployment();
    retireOrphanSlug({ slug, reason: 'retired', outputDir: site });
    fs.mkdirSync(path.join(site, 'p'), { recursive: true });
    fs.writeFileSync(path.join(site, '_worker.js'), 'x');
    fs.writeFileSync(path.join(site, 'robots.txt'), 'x');

    const verdict = validate();
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(' ')).toMatch(/no profile pages at all/);
  });

  it('a live athlete missing from the candidate is still refused', () => {
    const slug = orphanedSlugFromLastDeployment();
    const live = makePublicAthlete();
    retireOrphanSlug({ slug, reason: 'retired', outputDir: site });
    // Broken BEFORE assembling, so the candidate genuinely lacks their page.
    Player.update(live.id, { email: '' });
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });

    const verdict = validate();
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(' ')).toContain(live.full_name);
  });
});

describe('11 & 12. retirement and the ledger stay separate', () => {
  it('11. retiring does not touch the ledger', () => {
    const slug = orphanedSlugFromLastDeployment();
    const before = fs.readFileSync(`${site}.deployed.json`, 'utf-8');
    retireOrphanSlug({ slug, reason: 'retired' , outputDir: site });
    expect(fs.readFileSync(`${site}.deployed.json`, 'utf-8')).toBe(before);
    expect(readLedger(site).slugs).toContain(slug);
  });

  it('11. the ledger records the deployment that actually happened', async () => {
    const slug = orphanedSlugFromLastDeployment();
    const live = makePublicAthlete();
    retireOrphanSlug({ slug, reason: 'old test athlete', outputDir: site });

    await publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: okDeploy });

    // The retired slug leaves the ledger because it left the deployment, not
    // because anything edited the ledger to make validation pass.
    expect(readLedger(site).slugs).toEqual([live.public_slug]);
    expect(readRetirements(site).entries.map((r) => r.slug)).toEqual([slug]);
  });

  it('12. a failed deploy consumes nothing, so the next attempt decides the same way', async () => {
    const slug = orphanedSlugFromLastDeployment();
    makePublicAthlete();
    retireOrphanSlug({ slug, reason: 'old test athlete', outputDir: site });

    const ledgerBefore = fs.readFileSync(`${site}.deployed.json`, 'utf-8');
    const registerBefore = fs.readFileSync(retirementRegistryPath(site), 'utf-8');

    const failing = async () => { const e = new Error('boom'); e.stderr = 'upload interrupted'; throw e; };
    await expect(publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: failing }))
      .rejects.toThrow(/previous public site is still serving/);

    expect(fs.readFileSync(`${site}.deployed.json`, 'utf-8')).toBe(ledgerBefore);
    expect(fs.readFileSync(retirementRegistryPath(site), 'utf-8')).toBe(registerBefore);
    expect(fs.existsSync(stagingDirFor(site))).toBe(false);

    // And the retry still succeeds on exactly the same state.
    await expect(publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: okDeploy }))
      .resolves.toBeTruthy();
  });
});
