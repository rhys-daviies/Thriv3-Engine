import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * TWO PROCESSES, ONE MESSAGE, ONE CLAIM — D4.5.
 *
 * The in-process tests prove the guard works; this proves it is the DATABASE
 * doing the guarding rather than anything JavaScript happens to remember. Two
 * separate node processes, two separate better-sqlite3 connections, one file,
 * one reviewed message, started together.
 *
 * ---------------------------------------------------------------------------
 * WHY IT HAS TO BE PROCESSES. The app's connection is a module singleton, so
 * two claims inside one worker share a connection and SQLite serialises them
 * for free. That is not the arrangement being defended against: `npm run
 * confirm-sends` and `npm run draft` are separate processes against the same
 * file today, and a scheduler will be another. A claim that only holds within
 * one process is not a claim.
 * ---------------------------------------------------------------------------
 *
 * A LOSER MAY LOSE IN TWO WAYS and both are correct: the guarded UPDATE
 * changes no row, or SQLite refuses the write lock outright with SQLITE_BUSY.
 * What may never happen is two winners, two execution records, or two units of
 * budget spent.
 */

const DB = path.join(ROOT, 'node_modules/.tmp', `d45-race-${randomUUID()}.sqlite`);
const node = (script, env = {}) => run('node', ['--input-type=module', '-e', script], {
  cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: DB, ...env }, encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});

const SEED = `
import db from '${path.join(ROOT, 'server/db/client.js')}';
import { randomUUID } from 'node:crypto';
import { findOrCreateCoach } from '${path.join(ROOT, 'server/lib/coaches.js')}';
import { materialiseNextContactAttempt } from '${path.join(ROOT, 'server/lib/pursuitPolicy.js')}';
import { generateProgrammeMessage } from '${path.join(ROOT, 'server/lib/programmeMessageGeneration.js')}';
import { reviewProgrammeMessage } from '${path.join(ROOT, 'server/lib/programmeMessages.js')}';

const A = 'a-race', OP = 'op-race', COLLEGE = 'Duke';
db.prepare("INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug, nationality, recruiting_class_year, gpa) VALUES (?, 'x','x','Marcus Reyes','DEFENSE','mens-soccer',?, 'New Zealand', 2027, 3.8)").run(A, randomUUID().slice(0,10));
db.prepare("INSERT INTO operator_users (id, email, password_hash, active, created_at) VALUES (?, ?, 'x', 1, 'x')").run(OP, OP + '@t.test');
db.prepare("INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at, snapshot_taken_at, programme_count) VALUES ('c1', ?, 'mens-soccer', 'active', '2020-01-01','x','x','x',1)").run(A);
db.prepare("INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score, tier, tier_source, state, created_at, updated_at) VALUES ('pc1','c1',?, 'mens-soccer', 1, 82, 'A','AUTO','queued','x','x')").run(COLLEGE);
db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference) VALUES (?, 'x','x',?, 'mens-soccer','NCAA D1','ACC')").run(randomUUID(), COLLEGE);
for (const [n, s] of [['Hayden Aish','2024'],['Jack Kelly','2023']]) {
  db.prepare("INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division, season, player_name, position, nationality, country, class_year_label, minutes_played, games_played) VALUES (?, 'x','x',?, 'mens-soccer','NCAA D1',?,?,'DEFENSE','International','New Zealand','Junior',900,18)").run(randomUUID(), COLLEGE, s, n);
}
const coach = findOrCreateCoach({ full_name: 'A Coach', email: 'head@duke.edu', school: COLLEGE, sport: 'mens-soccer', division: 'NCAA D1', position_title: 'Head Coach' });
const mb = 'mb-race';
db.prepare("INSERT INTO connected_mailboxes (id, operator_user_id, athlete_id, provider, provider_account_id, email_address, status, connected_at, created_at, updated_at) VALUES (?,?,?, 'GOOGLE', ?, 'athlete@example.com', 'CONNECTED','x','x','x')").run(mb, OP, A, randomUUID());
db.prepare("INSERT INTO connected_mailbox_credentials (mailbox_id, ciphertext, iv, auth_tag, key_version, rotated_at, created_at, updated_at) VALUES (?, 'ct','iv','tag','v1','x','x','x')").run(mb);

materialiseNextContactAttempt({ programmeCampaignId: 'pc1' });
const { message } = generateProgrammeMessage({ programmeCampaignId: 'pc1', coachId: coach.id });
reviewProgrammeMessage(message.id, { operatorId: OP });
process.stdout.write(JSON.stringify({ messageId: message.id, mailboxId: mb, operatorId: OP }));
`;

const claimScript = (messageId, mailboxId, operatorId, runId) => `
import { claimProgrammeMessageForExecution } from '${path.join(ROOT, 'server/lib/executionClaim.js')}';
try {
  const out = claimProgrammeMessageForExecution({
    programmeMessageId: ${JSON.stringify(messageId)},
    operatorUserId: ${JSON.stringify(operatorId)},
    connectedMailboxId: ${JSON.stringify(mailboxId)},
    runId: ${JSON.stringify(runId)},
    onDate: '2026-09-18',
  });
  process.stdout.write(JSON.stringify({ won: true, sendId: out.send.id, state: out.send.state, runId: out.send.claim_run_id }));
} catch (err) {
  process.stdout.write(JSON.stringify({ won: false, code: err.code ?? null, message: String(err.message).slice(0, 120) }));
}
`;

const READ = `
import db from '${path.join(ROOT, 'server/db/client.js')}';
process.stdout.write(JSON.stringify({
  sends: db.prepare('SELECT id, state, claim_run_id, programme_message_id FROM outreach_send').all(),
  ledger: db.prepare('SELECT id, outreach_send_id, transport FROM outbound_send_attempt').all(),
  outreach: db.prepare('SELECT COUNT(*) AS n FROM outreach').get().n,
}));
`;

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${DB}${suffix}`, { force: true });
});

describe('two processes claiming one message', () => {
  it('lets exactly one win, and spends exactly one outbound action', async () => {
    fs.mkdirSync(path.dirname(DB), { recursive: true });
    const seeded = JSON.parse((await node(SEED)).stdout);

    // Started together, against one file, from two separate connections.
    const [a, b] = await Promise.all([
      node(claimScript(seeded.messageId, seeded.mailboxId, seeded.operatorId, 'run-a')),
      node(claimScript(seeded.messageId, seeded.mailboxId, seeded.operatorId, 'run-b')),
    ]);
    const results = [JSON.parse(a.stdout), JSON.parse(b.stdout)];
    const winners = results.filter((r) => r.won);
    const losers = results.filter((r) => !r.won);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(winners[0].state).toBe('SENDING');

    /**
     * The loser lost for a reason it can name: the message was not available
     * to claim, or SQLite would not give it the write lock. Either is a clean
     * loss; what matters is that it wrote nothing.
     */
    expect(losers[0].code ?? losers[0].message).toBeTruthy();

    const after = JSON.parse((await node(READ)).stdout);
    expect(after.sends).toHaveLength(1);
    expect(after.sends[0].state).toBe('SENDING');
    expect(after.sends[0].programme_message_id).toBe(seeded.messageId);
    expect(after.sends[0].claim_run_id).toBe(winners[0].runId);
    // One message, one relationship, and one unit of capacity.
    expect(after.outreach).toBe(1);
    expect(after.ledger).toHaveLength(1);
    expect(after.ledger[0].outreach_send_id).toBe(after.sends[0].id);
    expect(after.ledger[0].transport).toBe('PROVIDER_API');
  }, 120_000);
});
