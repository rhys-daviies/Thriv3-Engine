/**
 * PHASE 5 FINAL AUDIT — one athlete, end to end, on isolated data.
 *
 * Player → Match → Programme → Contact → Manual Outreach → Engagement → Reports.
 *
 * vitest's in-memory database (the DB guard refuses the working file), the real
 * V2 engine over the synthetic pool, the real manual-outreach routes, and Outlook
 * mocked: nothing leaves the machine.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import express from 'express';

const composeInOutlook = vi.fn(async () => ({ ok: true, sent: false }));
vi.mock('./lib/outlook.js', () => ({ isOutlookAvailable: () => true, composeInOutlook }));

const db = (await import('./db/client.js')).default;
const { Player } = await import('./db/entities/player.js');
const { seedPool } = await import('./lib/v2/seedTestPool.js');
const { computeMatchmakingV2, clearContextCache, STATUS } = await import('./lib/v2/matchmakingService.js');
const { clearCorpusDigestCache } = await import('./lib/v2/corpusIdentity.js');
const { persistRun, currentRun, runStaleness } = await import('./lib/v2/matchmakingRuns.js');
const { recordSelection, SELECTION_SOURCE } = await import('./lib/v2/matchmakingSelection.js');
const { selectionsOverview } = await import('./lib/v2/selectionsOverview.js');
const { programmeDetail } = await import('./lib/programmeDatabase.js');
const { upsertAthleteProgramme, updateAthleteProgramme } = await import('./lib/athleteProgrammes.js');
const { manualOutreachRouter } = await import('./routes/manualOutreach.js');
const { programmeCoachesRouter } = await import('./routes/programmeCoaches.js');
const { suppress, isSuppressed } = await import('./lib/suppressions.js');
const { recordOptOut, optOutStatus } = await import('./lib/optOut.js');
const { recordResponded } = await import('./lib/engagementRollup.js');
const { athleteEngagement } = await import('./lib/engagementQueries.js');
const { liveOutdated } = await import('./routes/publish.js');
const { corroborateFixtureCoaches } = await import('./testCanonicalCoaches.js');
const { outreachProgress, OUTREACH_PROGRESS } = await import('../src/lib/outreachOutcomeView.js');
const { programmeHref } = await import('../src/components/matchmaking/MatchmakingResultCard.jsx');

const T = new Date().toISOString();
const j = {};
let baseUrl;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};
const sendIdFor = (coachId) => db.prepare(`SELECT s.id, s.outreach_id, s.state FROM outreach_send s JOIN outreach o ON o.id = s.outreach_id
  WHERE o.athlete_id = ? AND o.coach_id = ? ORDER BY s.rowid DESC`).get(j.player.id, coachId);

beforeAll(async () => {
  seedPool('mens-soccer', { count: 160 });
  clearContextCache(); clearCorpusDigestCache();
  const app = express();
  app.use(express.json());
  app.use('/api', programmeCoachesRouter);
  app.use('/api', manualOutreachRouter);
  baseUrl = await new Promise((r) => { const s = app.listen(0, () => r(`http://127.0.0.1:${s.address().port}`)); s.unref(); });
});

describe('Phase 5 final audit: the existing manual workflow, end to end', () => {
  it('1. Player: a complete profile is created', () => {
    const row = Player.create({
      full_name: 'Audit Athlete', sport: 'mens-soccer', position: 'CB', football_ability: 6,
      recruiting_class_year: 2028, state: 'CA', origin: 'USA',
      contribution_state: 'STATED', max_annual_contribution_usd: 25000, preferred_divisions: ['NCAA D1', 'NCAA D2'],
      email: 'athlete@example.test', video_id: 'aqz-KE-bpKQ', public_slug: 'audit-ath',
      video_chapters: JSON.stringify([{ t: 10, label: 'Opening' }, { t: 60, label: 'Middle' }, { t: 120, label: 'Late' }]),
    });
    j.player = Player.get(row.id);
    expect(j.player.id).toBeTruthy();
  });

  it('2. Match: a V2 run is computed and persisted; a representative-only edit keeps it current', () => {
    const result = computeMatchmakingV2(db, j.player);
    persistRun(db, j.player, result);
    j.run = currentRun(db, j.player.id);
    j.top = result.programmes.find((p) => p.status === STATUS.RANKED);
    expect(j.top?.programmeId).toBeTruthy();
    db.prepare("INSERT INTO representatives (id, created_date, updated_date, full_name, email) VALUES ('rep-audit', ?, ?, 'Rhea Rep', 'rep@example.test')").run(T, T);
    Player.update(j.player.id, { representative_id: 'rep-audit' });
    expect(runStaleness(db, Player.get(j.player.id), j.run).current).toBe(true);
  });

  it('3. Programme: the card links to the programme page with the class year and the way back', () => {
    const href = programmeHref(j.top, 2028, j.player.id);
    expect(href).toBe(`/programmes/${encodeURIComponent(j.top.programmeId)}?classYear=2028&from=${j.player.id}`);
    const detail = programmeDetail(j.top.programmeId, { classYear: 2028 });
    expect(detail).toBeTruthy();
    expect(JSON.stringify(detail)).toContain(j.top.name);
    j.selection = recordSelection(db, Player.get(j.player.id), { collegeName: j.top.name, source: SELECTION_SOURCE.SPECIFIC_SEARCH });
    expect(j.selection.runWasStale).toBe(false);
  });

  it('4. Contact: verified staff are offered; a suppressed one is refused at draft time', async () => {
    const host = 'auditathletics.example';
    db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES ('AE-AUD', ?, 962001, 'SINGLE', 'test', ?)").run(j.top.name, T);
    db.prepare("UPDATE colleges SET unitid = 962001, athletics_entity_id = 'AE-AUD' WHERE id = ?").run(j.top.programmeId);
    db.prepare("INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES (?, 962001, 'VERIFIED', 'ATHLETICS_SITE', '[]', '[962001]', 'TEST', 'CERTAIN', ?)").run(host, T);
    j.coaches = ['Ava Head', 'Ben Assistant', 'Cal Suppressed'].map((name, i) => {
      const id = `co-aud-${i}`;
      db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, currentness_status)
        VALUES (?, ?, ?, ?, ?, ?, 'mens-soccer', 'Head Coach', 'verified', 'CURRENT')`).run(id, T, name, `c${i}@${host}`, j.top.name, j.top.division ?? 'NCAA D1');
      return id;
    });
    corroborateFixtureCoaches(db, { ids: j.coaches });
    j.rel = upsertAthleteProgramme(j.player.id, { college_id: j.top.programmeId }).programme;
    const composer = await api('GET', `/api/players/${j.player.id}/programmes/${j.rel.id}/outreach`);
    expect(composer.status).toBe(200);
    suppress({ email: `c2@${host}`, reason: 'manual', source: 'manual' });
    expect(isSuppressed(`c2@${host}`)).toBe(true);
  });

  it('5. Manual outreach: drafts only; send:true refused; suppressed recipient skipped; nothing sent', async () => {
    const url = `/api/players/${j.player.id}/programmes/${j.rel.id}/outreach`;
    const refused = await api('POST', url, { coachIds: [j.coaches[0]], subject: 's', body: 'Hi Coach,\n\nb', send: true });
    expect(refused).toMatchObject({ status: 422, body: { code: 'MANUAL_OUTREACH_DRAFT_ONLY' } });
    expect(composeInOutlook).not.toHaveBeenCalled();

    // The suppressed coach is withheld from the offer (and named as opted out) ...
    const offer = await api('GET', url);
    expect(JSON.stringify(offer.body)).toContain('Cal Suppressed');
    const sup = await api('POST', url, { coachIds: [j.coaches[2]], subject: 's', body: 'Hi Coach,\n\nb' });
    expect(sup).toMatchObject({ status: 422, body: { code: 'COACH_NOT_AT_PROGRAMME' } });
    // ... and the shared send boundary refuses it independently of the route.
    const { sendOutreach } = await import('./routes/sendOutreach.js');
    const direct = await sendOutreach({ athleteId: j.player.id, coaches: [{ name: 'Cal Suppressed', email: 'c2@auditathletics.example', title: 'Head Coach' }],
      subject: 's', body: 'Hi Coach,\n\nb', collegeName: j.top.name, division: j.top.division, send: false, programmeCampaignId: null }, { origin: 'manual' });
    expect(direct.results[0].status).toBe('suppressed');
    expect(composeInOutlook).not.toHaveBeenCalled();

    const r = await api('POST', url, { coachIds: j.coaches.slice(0, 2), subject: 'Audit Athlete', body: 'Hi Coach,\n\nAbout Audit Athlete.', greetingName: 'Coach' });
    expect(r.status).toBe(200);
    const byEmail = Object.fromEntries(r.body.results.map((x) => [x.email.split('@')[0], x.status]));
    expect(byEmail).toEqual({ c0: 'drafted', c1: 'drafted' });
    expect(composeInOutlook).toHaveBeenCalledTimes(2);
    for (const call of composeInOutlook.mock.calls) expect(JSON.stringify(call)).not.toMatch(/"send":true/);
    expect(sendIdFor(j.coaches[2])).toBeUndefined();
  });

  it('6. Draft vs confirmed: an opened draft never counts as sent; only the confirmed one does', async () => {
    const a = sendIdFor(j.coaches[0]); const b = sendIdFor(j.coaches[1]);
    expect(athleteEngagement(j.player.id).funnel).toMatchObject({ sent: 0, prepared: 2 });
    const c = await api('POST', `/api/players/${j.player.id}/programmes/${j.rel.id}/outreach/${b.id}/confirm-sent`);
    expect(c.status).toBe(200);
    const eng = athleteEngagement(j.player.id);
    expect(eng.funnel).toMatchObject({ sent: 1, prepared: 1 });
    const rows = Object.fromEntries(eng.coaches.map((x) => [x.coach_name, x]));
    expect(rows['Ava Head'].sent_at).toBeNull();
    expect(rows['Ben Assistant'].sent_at).toBeTruthy();
    j.a = a; j.b = b;
  });

  it('7. Engagement: a dated reply is recorded; future dates refused', () => {
    expect(() => recordResponded(j.b.outreach_id, { respondedAt: '2999-01-01' })).toThrow(/future/);
    recordResponded(j.b.outreach_id, { respondedAt: T.slice(0, 10) });
    const row = athleteEngagement(j.player.id).coaches.find((x) => x.coach_name === 'Ben Assistant');
    expect(row.responded_at.slice(0, 10)).toBe(T.slice(0, 10));
  });

  it('8. Suppression: an opt-out on the relationship blocks the next draft to that coach', async () => {
    recordOptOut(j.b.outreach_id, { reason: 'unsubscribed', note: 'asked to be removed' });
    expect(optOutStatus(j.b.outreach_id).optedOut).toBe(true);
    const r = await api('POST', `/api/players/${j.player.id}/programmes/${j.rel.id}/outreach`, { coachIds: [j.coaches[1]], subject: 's', body: 'Hi Coach,\n\nb' });
    expect(r).toMatchObject({ status: 422, body: { code: 'COACH_NOT_AT_PROGRAMME' } });
    updateAthleteProgramme(j.player.id, j.rel.id, { contact_stance: 'do_not_contact' });
    const dnc = await api('POST', `/api/players/${j.player.id}/programmes/${j.rel.id}/outreach`, { coachIds: [j.coaches[0]], subject: 's', body: 'b' });
    expect(dnc.status).toBe(422);
  });

  it('9. Reports: Engagement and the funnel agree; the selections report row is observed as-is', () => {
    const eng = athleteEngagement(j.player.id);
    expect(eng.funnel.sent).toBe(1);
    const sel = selectionsOverview(j.player.id).selections.find((s) => s.id === j.selection.id);
    j.selectionProgress = outreachProgress(sel);
    // KNOWN ISSUE (audit finding, fixed in the follow-up PR): manual drafts are not linked to the selection,
    // so this row cannot see the confirmed send or the reply recorded above.
    expect(j.selectionProgress).toBe(OUTREACH_PROGRESS.NOT_CONTACTED);
  });

  it('10. Published profile: up to date right after publishing; a later representative edit is flagged', () => {
    const pub = '2026-01-01T00:00:00.000Z';
    db.prepare("UPDATE representatives SET updated_date = '2025-12-01T00:00:00.000Z' WHERE id = 'rep-audit'").run();
    db.prepare('UPDATE players SET published_at = ?, updated_date = ? WHERE id = ?').run(pub, pub, j.player.id);
    expect(liveOutdated(Player.get(j.player.id))).toBeNull();
    db.prepare("UPDATE representatives SET updated_date = '2026-02-01T00:00:00.000Z' WHERE id = 'rep-audit'").run();
    expect(liveOutdated(Player.get(j.player.id)).reasons).toEqual(['REPRESENTATIVE_EDITED']);
  });
});
