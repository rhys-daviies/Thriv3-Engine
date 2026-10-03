/**
 * =============================================================================
 * V1 STILL WORKS, WITH NO V2 ANYTHING — A9.7 §W.
 *
 * The hard requirement of the phase, and the one that makes the whole rollout
 * reversible. An athlete who has never been matched by V2 - no run, no
 * selection, no observation - must be able to go through the entire original
 * workflow, and nothing A9.1-A9.7 added may be on the required path.
 *
 * This is deliberately an INDEPENDENT walk rather than an assertion that
 * nothing changed. "We did not break it" is a claim about a diff; this is a
 * claim about behaviour.
 * =============================================================================
 */
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import { createCampaign, listProgrammeCampaigns, MATCHING_MODEL_SIX_CRITERION } from '../campaigns.js';
import { createOutreach } from '../outreach.js';
import { recordDraft, acceptSend } from '../outreachSend.js';
import { sendProvenance, PROVENANCE_CLASS } from './outreachProvenance.js';
import { matchmakingVersion, MATCHING_V1, MATCHING_V2 } from '../../../src/lib/matchmakingVersion.js';

const UPLOADS_DIR = process.env.THRIV3_UPLOADS_DIR;
const written = [];
const made = [];
let athleteId;
let coachId;

const rec = (n) => ({
  id: `col-${n}`,
  name: `V1 School ${n}`,
  division: 'NCAA D1',
  conference: 'Big East',
  match_score: 100 - n,
  breakdown: [
    { key: 'athletic', label: 'Athletic fit', weight: 0.35, score: 0.9 },
    { key: 'roster', label: 'Roster opportunity', weight: 0.1, score: 0.5 },
    { key: 'academic', label: 'Academic fit', weight: 0.1, score: 0.5 },
    { key: 'affordability', label: 'Affordability', weight: 0.1, score: 0.5 },
    { key: 'programQuality', label: 'Program quality', weight: 0.15, score: 0.6 },
    { key: 'geography', label: 'Location', weight: 0.2, score: 0.7 },
  ],
  labels: { athletic: 'target', roster: 'high' },
  confidence: 'measured',
  coaching_staff: [{ name: 'A Coach', email: 'coach@example.edu' }],
});

