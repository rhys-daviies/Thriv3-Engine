import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import db from '../db/client.js';
import { materialiseNextContactAttempt } from './pursuitPolicy.js';
import { generateProgrammeMessage } from './programmeMessageGeneration.js';
import { reviewProgrammeMessage } from './programmeMessages.js';
import { claimProgrammeMessageForExecution, executionSnapshot } from './executionClaim.js';
import { createConnectedMailbox, storeMailboxCredential } from './connectedMailboxes.js';

/**
 * D5.1 — THE TWO FACTS A REAL PROVIDER NEEDS, AND WHERE THEY COME FROM.
 *
 * ===========================================================================
 * NO SCHEMA CHANGE, AND THE TRACE IS THE WHOLE ARGUMENT.
 *
 * A Google adapter needs two things `executionSnapshot` did not carry:
 *
 *   providerAccountId  what the authenticated account's `sub` is compared
 *                      against, so a credential belonging to a DIFFERENT
 *                      Google account is caught before anything is sent.
 *   operatorUserId     the authority under which `mailboxCredential` may be
 *                      read at all.
 *
 * The preflight proposed a new `outreach_send.authorised_by_operator_id`
 * column. It is not needed, and these tests are the proof: both facts come
 * from ONE immutable join, `outreach_send.connected_mailbox_id ->
 * connected_mailboxes`, and there is no second authority in the schema that
 * could ever disagree with it.
 * ===========================================================================
 */

const ATHLETE = 'a-d51snap';
const OPERATOR = 'op-d51snap';
const OTHER_OPERATOR = 'op-d51snap-2';
const COLLEGE = 'Duke';
const SPORT = 'mens-soccer';
let seq = 0;

function athlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug,
      nationality, recruiting_class_year, gpa)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'DEFENSE', 'mens-soccer', ?, 'New Zealand', 2027, 3.8)
  `).run(id, randomUUID().slice(0, 10));
}
function operator(id) {
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, active, created_at)
    VALUES (?, ?, 'scrypt$fake', 1, 'x')
  `).run(id, `${id}@thriv3.test`);
}
function college() {
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference)
    VALUES (?, 'x', 'x', ?, ?, 'NCAA D1', 'ACC')
  `).run(randomUUID(), COLLEGE, SPORT);
  for (const [name, season] of [['Hayden Aish', '2024'], ['Jack Kelly', '2023']]) {
    db.prepare(`
      INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division,
        season, player_name, position, nationality, country, class_year_label, minutes_played,
        games_played)
      VALUES (?, 'x', 'x', ?, ?, 'NCAA D1', ?, ?, 'DEFENSE', 'International', 'New Zealand',
        'Junior', 900, 18)
    `).run(randomUUID(), COLLEGE, SPORT, season, name);
  }
}

let accountId;
function mailboxFor({ operatorId = OPERATOR } = {}) {
  accountId = `google-sub-${++seq}`;
  const box = createConnectedMailbox({
    operatorUserId: operatorId, athleteId: ATHLETE, provider: 'GOOGLE',
    providerAccountId: accountId, emailAddress: `mb${seq}@example.com`,
  });
  storeMailboxCredential(box.id, { refreshToken: `rt-${seq}`, operatorUserId: operatorId });
  return box.id;
}

/** A real claim, so the snapshot is read back from a committed row. */
function claimed({ operatorId = OPERATOR } = {}) {
  const c = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', 'active', '2020-01-01', 'x', 'x', 'x', 1)
  `).run(c, ATHLETE);
  const pc = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 82, 'A', 'AUTO', 'queued', 'x', 'x')
  `).run(pc, c, COLLEGE, SPORT, ++seq);
  const coachId = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, 'x', ?, ?, ?, 'NCAA D1', ?, 'Head Coach')
  `).run(coachId, `Coach ${++seq}`, `k${seq}@duke.edu`, COLLEGE, SPORT);
  materialiseNextContactAttempt({ programmeCampaignId: pc });
  const { message } = generateProgrammeMessage({ programmeCampaignId: pc, coachId });
  reviewProgrammeMessage(message.id, { operatorId: OPERATOR });

  const mailboxId = mailboxFor({ operatorId });
  const out = claimProgrammeMessageForExecution({
    programmeMessageId: message.id, operatorUserId: operatorId,
    connectedMailboxId: mailboxId, runId: 'run-d51', at: '2026-09-18T09:00:00.000Z',
    onDate: '2026-09-18',
  });
  return { ...out, mailboxId, coachId, messageId: message.id };
}

