import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * The permanence suite.
 *
 * Every test here answers the same question from a different direction: can
 * this happen to a URL that is already sitting in a college coach's inbox?
 * The passing condition is almost always "the publish is refused and the live
 * site is untouched" rather than "the publish succeeds", because a refused
 * publish costs an operator ten minutes and a broken link costs an athlete a
 * recruiting cycle.
 */

const { publishSite, assembleSite, stagingDirFor } = await import('./sitePublisher.js');
const { validateCandidate, expectedPublicAthletes, readLedger, writeLedger, ledgerPath } =
  await import('./publishManifest.js');
const { Player } = await import('../db/entities/player.js');
const { findOrCreateCoach } = await import('./coaches.js');
const { createOutreach } = await import('./outreach.js');
const { deactivateAthlete } = await import('./athleteLifecycle.js');
const { publish } = await import('../routes/publish.js');
const db = (await import('../db/client.js')).default;
const { utcNow } = await import('./time.js');

let tmp;
let site;
let bundle;
let fakeBin;

const readyEnv = (extra = {}) => ({
  CLOUDFLARE_API_TOKEN: 'cf-token-value-long-enough',
  CLOUDFLARE_ACCOUNT_ID: 'acct-123',
  THRIV3_WRANGLER_BIN: fakeBin,
  ...extra,
});

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

/** An athlete a coach already has a link for: published, with a live token. */
function makePublicAthlete(overrides = {}) {
  const athlete = makeAthlete(overrides);
  Player.update(athlete.id, { published_at: utcNow() });
  const coach = findOrCreateCoach({
    full_name: 'Coach', email: `${randomUUID()}@example.edu`, school: 'S', sport: 'mens-soccer',
  });
  const outreach = createOutreach({ athleteId: athlete.id, coachId: coach.id });
  return { athlete: Player.get(athlete.id), outreach };
}

const okDeploy = async () => ({ stdout: 'https://abc.thriv3-profiles.pages.dev', stderr: '' });
const deployTo = (calls) => async (bin, args, opts) => {
  calls.push({ bin, args, opts });
  return okDeploy();
};

const pagesIn = (dir) => {
  const p = path.join(dir, 'p');
  return fs.existsSync(p) ? fs.readdirSync(p).sort() : [];
};

