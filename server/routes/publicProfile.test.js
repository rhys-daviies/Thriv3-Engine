import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { utcNow } from '../lib/time.js';
import { findOrCreateCoach } from '../lib/coaches.js';
import { createOutreach } from '../lib/outreach.js';
import { deactivateAthlete } from '../lib/athleteLifecycle.js';
import { OUTPUT_DIR } from '../export/exportProfiles.js';
import { publicProfileHandler } from './publicProfile.js';

let baseUrl;
const SLUG = 'aBcD1234ef';
const PAGE_MARKER = '<h1>Nikau<br>Brennan</h1>';

beforeAll(async () => {
  // Stand in a real generated-looking file at the path the handler reads.
  fs.mkdirSync(path.join(OUTPUT_DIR, 'p'), { recursive: true });
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'p', `${SLUG}.html`),
    `<!DOCTYPE html><html><body>${PAGE_MARKER}</body></html>`
  );

  const app = express();
  app.get('/p/:slug', publicProfileHandler);
  await new Promise((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.unref();
  });
});

function makeAthlete(slug = SLUG) {
  const id = randomUUID();
  const ts = utcNow();
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, public_slug)
    VALUES (?, ?, ?, 'Nikau Brennan', 'Left Winger', ?)
  `).run(id, ts, ts, slug);
  return id;
}

function addOutreach(athleteId) {
  const coach = findOrCreateCoach({
    full_name: 'A. Whitfield', email: `${randomUUID()}@example.edu`, school: 'Butler', sport: 'mens-soccer',
  });
  return createOutreach({ athleteId, coachId: coach.id });
}

const get = (url) => fetch(`${baseUrl}${url}`);
const isProfile = async (res) => (await res.text()).includes(PAGE_MARKER);
const isNeutral = async (res) => (await res.text()).includes('This profile is no longer shared');

beforeEach(() => {
  db.exec('DELETE FROM tracking_events; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches;');
});

describe('serving a live link', () => {
  it('serves the profile for a valid token', async () => {
    const athleteId = makeAthlete();
    const { token } = addOutreach(athleteId);

    const res = await get(`/p/${SLUG}.html?ref=${token}`);
    expect(res.status).toBe(200);
    expect(await isProfile(res)).toBe(true);
  });

  it('serves the profile when no token is supplied — the slug is itself the credential', async () => {
    makeAthlete();
    expect(await isProfile(await get(`/p/${SLUG}.html`))).toBe(true);
  });
});

describe('revoked and unknown links get the neutral page', () => {
  it('renders the neutral page for a revoked token, not the profile and not a 404', async () => {
    const athleteId = makeAthlete();
    const { token } = addOutreach(athleteId);
    deactivateAthlete(athleteId);

    const res = await get(`/p/${SLUG}.html?ref=${token}`);
    expect(res.status).toBe(200);
    expect(await isNeutral(res)).toBe(true);
  });

  it('renders the neutral page for a deactivated athlete even without a token', async () => {
    const athleteId = makeAthlete();
    deactivateAthlete(athleteId);
    expect(await isNeutral(await get(`/p/${SLUG}.html`))).toBe(true);
  });

  it('renders the neutral page for an unknown token', async () => {
    makeAthlete();
    expect(await isNeutral(await get(`/p/${SLUG}.html?ref=${'z'.repeat(32)}`))).toBe(true);
  });

  it("renders the neutral page for another athlete's valid token", async () => {
    makeAthlete();
    const otherId = makeAthlete('zZzZ999999');
    const { token } = addOutreach(otherId);

    expect(await isNeutral(await get(`/p/${SLUG}.html?ref=${token}`))).toBe(true);
  });

  it('renders the neutral page for an unknown slug', async () => {
    expect(await isNeutral(await get('/p/doesNotEx1.html'))).toBe(true);
  });

  it('renders the neutral page when the file was never generated', async () => {
    makeAthlete('notExpo1ed');
    expect(await isNeutral(await get('/p/notExpo1ed.html'))).toBe(true);
  });

  it('reveals nothing about the athlete on the neutral page', async () => {
    const athleteId = makeAthlete();
    deactivateAthlete(athleteId);

    const body = await (await get(`/p/${SLUG}.html`)).text();
    expect(body).not.toContain('Nikau');
    expect(body).not.toContain('Brennan');
    expect(body).not.toContain(SLUG);
  });

  it('answers every refusal identically, so responses cannot be used to probe slugs', async () => {
    const athleteId = makeAthlete();
    deactivateAthlete(athleteId);

    const [revoked, unknownSlug, badToken] = await Promise.all([
      get(`/p/${SLUG}.html`),
      get('/p/nothingHer.html'),
      get(`/p/${SLUG}.html?ref=${'q'.repeat(32)}`),
    ]);
    const bodies = await Promise.all([revoked.text(), unknownSlug.text(), badToken.text()]);

    expect(new Set([revoked.status, unknownSlug.status, badToken.status])).toEqual(new Set([200]));
    expect(new Set(bodies).size).toBe(1);
  });

  it('keeps the neutral page out of search indexes', async () => {
    const body = await (await get('/p/nothingHer.html')).text();
    expect(body).toContain('<meta name="robots" content="noindex, nofollow">');
  });
});

describe('reactivation', () => {
  it('serves the profile again once the athlete is restored', async () => {
    const athleteId = makeAthlete();
    const { token } = addOutreach(athleteId);

    deactivateAthlete(athleteId);
    expect(await isNeutral(await get(`/p/${SLUG}.html?ref=${token}`))).toBe(true);

    const { reactivateAthlete } = await import('../lib/athleteLifecycle.js');
    reactivateAthlete(athleteId);
    expect(await isProfile(await get(`/p/${SLUG}.html?ref=${token}`))).toBe(true);
  });
});
