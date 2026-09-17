import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import db from './client.js';
import {
  MESSAGE_STATE, ACCEPTED_SOURCE, SEND_EVENT_TYPE, LEGAL_TRANSITIONS,
  OPEN_STATES, RELATIONSHIP_BLOCKING_STATES, TERMINAL_STATES,
  canTransition, isMessageState, isOpen, isTerminal, blocksRelationship,
} from '../../shared/outreachMessageState.js';
import { createOutreach } from '../lib/outreach.js';
import { recordDraft, openSendFor, transitionSend, sendsForOutreach } from '../lib/outreachSend.js';
import { pendingDrafts } from '../lib/confirmSends.js';
import { findOrCreateCoach } from '../lib/coaches.js';

/**
 * D4.4 — THE SHAPE PROVIDER EXECUTION WILL NEED, AND NOTHING THAT USES IT.
 *
 * This slice adds a state, an accepted source, two event types, ten columns, a
 * ledger pointer and three indexes. It executes nothing: no claim, no
 * transport, no budget change, no credential read, and no row anywhere is
 * written by it. What these tests hold still is the MODEL — what the new
 * vocabulary means, what it forbids, and that the forty-one historical sends
 * pass through the migration without acquiring a single fact nobody observed.
 *
 * The invariant the whole slice exists for is negative and lives in the
 * transition table: an ambiguous send has no edge back to QUEUED or SENDING,
 * so "never automatically resend a message that may already have arrived" is
 * something the state machine refuses rather than something a caller
 * remembers.
 */

const ATHLETE = 'a-d44';
let seq = 0;

const makeCoach = (email) => findOrCreateCoach({
  full_name: 'A Coach', email: email ?? `d44-${++seq}@example.edu`, school: 'Duke', sport: 'mens-soccer',
});

/** A relationship carrying one message, in whatever state the caller wants. */
function seedMessage(state = MESSAGE_STATE.DRAFT) {
  const coach = makeCoach();
  const outreach = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
  const draft = recordDraft({
    outreachId: outreach.id, athleteId: ATHLETE, coachId: coach.id, collegeName: 'Duke',
    evidence: null, body: 'hello', subject: 'hi',
  });
  if (state !== MESSAGE_STATE.DRAFT) {
    // Through the legal graph, never by writing the column directly.
    if (state === MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT || state === MESSAGE_STATE.FAILED) {
      transitionSend(draft.id, MESSAGE_STATE.SENDING);
    }
    transitionSend(draft.id, state);
  }
  return { outreach, coach, sendId: draft.id };
}

/** A connected mailbox, so the foreign key on the new column is satisfiable. */
function makeMailbox() {
  const operator = `op-${randomUUID()}`;
  db.prepare(`INSERT INTO operator_users (id, email, password_hash, created_at, active)
              VALUES (?, ?, 'x', '2026-09-18T00:00:00.000Z', 1)`).run(operator, `${operator}@x.test`);
  const mailbox = `mb-${randomUUID()}`;
  db.prepare(`INSERT INTO connected_mailboxes (id, operator_user_id, provider, provider_account_id,
                email_address, status, connected_at, created_at, updated_at)
              VALUES (?, ?, 'GOOGLE', ?, ?, 'CONNECTED',
                '2026-09-18T00:00:00.000Z', '2026-09-18T00:00:00.000Z', '2026-09-18T00:00:00.000Z')`)
    .run(mailbox, operator, randomUUID(), `${mailbox}@example.com`);
  return mailbox;
}

beforeEach(() => {
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach; DELETE FROM coaches;
           DELETE FROM connected_mailbox_credentials; DELETE FROM connected_mailboxes;
           DELETE FROM operator_sessions; DELETE FROM operator_users;
           DELETE FROM players;`);
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug)
    VALUES (?, '2026-09-18T00:00:00.000Z', '2026-09-18T00:00:00.000Z', 'D44 Athlete', 'MIDFIELD', 'mens-soccer', ?)
  `).run(ATHLETE, randomUUID().slice(0, 10));
});