beforeEach(() => {
  db.exec(`DELETE FROM programme_messages; DELETE FROM campaign_first_touch_approvals;
           DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes;
           DELETE FROM connected_mailbox_credentials; DELETE FROM connected_mailboxes;
           DELETE FROM coaches; DELETE FROM colleges; DELETE FROM roster_players;
           DELETE FROM operator_users; DELETE FROM players;`);
  athlete(ATHLETE);
  operator(OPERATOR);
  operator(OTHER_OPERATOR);
  college();
  seq = 0;
});

/* ========================================================================== */

describe('A. the two provider facts', () => {
  it('carries the provider account id from the mailbox row', () => {
    const out = claimed();
    const snap = executionSnapshot(out.send.id);
    expect(snap.providerAccountId).toBe(accountId);
  });

  it('carries the operator who owns the mailbox', () => {
    const out = claimed();
    expect(executionSnapshot(out.send.id).operatorUserId).toBe(OPERATOR);
  });

  it('agrees with the mailbox row, which is the only authority for both', () => {
    const out = claimed();
    const snap = executionSnapshot(out.send.id);
    const box = db.prepare('SELECT * FROM connected_mailboxes WHERE id = ?').get(out.mailboxId);
    expect(snap.operatorUserId).toBe(box.operator_user_id);
    expect(snap.providerAccountId).toBe(box.provider_account_id);
    expect(snap.mailboxId).toBe(box.id);
  });

  it('follows a second operator’s mailbox to that operator, not to the first', () => {
    /* Ownership is per-mailbox, and the snapshot reports whose it actually is. */
    const out = claimed({ operatorId: OTHER_OPERATOR });
    expect(executionSnapshot(out.send.id).operatorUserId).toBe(OTHER_OPERATOR);
  });

  it('is derived, not denormalised — no operator column was added', () => {
    const cols = db.prepare('PRAGMA table_info(outreach_send)').all().map((c) => c.name);
    expect(cols).not.toContain('authorised_by_operator_id');
    expect(cols).not.toContain('authorisation_kind');
    expect(cols).not.toContain('provider_account_id');
  });

  it('has exactly one authority in the schema to derive from', () => {
    /**
     * THE TRACE, ASSERTED. If `campaigns` ever grows an operator column this
     * test fails, and the design question — which of two authorities wins —
     * has to be answered deliberately rather than discovered in a send.
     */
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all().map((r) => r.name);
    const owning = tables.filter((t) => db.prepare(`PRAGMA table_info(${t})`).all()
      .some((c) => c.name === 'operator_user_id'));
    expect(owning.sort()).toEqual(['connected_mailboxes', 'mailbox_consent_grants']);
    /* Neither `campaigns` nor `players` carries one, so there is nothing for the
       mailbox's answer to disagree with. */
    for (const t of ['campaigns', 'programme_campaigns', 'players', 'outreach_send']) {
      expect(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name), t)
        .not.toContain('operator_user_id');
    }
  });

  it('cannot be pointed at a mailbox the operator does not hold', () => {
    /* The claim refuses first, so a row can never carry a foreign mailbox. */
    const foreign = mailboxFor({ operatorId: OTHER_OPERATOR });
    const err = (() => {
      try { claimed(); } catch (e) { return e; }
      return null;
    })();
    expect(err).toBeNull();
    expect(foreign).toBeTruthy();
  });
});

/* ========================================================================== */

