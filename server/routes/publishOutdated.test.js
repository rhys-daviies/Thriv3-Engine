/**
 * THE LIVE PAGE BEHIND THE RECORD — Phase 5 (#8).
 *
 * The coach-facing page is a snapshot written at publish. A representative
 * edited, or reassigned, afterwards is not what coaches see until the page is
 * published again; the Profile tab now says so. Publishing itself never makes
 * the page read as out of date.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { utcNow } from '../lib/time.js';

const { publishStatus, publish, liveOutdated } = await import('./publish.js');
const { Player } = await import('../db/entities/player.js');
const { Representative } = await import('../db/entities/representative.js');
const db = (await import('../db/client.js')).default;

const req = { protocol: 'https', get: () => 'operator.example.test' };
const deploy = async () => ({ written: [], skipped: [], deploymentUrl: 'https://x.pages.dev' });
const later = (iso, ms = 60_000) => new Date(Date.parse(iso) + ms).toISOString();

function athlete(extra = {}) {
  return Player.create({
    full_name: 'Nikau Brennan', position: 'W', graduation_year: 2027, email: 'athlete@example.test',
    highlights_url: 'https://youtu.be/aqz-KE-bpKQ', sport: 'mens-soccer', ...extra,
  });
}

beforeEach(() => {
  db.exec('DELETE FROM tracking_events; DELETE FROM outreach; UPDATE players SET representative_id = NULL; DELETE FROM players; DELETE FROM representatives;');
});

describe('whether the live page is behind the record', () => {
  it('never published: nothing to be behind', () => {
    expect(publishStatus(athlete().id, req).liveOutdated).toBeNull();
  });

  it('just published: not out of date, even though publishing wrote to the record', async () => {
    const a = athlete();
    const out = await publish(a.id, req, { deploy });
    expect(out.liveOutdated).toBeNull();
    const row = Player.get(a.id);
    expect(row.published_at).toBe(row.updated_date);
  });

  it('a profile saved after publishing (e.g. a new representative): may be out of date', async () => {
    const rep = Representative.create({ full_name: 'Alex Morgan', email: 'alex@example.test' });
    const a = athlete();
    await publish(a.id, req, { deploy });
    const published = Player.get(a.id).published_at;
    Player.update(a.id, { representative_id: rep.id });
    db.prepare('UPDATE players SET updated_date = ? WHERE id = ?').run(later(published), a.id);
    expect(publishStatus(a.id, req).liveOutdated).toEqual({ reasons: ['PROFILE_CHANGED'], since: published });
  });

  it('the assigned representative\'s own details edited after publishing: exactly that', async () => {
    const rep = Representative.create({ full_name: 'Alex Morgan', email: 'alex@example.test', phone: '+1 415 555 0134' });
    const a = athlete({ representative_id: rep.id });
    await publish(a.id, req, { deploy });
    const published = Player.get(a.id).published_at;
    Representative.update(rep.id, { phone: '+1 415 555 0199' });
    db.prepare('UPDATE representatives SET updated_date = ? WHERE id = ?').run(later(published), rep.id);
    expect(publishStatus(a.id, req).liveOutdated.reasons).toEqual(['REPRESENTATIVE_EDITED']);
  });

  it('republishing clears it', async () => {
    const a = athlete();
    await publish(a.id, req, { deploy });
    db.prepare('UPDATE players SET updated_date = ? WHERE id = ?').run(later(Player.get(a.id).published_at), a.id);
    expect(publishStatus(a.id, req).liveOutdated).not.toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    const again = await publish(a.id, req, { deploy });
    expect(again.liveOutdated).toBeNull();
  });

  it('is computed from stored timestamps only and writes nothing', () => {
    const a = athlete();
    db.prepare('UPDATE players SET published_at = ?, updated_date = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', utcNow(), a.id);
    const before = db.prepare('SELECT total_changes() n').get().n;
    expect(liveOutdated(Player.get(a.id)).reasons).toEqual(['PROFILE_CHANGED']);
    expect(db.prepare('SELECT total_changes() n').get().n).toBe(before);
  });
});
