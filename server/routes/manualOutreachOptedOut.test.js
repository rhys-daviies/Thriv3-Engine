/**
 * A COACH WHO OPTS OUT WHILE THE COMPOSER IS OPEN — Phase 5 follow-up (B).
 *
 * The offer withholds opted-out coaches, so a dialog opened before the opt-out
 * can still name one. The send is still refused, and nothing is drafted, but
 * it is refused as an opt-out, never as "Not on this programme's staff".
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';

const composeInOutlook = vi.fn(async () => ({ ok: true, sent: false }));
vi.mock('../lib/outlook.js', () => ({ isOutlookAvailable: () => true, composeInOutlook }));

// Coaches seeded without the verified-address floor, as manualOutreach.test.js does.
process.env.THRIV3_ALLOW_LEGACY_COACHES = '1';

const db = (await import('../db/client.js')).default;
const { manualOutreachRouter } = await import('./manualOutreach.js');
const { upsertAthleteProgramme } = await import('../lib/athleteProgrammes.js');
const { suppress } = await import('../lib/suppressions.js');

const ATHLETE = 'a-optout';
const T = '2026-09-11T00:00:00.000Z';
let baseUrl; let url; let coaches;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', manualOutreachRouter);
  baseUrl = await new Promise((r) => { const s = app.listen(0, () => r(`http://127.0.0.1:${s.address().port}`)); s.unref(); });
});

beforeEach(() => {
  composeInOutlook.mockClear();
  db.exec(`DELETE FROM outreach_send; DELETE FROM outreach; DELETE FROM coaches; DELETE FROM athlete_programmes;
           DELETE FROM suppressions; DELETE FROM colleges; DELETE FROM players;`);
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport, recruiting_class_year, email, video_id, video_chapters, public_slug)
    VALUES (?, ?, ?, 'Opt Athlete', 'MIDFIELD', 'mens-soccer', 2027, 'opt@example.test', 'aqz-KE-bpKQ', ?, 'opt-ath')`)
    .run(ATHLETE, T, T, JSON.stringify([{ t: 10, label: 'Opening' }, { t: 60, label: 'Middle' }, { t: 120, label: 'Late' }]));
  db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, active)
    VALUES ('col-opt', ?, ?, 'Optout U', 'mens-soccer', 'NCAA D1', 'ACC', 1)`).run(T, T);
  coaches = ['Ann Allowed', 'Oscar Optedout'].map((name, i) => {
    db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status)
      VALUES (?, ?, ?, ?, 'Optout U', 'NCAA D1', 'mens-soccer', 'Head Coach', 'verified')`).run(`co-opt-${i}`, T, name, `c${i}@optout.test`);
    return `co-opt-${i}`;
  });
  const rel = upsertAthleteProgramme(ATHLETE, { college_id: 'col-opt' }).programme;
  url = `/api/players/${ATHLETE}/programmes/${rel.id}/outreach`;
});

const post = async (body) => {
  const res = await fetch(`${baseUrl}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const drafts = () => db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n;

describe('opted out after the composer opened', () => {
  it('names the opt-out, not staff membership; nothing is drafted', async () => {
    const offered = await (await fetch(`${baseUrl}${url}`)).json();
    expect(offered.coaches.map((c) => c.coach_id)).toContain(coaches[1]);   // the dialog's list

    suppress({ email: 'c1@optout.test', reason: 'unsubscribed', source: 'manual' });
    const r = await post({ coachIds: [coaches[1]], subject: 's', body: 'Hi Coach,\n\nb' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('COACH_OPTED_OUT');
    expect(r.body.error).toContain('Oscar Optedout has opted out');
    expect(r.body.error).not.toMatch(/staff/i);
    expect(r.body.optedOut).toEqual([{ coach_id: coaches[1], name: 'Oscar Optedout' }]);
    expect(r.body.error).not.toContain('c1@optout.test');   // never the address
    expect(drafts()).toBe(0);
    expect(composeInOutlook).not.toHaveBeenCalled();
  });

  it('not weakened: with an allowed coach alongside, the whole request is still refused', async () => {
    suppress({ email: 'c1@optout.test', reason: 'unsubscribed', source: 'manual' });
    const r = await post({ coachIds: coaches, subject: 's', body: 'Hi Coach,\n\nb' });
    expect(r).toMatchObject({ status: 422, body: { code: 'COACH_OPTED_OUT' } });
    expect(drafts()).toBe(0);
    expect(composeInOutlook).not.toHaveBeenCalled();
  });

  it('a coach genuinely not at the programme is still "not on this programme\'s staff"', async () => {
    const r = await post({ coachIds: ['co-nowhere'], subject: 's', body: 'Hi Coach,\n\nb' });
    expect(r).toMatchObject({ status: 422, body: { code: 'COACH_NOT_AT_PROGRAMME' } });
  });

  it('with no opt-out, the route passes both on to the send boundary (which keeps its own floor)', async () => {
    const r = await post({ coachIds: coaches, subject: 's', body: 'Hi Coach,\n\nb' });
    expect(r.status).toBe(200);
    expect(r.body.results).toHaveLength(2);
  });
});