beforeEach(() => {
  db.exec('DELETE FROM tracking_events; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches;');
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-perm-'));
  site = path.join(tmp, 'profiles');
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

// ---------------------------------------------------------------------------

describe('the expected public set', () => {
  it('counts an athlete who has been published', () => {
    const { athlete } = makePublicAthlete();
    expect(expectedPublicAthletes().map((a) => a.id)).toContain(athlete.id);
  });

  it('counts an athlete with a live token even when published_at was never stamped', () => {
    // Publishing ships everyone but stamps only the athlete whose button was
    // pressed, so this is the common case, not an edge one.
    const athlete = makeAthlete();
    const coach = findOrCreateCoach({ full_name: 'C', email: `${randomUUID()}@e.edu`, school: 'S', sport: 'mens-soccer' });
    createOutreach({ athleteId: athlete.id, coachId: coach.id });
    expect(expectedPublicAthletes().map((a) => a.id)).toContain(athlete.id);
  });

  it('drops an archived athlete — the one sanctioned way off the site', () => {
    const { athlete } = makePublicAthlete();
    deactivateAthlete(athlete.id);
    expect(expectedPublicAthletes().map((a) => a.id)).not.toContain(athlete.id);
  });

  it('ignores an athlete who has never been public', () => {
    const athlete = makeAthlete();
    expect(expectedPublicAthletes().map((a) => a.id)).not.toContain(athlete.id);
  });
});

describe('a candidate that would break a live link is refused', () => {
  it('refuses when a previously published athlete has become incomplete', async () => {
    // THE HEADLINE FAILURE MODE. An operator clears a contact email in the
    // morning and publishes somebody else in the afternoon; without this check
    // the first athlete's page silently leaves the site and every coach
    // holding their link is shown "no longer shared".
    const { athlete: live } = makePublicAthlete();
    const other = makeAthlete();
    Player.update(live.id, { email: '' });

    const calls = [];
    await expect(publishSite({
      outputDir: site, workerBundle: bundle, env: readyEnv(), exec: deployTo(calls),
    })).rejects.toThrow(/already public/i);

    expect(calls).toHaveLength(0);
    expect(other.id).toBeTruthy();
  });

  it('names the athlete and the missing field, so the refusal is actionable', async () => {
    const { athlete } = makePublicAthlete();
    Player.update(athlete.id, { email: '' });

    await expect(publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: okDeploy }))
      .rejects.toThrow(new RegExp(`${athlete.full_name}[\\s\\S]*contact email`, 'i'));
  });

  it('refuses when a page in the candidate is zero bytes', () => {
    const { athlete } = makePublicAthlete();
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });
    fs.writeFileSync(path.join(site, 'p', `${athlete.public_slug}.html`), '');

    const verdict = validateCandidate({ dir: site, endpoint: 'https://thriv3-profiles.pages.dev/api/track' });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(' ')).toMatch(/zero bytes/);
  });

  it('refuses a page whose tracker points at localhost', () => {
    makePublicAthlete();
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });
    const file = path.join(site, 'p', fs.readdirSync(path.join(site, 'p'))[0]);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').replace(
      'https://thriv3-profiles.pages.dev/api/track', 'http://localhost:8787/api/track'
    ));

    const verdict = validateCandidate({ dir: site, endpoint: 'https://thriv3-profiles.pages.dev/api/track' });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(' ')).toMatch(/localhost/);
  });

  it('refuses when the worker bundle is missing from the candidate', () => {
    makePublicAthlete();
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });
    fs.rmSync(path.join(site, '_worker.js'));

    const verdict = validateCandidate({ dir: site, endpoint: 'https://thriv3-profiles.pages.dev/api/track' });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(' ')).toMatch(/_worker\.js is missing/);
  });

  it('refuses when robots.txt is missing from the candidate', () => {
    makePublicAthlete();
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });
    fs.rmSync(path.join(site, 'robots.txt'));

    const verdict = validateCandidate({ dir: site, endpoint: 'https://thriv3-profiles.pages.dev/api/track' });
    expect(verdict.failures.join(' ')).toMatch(/robots\.txt is missing/);
  });

  it('refuses an empty candidate rather than blanking the public site', () => {
    fs.mkdirSync(path.join(site, 'p'), { recursive: true });
    fs.writeFileSync(path.join(site, '_worker.js'), 'x');
    fs.writeFileSync(path.join(site, 'robots.txt'), 'x');

    const verdict = validateCandidate({ dir: site, endpoint: 'e' });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(' ')).toMatch(/no profile pages at all/);
  });

  it('refuses a page belonging to an archived athlete', () => {
    const { athlete } = makePublicAthlete();
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });
    deactivateAthlete(athlete.id);

    const verdict = validateCandidate({ dir: site, endpoint: 'https://thriv3-profiles.pages.dev/api/track' });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(' ')).toMatch(/archived/);
  });

  it('refuses a stale file left by an earlier build', () => {
    makePublicAthlete();
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });
    fs.writeFileSync(path.join(site, 'p', 'ghostslug1.html'), '<html></html>');

    const verdict = validateCandidate({ dir: site, endpoint: 'https://thriv3-profiles.pages.dev/api/track' });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(' ')).toMatch(/belongs to no athlete/);
  });

  it('refuses when the last deployment held a slug this one does not', () => {
    // The ledger catches what the database cannot: a slug demonstrably shipped
    // whose athlete row no longer explains its absence.
    makePublicAthlete();
    assembleSite({ outputDir: site, workerBundle: bundle, fresh: true });
    const verdict = validateCandidate({
      dir: site,
      endpoint: 'https://thriv3-profiles.pages.dev/api/track',
      ledger: { slugs: [...pagesIn(site).map((f) => f.replace('.html', '')), 'vanishedone'] },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(' ')).toMatch(/was in the last deployment/);
  });
});