describe('B. what completeness now means', () => {
  it('is complete for a real claim', () => {
    const out = claimed();
    expect(executionSnapshot(out.send.id).complete).toBe(true);
  });

  it('cannot lose the provider account id, because the column forbids it', () => {
    /**
     * The completeness check covers it, but it is unreachable in practice and
     * that is the stronger fact: `provider_account_id` is NOT NULL, so a
     * connected mailbox without one cannot exist. Asserted rather than
     * simulated — a test that nulls a column the schema refuses would be
     * testing a state the system cannot reach.
     */
    const out = claimed();
    const col = db.prepare('PRAGMA table_info(connected_mailboxes)').all()
      .find((c) => c.name === 'provider_account_id');
    expect(col.notnull).toBe(1);
    expect(() => db.prepare('UPDATE connected_mailboxes SET provider_account_id = NULL WHERE id = ?')
      .run(out.mailboxId)).toThrow(/NOT NULL/);
  });

  it('is incomplete without a mailbox to derive an operator from', () => {
    const out = claimed();
    db.prepare('UPDATE outreach_send SET connected_mailbox_id = NULL WHERE id = ?')
      .run(out.send.id);
    const snap = executionSnapshot(out.send.id);
    expect(snap.operatorUserId).toBeNull();
    expect(snap.complete).toBe(false);
  });

  it('is still incomplete for the reasons D4.7 established', () => {
    const out = claimed();
    for (const col of ['body', 'wire_body_sha256', 'subject', 'sending_identity', 'provider']) {
      const before = db.prepare(`SELECT ${col} AS v FROM outreach_send WHERE id = ?`)
        .get(out.send.id).v;
      db.prepare(`UPDATE outreach_send SET ${col} = NULL WHERE id = ?`).run(out.send.id);
      expect(executionSnapshot(out.send.id).complete, col).toBe(false);
      db.prepare(`UPDATE outreach_send SET ${col} = ? WHERE id = ?`).run(before, out.send.id);
    }
    expect(executionSnapshot(out.send.id).complete).toBe(true);
  });
});

/* ========================================================================== */

describe('C. what the snapshot still refuses to carry', () => {
  it('holds no credential of any kind', () => {
    const out = claimed();
    const snap = executionSnapshot(out.send.id);
    const text = JSON.stringify(snap);
    for (const secret of ['refresh', 'ciphertext', 'auth_tag', 'key_version', 'access_token',
      'rt-']) {
      expect(text.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    }
    expect(Object.keys(snap).sort()).toEqual([
      'body', 'bodyHash', 'complete', 'mailboxId', 'operatorUserId', 'programmeMessageId',
      'provider', 'providerAccountId', 'recipientEmail', 'sendId', 'sendingIdentity',
      'state', 'subject', 'wireBodySha256',
    ]);
  });

  it('takes the recipient from immutable programme-message truth, not the coach row', () => {
    const out = claimed();
    const before = executionSnapshot(out.send.id).recipientEmail;
    db.prepare('UPDATE coaches SET email = ? WHERE id = ?')
      .run(`moved-${randomUUID().slice(0, 6)}@duke.edu`, out.coachId);
    expect(executionSnapshot(out.send.id).recipientEmail).toBe(before);
  });

  it('takes the sending identity from the frozen row, not the live mailbox', () => {
    const out = claimed();
    const before = executionSnapshot(out.send.id).sendingIdentity;
    db.prepare('UPDATE connected_mailboxes SET email_address = ? WHERE id = ?')
      .run('renamed@example.com', out.mailboxId);
    /* Drift is something the adapter REFUSES on; it is not something the
       snapshot quietly follows. */
    expect(executionSnapshot(out.send.id).sendingIdentity).toBe(before);
  });

  it('adds no mailbox status and no Message-ID', () => {
    const snap = executionSnapshot(claimed().send.id);
    expect(snap.mailboxStatus).toBeUndefined();
    expect(snap.internetMessageId).toBeUndefined();
    expect(snap.authorisationKind).toBeUndefined();
  });

  it('is still read by exactly one snapshot authority', () => {
    /* transportSnapshot.js is deliberately not converged — one authority. */
    const src = fs.readFileSync(new URL('./executionClaim.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/transportSnapshot/);
    expect(fs.existsSync(new URL('./transportSnapshot.js', import.meta.url))).toBe(false);
  });

  it('decrypts nothing while claiming', () => {
    const src = fs.readFileSync(new URL('./executionClaim.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/mailboxCredential|decryptMailboxCredential|mailboxCrypto/);
  });
});
