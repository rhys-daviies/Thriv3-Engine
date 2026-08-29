import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

// An in-memory database, set before db/client.js is imported anywhere.
process.env.RECRUITMATCH_DB = ':memory:';

const db = (await import('../db/client.js')).default;
const { logEvidence, evidenceForOutreach, evidencePerformance, structurePerformance } =
  await import('./evidenceLog.js');
const { selectEvidence } = await import('../../shared/evidence/index.js');

const athleteId = randomUUID();

function seed() {
  db.exec('DELETE FROM outreach_evidence; DELETE FROM engagement_rollup; DELETE FROM outreach; DELETE FROM coaches;');
  db.prepare(`INSERT OR REPLACE INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, '2026-01-01', '2026-01-01', 'Rhys Davies', 'Defender', 'mens-soccer')`).run(athleteId);
}

/**
 * One outreach, with a coach of its own.
 *
 * A fresh coach per row rather than a shared one: `outreach` is UNIQUE on
 * (athlete_id, coach_id) precisely so an athlete cannot be written to the same
 * person twice, and reusing one coach here would collide on the second call
 * rather than testing anything.
 */
function outreachRow({ sent = true } = {}) {
  const id = randomUUID();
  const coachId = randomUUID();
  db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, sport)
    VALUES (?, '2026-01-01', 'A Coach', ?, 'Example University', 'mens-soccer')`)
    .run(coachId, `coach-${coachId}@example.edu`);
  db.prepare(`INSERT INTO outreach (id, athlete_id, coach_id, token, sent_at, created_at)
    VALUES (?, ?, ?, ?, ?, '2026-01-01')`)
    .run(id, athleteId, coachId, randomUUID(), sent ? '2026-01-02' : null);
  return id;
}

const nzAthlete = {
  full_name: 'Rhys Davies', position: 'Defender',
  nationality: 'New Zealand', recruiting_class_year: 2027, sport: 'mens-soccer',
};

const nzEvidence = () => selectEvidence(nzAthlete, {
  college: { name: 'Example University', sport: 'mens-soccer' },
  history: [{
    college_name: 'Example University', season: '2023', player_name: 'Kiwi One',
    position: 'D', country: 'New Zealand',
  }],
});

beforeEach(seed);

describe('evidence logging', () => {
  it('records the leading evidence and the structure that carried it', () => {
    const id = outreachRow();

    logEvidence({
      outreachId: id, athleteId, collegeName: 'Example University',
      sport: 'mens-soccer', evidence: nzEvidence(),
    });

    const row = evidenceForOutreach(id);
    expect(row.primary_kind).toBe('HISTORICAL_SAME_COUNTRY');
    expect(row.primary_tier).toBe('FACT');
    expect(row.structure).toBe('RELATIONSHIP_FIRST');
    expect(row.athlete_position).toBe('DEFENSE');
    expect(row.class_year).toBe(2027);
  });

  it('keeps what was suppressed and rejected, not only what was used', () => {
    const id = outreachRow();
    logEvidence({ outreachId: id, athleteId, evidence: nzEvidence() });

    const { payload } = evidenceForOutreach(id);
    expect(payload).toHaveProperty('suppressed');
    expect(payload).toHaveProperty('rejected');
    expect(payload.ranked.length).toBeGreaterThan(0);
  });

  it('separates "no roster on file" from "roster with nothing to say"', () => {
    const noData = outreachRow();
    logEvidence({
      outreachId: noData, athleteId,
      evidence: selectEvidence(nzAthlete, { college: { name: 'Nowhere', sport: 'mens-soccer' } }),
    });
    expect(evidenceForOutreach(noData).had_roster).toBe(0);

    const withData = outreachRow();
    logEvidence({
      outreachId: withData, athleteId,
      evidence: selectEvidence(nzAthlete, {
        college: { name: 'Somewhere', sport: 'mens-soccer' },
        squad: [{ player_name: 'X', position: 'M', season: '2026', country: '' }],
      }),
    });
    expect(evidenceForOutreach(withData).had_roster).toBe(1);
  });

  it('upserts rather than failing when the same pair is drafted twice', () => {
    const id = outreachRow();
    logEvidence({ outreachId: id, athleteId, evidence: nzEvidence() });
    const first = evidenceForOutreach(id).created_at;

    expect(() => logEvidence({ outreachId: id, athleteId, evidence: nzEvidence() })).not.toThrow();
    // The date of the first approach is what an engagement window is measured
    // from, so a redraft must not move it.
    expect(evidenceForOutreach(id).created_at).toBe(first);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach_evidence').get().n).toBe(1);
  });

  it('never throws when logging fails — a send must not depend on the log', () => {
    // No such outreach row, so the foreign key rejects it.
    expect(() => logEvidence({
      outreachId: 'does-not-exist', athleteId, evidence: nzEvidence(),
    })).not.toThrow();
  });

  it('does nothing when no evidence was supplied', () => {
    const id = outreachRow();
    expect(logEvidence({ outreachId: id, athleteId, evidence: null })).toBeNull();
  });
});

describe('measuring which evidence works', () => {
  it('groups sends by leading evidence and joins outcomes from the rollup', () => {
    const replied = outreachRow();
    const silent = outreachRow();

    for (const id of [replied, silent]) {
      logEvidence({ outreachId: id, athleteId, sport: 'mens-soccer', evidence: nzEvidence() });
    }
    db.prepare(`INSERT INTO engagement_rollup (outreach_id, qualified_visits, responded_at, engagement_score)
      VALUES (?, 3, '2026-01-05', 70)`).run(replied);

    const [row] = evidencePerformance({ sport: 'mens-soccer' });
    expect(row.primary_kind).toBe('HISTORICAL_SAME_COUNTRY');
    expect(row.sends).toBe(2);
    expect(row.replies).toBe(1);
    expect(row.reply_rate).toBe(0.5);
  });

  it('counts an unengaged send as a result, not as missing data', () => {
    const id = outreachRow();
    logEvidence({ outreachId: id, athleteId, sport: 'mens-soccer', evidence: nzEvidence() });

    const [row] = evidencePerformance({ sport: 'mens-soccer' });
    expect(row.sends).toBe(1);
    expect(row.replies).toBe(0);
    expect(row.reply_rate).toBe(0);
  });

  it('ignores outreach that was never sent', () => {
    const draft = outreachRow({ sent: false });
    logEvidence({ outreachId: draft, athleteId, sport: 'mens-soccer', evidence: nzEvidence() });
    expect(evidencePerformance({ sport: 'mens-soccer' })).toHaveLength(0);
  });

  it('answers the same question of structures', () => {
    const id = outreachRow();
    logEvidence({ outreachId: id, athleteId, sport: 'mens-soccer', evidence: nzEvidence() });

    const [row] = structurePerformance({ sport: 'mens-soccer' });
    expect(row.structure).toBe('RELATIONSHIP_FIRST');
    expect(row.sends).toBe(1);
  });
});