describe('failure leaves the previous state alone', () => {
  it('does not deploy when generation itself fails', async () => {
    makePublicAthlete();
    const calls = [];
    await expect(publishSite({
      outputDir: site,
      workerBundle: path.join(tmp, 'absent-worker.js'),
      env: readyEnv({ THRIV3_WORKER_BUNDLE: path.join(tmp, 'absent-worker.js') }),
      exec: deployTo(calls),
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('leaves the live directory untouched when the candidate is refused', async () => {
    const { athlete } = makePublicAthlete();
    await publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: okDeploy });
    const before = pagesIn(site);
    expect(before).toHaveLength(1);

    Player.update(athlete.id, { email: '' });
    await expect(publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: okDeploy }))
      .rejects.toThrow();

    expect(pagesIn(site)).toEqual(before);
    expect(fs.existsSync(stagingDirFor(site))).toBe(false);
  });

  it('does not mark anyone published when the deploy command fails', async () => {
    const athlete = makeAthlete();
    const failing = async () => {
      const err = new Error('wrangler exited 1');
      err.stdout = '';
      err.stderr = 'Authentication error';
      throw err;
    };

    await expect(publish(athlete.id, null, { deploy: () => failing() })).rejects.toThrow();
    expect(Player.get(athlete.id).published_at).toBeFalsy();
  });

  it('reports that the previous site is still serving when a deploy fails', async () => {
    makePublicAthlete();
    const failing = async () => { const e = new Error('boom'); e.stderr = 'upload interrupted'; throw e; };
    await expect(publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: failing }))
      .rejects.toThrow(/previous public site is still serving/);
    expect(fs.existsSync(stagingDirFor(site))).toBe(false);
  });
});

describe('publishing one athlete does not disturb another', () => {
  it('keeps athlete A on the site when athlete B is published', async () => {
    const { athlete: a } = makePublicAthlete();
    const b = makeAthlete();

    await publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: okDeploy });

    expect(pagesIn(site)).toContain(`${a.public_slug}.html`);
    expect(pagesIn(site)).toContain(`${b.public_slug}.html`);
  });

  it('keeps athlete A on the site when athlete B is archived', async () => {
    const { athlete: a } = makePublicAthlete();
    const { athlete: b } = makePublicAthlete();
    await publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: okDeploy });

    deactivateAthlete(b.id);
    await publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: okDeploy });

    expect(pagesIn(site)).toContain(`${a.public_slug}.html`);
    expect(pagesIn(site)).not.toContain(`${b.public_slug}.html`);
  });

  it('does not let a partially populated directory contribute pages to the deploy', async () => {
    const { athlete } = makePublicAthlete();
    fs.mkdirSync(path.join(site, 'p'), { recursive: true });
    fs.writeFileSync(path.join(site, 'p', 'leftoverone.html'), '<html>stale</html>');

    await publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: okDeploy });

    expect(pagesIn(site)).toEqual([`${athlete.public_slug}.html`]);
  });
});

describe('identity survives republishing', () => {
  it('keeps the slug when the profile content changes', async () => {
    const { athlete } = makePublicAthlete();
    await publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: okDeploy });

    Player.update(athlete.id, { position: 'Centre Back', evaluation: 'Rewritten scouting note' });
    await publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: okDeploy });

    expect(Player.get(athlete.id).public_slug).toBe(athlete.public_slug);
    expect(pagesIn(site)).toEqual([`${athlete.public_slug}.html`]);
    expect(fs.readFileSync(path.join(site, 'p', `${athlete.public_slug}.html`), 'utf-8'))
      .toContain('Centre Back');
  });

  it('keeps an already-issued outreach token valid across deployments', async () => {
    const { athlete, outreach } = makePublicAthlete();
    await publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: okDeploy });

    Player.update(athlete.id, { evaluation: 'Updated' });
    await publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: okDeploy });

    const row = db.prepare('SELECT token, revoked_at FROM outreach WHERE id = ?').get(outreach.id);
    expect(row.token).toBe(outreach.token);
    expect(row.revoked_at).toBeNull();
  });

  it('records what was deployed, so the next publish can be checked against it', async () => {
    const { athlete } = makePublicAthlete();
    await publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: okDeploy });

    const ledger = readLedger(site);
    expect(ledger.slugs).toEqual([athlete.public_slug]);
    // Beside the site, never inside it: the ledger must not be published.
    expect(ledgerPath(site).startsWith(`${site}${path.sep}`)).toBe(false);
    expect(pagesIn(site)).not.toContain(path.basename(ledgerPath(site)));
  });

  it('treats a missing ledger as no information rather than as a failure', async () => {
    makePublicAthlete();
    fs.rmSync(ledgerPath(site), { force: true });
    await expect(publishSite({ outputDir: site, workerBundle: bundle, env: readyEnv(), exec: okDeploy }))
      .resolves.toBeTruthy();
    expect(writeLedger).toBeTypeOf('function');
  });
});