beforeAll(() => {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const row = Player.create({
    full_name: 'A9.7 V1-only Athlete',
    sport: 'mens-soccer',
    position: 'Midfielder',
    recruiting_class_year: 2028,
  });
  athleteId = row.id;
  made.push(row.id);

  const name = `${randomUUID()}-recommendations.json`;
  const file = path.join(UPLOADS_DIR, name);
  fs.writeFileSync(file, JSON.stringify({
    recommendations: Array.from({ length: 12 }, (_, i) => rec(i + 1)),
    summary: 'Ranked 1166 eligible programs on six weighted criteria.',
  }));
  written.push(file);
  db.prepare('UPDATE players SET recommendations = ? WHERE id = ?').run(`/uploads/${name}`, athleteId);

  coachId = randomUUID();
  db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, sport)
              VALUES (?, ?, 'V1 Coach', 'v1coach@example.test', 'V1 School 1', 'mens-soccer')`)
    .run(coachId, new Date().toISOString());
});

afterAll(() => {
  db.prepare(`DELETE FROM outreach_send WHERE athlete_id = ?`).run(athleteId);
  db.prepare('DELETE FROM outreach WHERE athlete_id = ?').run(athleteId);
  db.prepare(`DELETE FROM programme_campaigns WHERE campaign_id IN
              (SELECT id FROM campaigns WHERE athlete_id = ?)`).run(athleteId);
  db.prepare('DELETE FROM campaigns WHERE athlete_id = ?').run(athleteId);
  db.prepare('DELETE FROM coaches WHERE id = ?').run(coachId);
  for (const id of made) db.prepare('DELETE FROM players WHERE id = ?').run(id);
  for (const f of written) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
});

describe('A9.7 §W. the V1 workflow, end to end, with no V2 data at all', () => {
  it('W1. the athlete has no run, no selection and no observation', () => {
    expect(db.prepare('SELECT COUNT(*) n FROM matchmaking_runs WHERE player_id = ?')
      .get(athleteId).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM matchmaking_selections WHERE player_id = ?')
      .get(athleteId).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM recruiting_observations WHERE athlete_id = ?')
      .get(athleteId).n).toBe(0);
  });

  it('W2. V1 campaign creation reads the stored analysis file and freezes it', () => {
    const { campaign, programmes } = createCampaign(athleteId, { label: 'V1 rollback' });
    expect(campaign.state).toBe('draft');
    expect(programmes).toHaveLength(12);
    expect(programmes[0].college_name).toBe('V1 School 1');
    expect(programmes[0].rank).toBe(1);

    // It is a V1 campaign by every marker, and names no run.
    expect(campaign.source_analysis_ref).toMatch(/^\/uploads\//);
    expect(campaign.source_analysis_ref).not.toMatch(/matchmaking_run/);
    const inputs = JSON.parse(campaign.matching_inputs);
    expect(inputs.model.id).toBe(MATCHING_MODEL_SIX_CRITERION);

    // And every target carries NULL provenance, truthfully.
    for (const p of listProgrammeCampaigns(campaign.id)) {
      expect(p.matchmaking_selection_id).toBeNull();
    }
  });

  it('W3. outreach is created and sent through the original path', () => {
    const outreach = createOutreach({ athleteId, coachId, matchId: 'V1 School 1' });
    const { id: sendId } = recordDraft({
      outreachId: outreach.id,
      athleteId,
      coachId,
      collegeName: 'V1 School 1',
      sport: 'mens-soccer',
      evidence: null,
      subject: 'V1 subject',
      body: 'V1 body',
    });
    acceptSend(sendId);

    const row = db.prepare('SELECT * FROM outreach_send WHERE id = ?').get(sendId);
    expect(row.state).toBe('ACCEPTED');
    expect(row.matchmaking_selection_id).toBeNull();
    expect(sendProvenance(db, sendId).provenance).toBe(PROVENANCE_CLASS.PRE_PROVENANCE);
    // `match_id` is V1's programme hint, still written exactly as before.
    expect(db.prepare('SELECT match_id FROM outreach WHERE id = ?').get(outreach.id).match_id)
      .toBe('V1 School 1');
  });

  it('W4. the UI switch returns to V1 without a deploy, and is not sticky', () => {
    const q = (s) => new URLSearchParams(s);
    expect(matchmakingVersion(q('matching=v1'), {})).toBe(MATCHING_V1);
    expect(matchmakingVersion(q(''), { VITE_MATCHMAKING_ENGINE: 'v1' })).toBe(MATCHING_V1);
    // A query parameter overrides a build pinned the other way, in both directions.
    expect(matchmakingVersion(q('matching=v2'), { VITE_MATCHMAKING_ENGINE: 'v1' })).toBe(MATCHING_V2);
    expect(matchmakingVersion(q('matching=v1'), { VITE_MATCHMAKING_ENGINE: 'v2' })).toBe(MATCHING_V1);
    // And an unrecognised value falls through rather than showing nothing.
    expect(matchmakingVersion(q('matching=two'), {})).toBe(MATCHING_V2);
  });

  it('W5. nothing V2 is on the required path — the V1 route is a different handler', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'server/routes/campaigns.js'), 'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // Two distinct creation routes; the V1 one does not mention the V2 service.
    const v1 = code.indexOf("campaignsRouter.post('/players/:playerId/campaigns'");
    const v2 = code.indexOf("campaignsRouter.post('/players/:playerId/campaigns/from-matchmaking'");
    expect(v1).toBeGreaterThan(-1);
    expect(v2).toBeGreaterThan(-1);
    expect(v1).not.toBe(v2);
    const v1Handler = code.slice(v1, code.indexOf('}));', v1));
    expect(v1Handler).toContain('createCampaign(');
    expect(v1Handler).not.toContain('createCampaignFromRun');
  });
});