/* ========================================================================== */
/* The state                                                                   */
/* ========================================================================== */

describe('UNKNOWN_PROVIDER_RESULT', () => {
  it('exists, and is a message state', () => {
    expect(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT).toBe('UNKNOWN_PROVIDER_RESULT');
    expect(isMessageState('UNKNOWN_PROVIDER_RESULT')).toBe(true);
  });

  it('is where a transport that ran and could not be read ends up', () => {
    expect(canTransition('SENDING', 'UNKNOWN_PROVIDER_RESULT')).toBe(true);
  });

  it('can be resolved, in both directions reconciliation can establish', () => {
    expect(canTransition('UNKNOWN_PROVIDER_RESULT', 'ACCEPTED')).toBe(true);
    expect(canTransition('UNKNOWN_PROVIDER_RESULT', 'FAILED')).toBe(true);
  });

  it('CANNOT be handed back to a transport, by any path', () => {
    /**
     * THE INVARIANT THE SLICE EXISTS FOR. Not a convention, not a comment at a
     * call site: two missing edges. A message that may already be in a coach's
     * inbox cannot be re-queued or re-sent by code that does not exist yet.
     */
    expect(canTransition('UNKNOWN_PROVIDER_RESULT', 'QUEUED')).toBe(false);
    expect(canTransition('UNKNOWN_PROVIDER_RESULT', 'SENDING')).toBe(false);
    expect(LEGAL_TRANSITIONS.UNKNOWN_PROVIDER_RESULT).toEqual(['ACCEPTED', 'FAILED']);
  });

  it('is refused by the one writer of state, with the reason said out loud', () => {
    const { sendId } = seedMessage(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    expect(() => transitionSend(sendId, 'QUEUED')).toThrow(/cannot go from UNKNOWN_PROVIDER_RESULT to QUEUED/);
    expect(() => transitionSend(sendId, 'SENDING')).toThrow(/cannot go from UNKNOWN_PROVIDER_RESULT to SENDING/);
    // And it is still exactly where it was.
    expect(sendsForOutreach(db.prepare('SELECT id FROM outreach').get().id)[0].state)
      .toBe('UNKNOWN_PROVIDER_RESULT');
  });

  it('is neither open nor terminal, and is not a pending draft', () => {
    expect(isOpen('UNKNOWN_PROVIDER_RESULT')).toBe(false);
    expect(isTerminal('UNKNOWN_PROVIDER_RESULT')).toBe(false);
    expect(OPEN_STATES).toEqual(['DRAFT', 'QUEUED', 'SENDING']);
    expect(TERMINAL_STATES).toEqual(['ACCEPTED', 'CANCELLED']);
  });

  it('is not offered to anything that looks for the open message', () => {
    /**
     * `recordDraft` REUSES the open row, so an UNKNOWN row inside OPEN_STATES
     * would be rewritten in place with a new body — over a message a coach may
     * already have. It must not be found here.
     */
    const { outreach } = seedMessage(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    expect(openSendFor(outreach.id)).toBeNull();
  });

  it('is never offered to an operator as a draft to confirm', () => {
    /**
     * The other reading of "open". `confirm-sends` asks a person to say a
     * batch went out; offering them a message whose fate nobody knows would
     * turn "we cannot tell" into OPERATOR_ASSERTED — a person asserting
     * something they were never in a position to observe.
     */
    seedMessage(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    const rows = pendingDrafts({ athleteId: ATHLETE });
    for (const row of rows) expect(row.send_id).toBeNull();
  });

  it('still blocks another message being opened on the relationship', () => {
    /**
     * The wider question, and the reason RELATIONSHIP_BLOCKING_STATES is a
     * separate list. The message may be in an inbox; a second one beside it is
     * the double send by the back door.
     */
    expect(blocksRelationship('UNKNOWN_PROVIDER_RESULT')).toBe(true);
    expect(RELATIONSHIP_BLOCKING_STATES)
      .toEqual(['DRAFT', 'QUEUED', 'SENDING', 'UNKNOWN_PROVIDER_RESULT']);

    const { outreach, coach } = seedMessage(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    expect(() => db.prepare(`
      INSERT INTO outreach_send (id, outreach_id, sequence, athlete_id, coach_id,
                                 policy_version, state, created_at)
      VALUES (?, ?, 2, ?, ?, 'P2', 'DRAFT', '2026-09-18T00:00:00.000Z')
    `).run(randomUUID(), outreach.id, ATHLETE, coach.id))
      .toThrow(/UNIQUE constraint failed: outreach_send.outreach_id/);
  });

  it('stops blocking once somebody resolves it', () => {
    const { outreach, coach, sendId } = seedMessage(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    transitionSend(sendId, 'FAILED');
    expect(() => db.prepare(`
      INSERT INTO outreach_send (id, outreach_id, sequence, athlete_id, coach_id,
                                 policy_version, state, created_at)
      VALUES (?, ?, 2, ?, ?, 'P2', 'DRAFT', '2026-09-18T00:00:00.000Z')
    `).run(randomUUID(), outreach.id, ATHLETE, coach.id)).not.toThrow();
  });
});

/* ========================================================================== */
/* The accepted source                                                         */
/* ========================================================================== */

describe('PROVIDER_RECONCILED', () => {
  it('exists beside the three that were already there, and changes none of them', () => {
    expect(Object.keys(ACCEPTED_SOURCE)).toEqual([
      'OPERATOR_ASSERTED', 'OUTLOOK_COMMAND_ASSERTED', 'PROVIDER_ACCEPTED', 'PROVIDER_RECONCILED',
    ]);
    expect(ACCEPTED_SOURCE.OPERATOR_ASSERTED).toBe('OPERATOR_ASSERTED');
    expect(ACCEPTED_SOURCE.OUTLOOK_COMMAND_ASSERTED).toBe('OUTLOOK_COMMAND_ASSERTED');
    expect(ACCEPTED_SOURCE.PROVIDER_ACCEPTED).toBe('PROVIDER_ACCEPTED');
  });

  it('is accepted by the transition writer, so reconciliation has a source to use', () => {
    const { sendId } = seedMessage(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    const out = transitionSend(sendId, 'ACCEPTED', {
      acceptedSource: ACCEPTED_SOURCE.PROVIDER_RECONCILED,
    });
    expect(out.state).toBe('ACCEPTED');
    expect(out.accepted_source).toBe('PROVIDER_RECONCILED');
  });

  it('nothing in this build produces it, or PROVIDER_ACCEPTED', () => {
    /**
     * The CODE form, not the word. Both names appear in migrate.js prose,
     * explaining why the forty-one historical rows are OPERATOR_ASSERTED and
     * not something stronger — which is the opposite of a producer. What would
     * make one is a reference through the enum.
     */
    const hits = execFileSync('grep', [
      '-rl', 'ACCEPTED_SOURCE.PROVIDER_', 'server', 'src', 'shared',
    ], { cwd: ROOT, encoding: 'utf8', });
    const produced = hits.trim().split('\n').filter(Boolean)
      .filter((f) => !f.endsWith('.test.js'));
    expect(produced).toEqual([]);
  });
});

describe('the transport event vocabulary', () => {
  it('names a definite refusal and an unreadable outcome', () => {
    expect(SEND_EVENT_TYPE.TRANSPORT_REJECTED).toBe('TRANSPORT_REJECTED');
    expect(SEND_EVENT_TYPE.TRANSPORT_UNKNOWN).toBe('TRANSPORT_UNKNOWN');
  });

  it('keeps every type that was already there', () => {
    for (const t of ['ACCEPTED', 'BOUNCE_HARD', 'BOUNCE_SOFT', 'REPLY', 'COMPLAINT', 'OPT_OUT']) {
      expect(SEND_EVENT_TYPE[t]).toBe(t);
    }
  });

  it('writes no event rows, because D4.4 observes nothing', () => {
    seedMessage(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    expect(db.prepare('SELECT COUNT(*) AS n FROM outreach_send_event').get().n).toBe(0);
  });
});

/* ========================================================================== */
/* The schema                                                                  */
/* ========================================================================== */

const NEW_SEND_COLUMNS = [
  'programme_message_id', 'connected_mailbox_id', 'sending_identity', 'provider',
  'provider_message_id', 'provider_thread_id', 'internet_message_id',
  'provider_accepted_at', 'claimed_at', 'claim_run_id',
];

describe('the outreach_send execution columns', () => {
  const columns = () => db.prepare('PRAGMA table_info(outreach_send)').all();

  it('all exist', () => {
    const names = columns().map((c) => c.name);
    for (const c of NEW_SEND_COLUMNS) expect(names).toContain(c);
  });

  it('are all nullable, with no default', () => {
    for (const c of columns().filter((x) => NEW_SEND_COLUMNS.includes(x.name))) {
      expect(c.notnull).toBe(0);
      expect(c.dflt_value).toBeNull();
    }
  });

  it('are null on a row the current build writes, because nothing fills them', () => {
    const { outreach } = seedMessage();
    const [row] = sendsForOutreach(outreach.id);
    for (const c of NEW_SEND_COLUMNS) expect(row[c]).toBeNull();
  });

  it('points at a composed message with ON DELETE SET NULL, so history outlives a campaign', () => {
    const fk = db.pragma('foreign_key_list(outreach_send)')
      .find((f) => f.from === 'programme_message_id');
    expect(fk).toBeDefined();
    expect(fk.table).toBe('programme_messages');
    /**
     * `programme_messages` cascades from the contact attempt, which cascades
     * from the programme campaign, which cascades from the campaign. Deleting a
     * campaign therefore destroys the composed bodies — and send history has to
     * survive that, which is why the pointer goes null rather than taking the
     * row with it.
     */
    expect(fk.on_delete).toBe('SET NULL');
  });

  it('points at a mailbox with no ON DELETE, so the mailbox cannot be deleted away', () => {
    const fk = db.pragma('foreign_key_list(outreach_send)')
      .find((f) => f.from === 'connected_mailbox_id');
    expect(fk).toBeDefined();
    expect(fk.table).toBe('connected_mailboxes');
    /**
     * The opposite decision from the one above, and for the opposite reason. A
     * mailbox row is durable historical identity — `connected_mailboxes`
     * refused CASCADE on its own operator column for exactly this — so the
     * delete is refused rather than the attribution being erased. Revocation is
     * the designed exit: it destroys the credential and keeps the row.
     */
    expect(fk.on_delete).toBe('NO ACTION');
  });

  it('refuses to delete a mailbox a send was made through', () => {
    const mailbox = makeMailbox();
    const { outreach } = seedMessage();
    db.prepare('UPDATE outreach_send SET connected_mailbox_id = ? WHERE outreach_id = ?')
      .run(mailbox, outreach.id);

    expect(() => db.prepare('DELETE FROM connected_mailboxes WHERE id = ?').run(mailbox))
      .toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe('the provider-message guard', () => {
  const index = () => db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_outreach_send_provider_message'",
  ).get()?.sql ?? '';

  it('is keyed on the mailbox as well as the provider', () => {
    /**
     * A PROVIDER-NATIVE MESSAGE ID IS SCOPED TO A MAILBOX, NOT GLOBALLY.
     * Gmail assigns ids inside a user's mailbox and Graph's are per-mailbox and
     * change when a message moves folders, so two athletes' connected accounts
     * can each hold the same id value with nothing wrong. A
     * UNIQUE (provider, provider_message_id) would refuse the second — a real
     * send blocked by a collision between two id spaces that never shared one.
     */
    expect(index()).toContain('connected_mailbox_id, provider, provider_message_id');
    expect(index()).toContain('WHERE provider_message_id IS NOT NULL');
  });

  it('lets two different mailboxes carry the same provider message id', () => {
    /**
     * THE CASE A GLOBAL KEY WOULD HAVE BROKEN. Two athletes, two connected
     * Gmail accounts, the same id value in each one's own id space — and a
     * `UNIQUE (provider, provider_message_id)` would have refused the second
     * athlete's perfectly ordinary send.
     */
    const a = makeMailbox();
    const b = makeMailbox();
    for (const mailbox of [a, b]) {
      const { outreach } = seedMessage();
      expect(() => db.prepare(`
        UPDATE outreach_send SET connected_mailbox_id = ?, provider = 'GOOGLE',
               provider_message_id = 'gmail-1799' WHERE outreach_id = ?
      `).run(mailbox, outreach.id)).not.toThrow();
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM outreach_send WHERE provider_message_id = 'gmail-1799'")
      .get().n).toBe(2);
  });

  it('refuses the same provider message id twice from one mailbox', () => {
    const mailbox = makeMailbox();
    const first = seedMessage();
    const second = seedMessage();
    db.prepare(`UPDATE outreach_send SET connected_mailbox_id = ?, provider = 'GOOGLE',
                provider_message_id = 'gmail-42' WHERE outreach_id = ?`).run(mailbox, first.outreach.id);
    expect(() => db.prepare(`UPDATE outreach_send SET connected_mailbox_id = ?, provider = 'GOOGLE',
                provider_message_id = 'gmail-42' WHERE outreach_id = ?`).run(mailbox, second.outreach.id))
      .toThrow(/UNIQUE constraint failed/);
  });

  it('leaves every historical row outside it, because they are all null', () => {
    const first = seedMessage();
    const second = seedMessage();
    // Two rows with no provider id at all do not collide with each other.
    expect(sendsForOutreach(first.outreach.id)[0].provider_message_id).toBeNull();
    expect(sendsForOutreach(second.outreach.id)[0].provider_message_id).toBeNull();
  });
});

describe('the outbound ledger pointer', () => {
  it('exists and is nullable', () => {
    const c = db.prepare('PRAGMA table_info(outbound_send_attempt)').all()
      .find((x) => x.name === 'outreach_send_id');
    expect(c).toBeDefined();
    expect(c.notnull).toBe(0);
  });

  it('carries no uniqueness, because one message may cost several attempts', () => {
    const indexes = db.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='outbound_send_attempt'",
    ).all();
    const unique = indexes.filter((i) => (i.sql ?? '').includes('UNIQUE'));
    expect(unique).toEqual([]);
    expect(indexes.map((i) => i.name)).toContain('idx_outbound_attempt_send');
  });

  it('accepts several ledger rows pointing at one message', () => {
    /**
     * A retry is a second attempt and appears as a second row — the schema says
     * so, and a unique index would have made the retry unrecordable and
     * understated mailbox usage by exactly the traffic it protects.
     */
    const { outreach, sendId } = seedMessage();
    for (let i = 0; i < 3; i += 1) {
      db.prepare(`INSERT INTO outbound_send_attempt
        (id, outreach_id, athlete_id, sending_identity, transport, attempted_at, created_at, outreach_send_id)
        VALUES (?, ?, ?, 'sender@example.com', 'OUTLOOK_APPLESCRIPT', ?, ?, ?)`)
        .run(randomUUID(), outreach.id, ATHLETE, `2026-09-18T0${i}:00:00.000Z`,
          `2026-09-18T0${i}:00:00.000Z`, sendId);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM outbound_send_attempt WHERE outreach_send_id = ?')
      .get(sendId).n).toBe(3);
  });

  it('still accepts a ledger row with no message, which is every manual one', () => {
    const { outreach } = seedMessage();
    expect(() => db.prepare(`INSERT INTO outbound_send_attempt
      (id, outreach_id, athlete_id, sending_identity, transport, attempted_at, created_at)
      VALUES (?, ?, ?, 'sender@example.com', 'OUTLOOK_MANUAL', '2026-09-18T00:00:00.000Z', '2026-09-18T00:00:00.000Z')`)
      .run(randomUUID(), outreach.id, ATHLETE)).not.toThrow();
  });
});

/* ========================================================================== */
/* The migration                                                               */
/* ========================================================================== */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = path.join(ROOT, 'server/data/baseline/recruitmatch-baseline.sqlite');
const HAVE_FIXTURE = fs.existsSync(FIXTURE) && fs.statSync(FIXTURE).size > 1_000_000;
const historical = HAVE_FIXTURE ? describe : describe.skip;
if (!HAVE_FIXTURE) console.warn(`\n  providerExecution.test.js migration block SKIPPED — no fixture at ${FIXTURE}\n`);

/** Boots the app's own database module against a file and reports what it sees. */
const boot = (file) => JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
  import db from '${path.join(ROOT, 'server/db/client.js')}';
  const cols = db.prepare('PRAGMA table_info(outreach_send)').all().map((c) => c.name);
  const nonNull = {};
  for (const c of ${JSON.stringify(NEW_SEND_COLUMNS)}) {
    nonNull[c] = db.prepare('SELECT COUNT(*) AS n FROM outreach_send WHERE "' + c + '" IS NOT NULL').get().n;
  }
  process.stdout.write(JSON.stringify({
    columns: cols.length,
    hasAll: ${JSON.stringify(NEW_SEND_COLUMNS)}.every((c) => cols.includes(c)),
    nonNull,
    ledgerPointer: db.prepare('PRAGMA table_info(outbound_send_attempt)').all().some((c) => c.name === 'outreach_send_id'),
    oneOpen: db.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_outreach_send_one_open'").get()?.sql ?? null,
    sends: db.prepare('SELECT COUNT(*) AS n FROM outreach_send').get().n,
    byState: db.prepare('SELECT state, COUNT(*) AS n FROM outreach_send GROUP BY state ORDER BY state').all(),
    bySource: db.prepare('SELECT accepted_source, COUNT(*) AS n FROM outreach_send GROUP BY accepted_source ORDER BY accepted_source').all(),
    integrity: db.pragma('integrity_check')[0].integrity_check,
    fk: db.pragma('foreign_key_check').length,
  }));
`], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: file }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));

historical('migrating a database that holds the historical sends', () => {
  /**
   * AGAINST A DISPOSABLE COPY OF THE PINNED FIXTURE, never a working database.
   * The fixture is the operator snapshot the V3 baselines are measured on: it
   * carries the forty-one confirmed sends, and it predates every column this
   * slice adds, so it is the honest before-state.
   */
  const copy = path.join(ROOT, 'node_modules/.tmp', `d44-${randomUUID()}.sqlite`);

  it('adds the columns, widens the guard, and invents nothing', () => {
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(FIXTURE, copy);
    fs.chmodSync(copy, 0o600);

    const after = boot(copy);

    expect(after.hasAll).toBe(true);
    expect(after.ledgerPointer).toBe(true);
    expect(after.oneOpen).toContain('UNKNOWN_PROVIDER_RESULT');

    // The forty-one, exactly as they were.
    expect(after.sends).toBeGreaterThan(0);
    expect(after.byState).toEqual([{ state: 'ACCEPTED', n: after.sends }]);
    /**
     * NOT ONE OF THEM BECOMES PROVIDER_ACCEPTED. They left through a shared
     * Outlook account and nobody watched them go; the migration has no business
     * upgrading the evidence for that.
     */
    expect(after.bySource).toEqual([{ accepted_source: 'OPERATOR_ASSERTED', n: after.sends }]);

    // And not one provider fact was manufactured for any of them.
    for (const c of NEW_SEND_COLUMNS) expect(after.nonNull[c]).toBe(0);

    expect(after.integrity).toBe('ok');
    expect(after.fk).toBe(0);

    // Running it again changes nothing at all.
    expect(boot(copy)).toEqual(after);
    expect(boot(copy)).toEqual(after);

    fs.rmSync(copy, { force: true });
  });
});
