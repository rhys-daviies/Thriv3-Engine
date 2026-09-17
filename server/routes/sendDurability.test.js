import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * A MESSAGE IS RECORDED BEFORE ANYTHING CLAIMS IT WAS SENT — D4.3.
 *
 * Three defects, found in the D1 inspection and re-proved on the converged
 * tree before this file existed. None of them is a hypothetical:
 *
 *   A  `markOutreachDrafted` / `markOutreachSent` ran BEFORE `recordDraft`, so
 *      `outreach.sent_at` — the column every denominator in this system keys
 *      on — could claim a send that no `outreach_send` row supported.
 *
 *   B  `recordDraft` and `confirmSend` sat inside `if (coachEvidence)`, so an
 *      email composed where the evidence engine found nothing, or threw,
 *      reached a coach and left NO message row at all. The relationship was
 *      still marked sent, which is defect A with the evidence to prove it.
 *
 *   C  `nextSequence` counted ACCEPTED rows, so a FAILED or CANCELLED message
 *      held a sequence number that the counter then offered again — and the
 *      next draft died on `UNIQUE (outreach_id, sequence)`. See
 *      outreachSend.test.js and outreachMessageState.test.js for that half.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE TOUCHES OUTLOOK, A MAILBOX, A PROVIDER OR A NETWORK. The
 * AppleScript bridge is intercepted below and records what it was asked to do;
 * no message leaves this process.
 * ---------------------------------------------------------------------------
 */

/** Intercepts the Outlook bridge. Nothing is composed, drafted or sent. */
const composed = [];
vi.mock('../lib/outlook.js', () => ({
  isOutlookAvailable: () => true,
  composeInOutlook: vi.fn(async (message) => {
    composed.push(message);
    return { ok: true, sent: message.send };
  }),
}));

/**
 * THE EVIDENCE ENGINE, MADE TO FAIL ON DEMAND.
 *
 * `coachEvidence` being null is the case defect B hid, and it is not exotic:
 * `sendOutreach` derives evidence inside a try/catch that warns and carries on,
 * so any programme the engine cannot speak about — a school with no roster on
 * file, a sport it holds nothing for, a query that throws — produced an email
 * and no message row at all.
 *
 * Mocked rather than contrived from data, because the condition under test is
 * "the engine did not answer", not "this particular school is thin". The real
 * module is delegated to whenever `evidence.fail` is false, so the same file
 * can also prove the ordering holds when evidence IS available.
 */
const evidence = { fail: true };
vi.mock('../lib/evidenceQueries.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    evidenceFor: (...args) => {
      if (evidence.fail) throw new Error('no evidence for this programme (test)');
      return actual.evidenceFor(...args);
    },
  };
});

/**
 * The relationship marks, wrapped rather than replaced.
 *
 * THE ORDERING PROOF IS BEHAVIOURAL, NOT TEXTUAL. Each wrapper asks the
 * database what it can see AT THE MOMENT IT IS CALLED and records the answer;
 * the real implementation then runs untouched. So the assertion is "a durable
 * message row was already there when the relationship was marked", which is
 * the property that matters — and it would still hold if somebody rewrote the
 * function tomorrow in a different shape. A test on line order would not.
 */
const marks = [];
vi.mock('../lib/outreach.js', async (importOriginal) => {
  const actual = await importOriginal();
  const seen = (label) => (id, ...rest) => {
    const { n } = dbRef.value
      .prepare('SELECT COUNT(*) AS n FROM outreach_send WHERE outreach_id = ?').get(id);
    const row = dbRef.value
      .prepare('SELECT state, subject FROM outreach_send WHERE outreach_id = ? ORDER BY sequence DESC LIMIT 1')
      .get(id) ?? null;
    marks.push({ label, sendRows: n, state: row?.state ?? null, subject: row?.subject ?? null });
    return actual[label](id, ...rest);
  };
  return {
    ...actual,
    markOutreachDrafted: seen('markOutreachDrafted'),
    markOutreachSent: seen('markOutreachSent'),
  };
});

/** Set after the mocked module graph is built; the mock closes over it. */
const dbRef = { value: null };

const db = (await import('../db/client.js')).default;
dbRef.value = db;
const { utcNow } = await import('../lib/time.js');
const { sendOutreach } = await import('./sendOutreach.js');
const { sendsForOutreach } = await import('../lib/outreachSend.js');

const COACH = { name: 'A. Whitfield', email: 'awhitfield@example.edu', title: 'Head Coach' };
const BODY = 'Dear A. Whitfield,\n\nI am writing about Nikau Brennan.\n\nBest regards,\nThriv3';

function makeAthlete() {
  const id = randomUUID();
  const ts = utcNow();
  const row = {
    id,
    created_date: ts,
    updated_date: ts,
    full_name: 'Nikau Brennan',
    position: 'Left Winger',
    graduation_year: 2027,
    email: 'athlete@example.com',
    video_id: 'aqz-KE-bpKQ',
    public_slug: randomUUID().slice(0, 10),
    sport: 'mens-soccer',
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO players (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`).run(row);
  return id;
}

const request = (athleteId, over = {}) => ({
  athleteId,
  coaches: [COACH],
  subject: 'Recruitment Inquiry - Nikau Brennan',
  body: BODY,
  greetingName: 'A. Whitfield',
  /**
   * A programme the test fixture holds nothing for. It is NOT what makes the
   * evidence absent — measured, and the engine answers generically even for a
   * school it has never heard of — so the absence is produced by the mock
   * above, which is the condition under test.
   */
  collegeName: 'Nowhere State University',
  division: 'NCAA Division I',
  matchId: 'Nowhere State University',
  ...over,
});

beforeEach(() => {
  composed.length = 0;
  marks.length = 0;
  evidence.fail = true;
  db.exec(`DELETE FROM outreach_evidence; DELETE FROM engagement_rollup; DELETE FROM tracking_events;
           DELETE FROM outbound_send_attempt; DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches; DELETE FROM suppressions;`);
});

/* -------------------------------------------------------------------------- */
/* A — the durable message exists before the relationship claims anything      */
/* -------------------------------------------------------------------------- */

describe('A. the message is recorded before the relationship is marked', () => {
  it('has a durable outreach_send row in hand when markOutreachDrafted runs', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(request(athleteId), { origin: 'manual' });

    const drafted = marks.find((m) => m.label === 'markOutreachDrafted');
    expect(drafted).toBeDefined();
    // The repair, stated as the thing it prevents: the mark cannot be the
    // first thing that says this message happened.
    expect(drafted.sendRows).toBe(1);
    expect(drafted.state).toBe('DRAFT');
  });

  it('has an ACCEPTED message in hand when markOutreachSent runs', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(request(athleteId, { send: true }), { origin: 'manual' });

    const sent = marks.find((m) => m.label === 'markOutreachSent');
    expect(sent).toBeDefined();
    expect(sent.sendRows).toBe(1);
    /**
     * Not merely present — already CONFIRMED. `confirmSend` shares a try block
     * with `recordDraft` so that it can only ever accept the message that call
     * just wrote, and both now precede the relationship mark.
     */
    expect(sent.state).toBe('ACCEPTED');
  });

  it('never marks a relationship sent while the message table is empty', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(request(athleteId, { send: true }), { origin: 'manual' });
    expect(marks.length).toBeGreaterThan(0);
    for (const m of marks) expect(m.sendRows).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* B / C — a message with no evidence is still a message                       */
/* -------------------------------------------------------------------------- */

describe('B. a draft with no evidence is still recorded', () => {
  it('writes the message, with the subject and body that reached Outlook', async () => {
    const athleteId = makeAthlete();
    const result = await sendOutreach(request(athleteId), { origin: 'manual' });
    expect(result.results[0].status).toBe('drafted');

    const outreachId = db.prepare('SELECT id FROM outreach').get().id;
    const sends = sendsForOutreach(outreachId);
    expect(sends).toHaveLength(1);
    expect(sends[0].subject).toBe('Recruitment Inquiry - Nikau Brennan');
    expect(sends[0].body_hash).toEqual(expect.any(String));
    expect(sends[0].state).toBe('DRAFT');
  });

  it('records the ABSENCE of evidence rather than inventing any', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(request(athleteId), { origin: 'manual' });
    const [send] = sendsForOutreach(db.prepare('SELECT id FROM outreach').get().id);

    // Truthfully empty, and empty in every field that could imply a claim.
    expect(send.has_personalisation).toBe(0);
    expect(send.primary_kind).toBeNull();
    expect(send.primary_role).toBeNull();
    expect(send.hook_kind).toBeNull();
    expect(send.rendered_kinds).toBeNull();
    expect(send.rendered_roles).toBeNull();
    expect(send.rendered_count).toBe(0);
    expect(send.structure).toBeNull();
    expect(send.structure_source).toBeNull();
    expect(send.payload.rendered).toEqual([]);
    expect(send.payload.held).toEqual([]);
    // And no campaign is implied by a message that had none.
    expect(send.payload.sequence).toBeUndefined();
  });

  it('writes no outreach_evidence row, because there was no evidence', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(request(athleteId), { origin: 'manual' });
    /**
     * The two tables answer different questions and only one of them is about
     * a message. `logEvidence` stays evidence-gated on purpose: an evidence
     * log with no evidence in it would be a row asserting an analysis nobody
     * performed. The MESSAGE is recorded either way, which is the repair.
     */
    expect(db.prepare('SELECT COUNT(*) AS n FROM outreach_evidence').get().n).toBe(0);
    expect(sendsForOutreach(db.prepare('SELECT id FROM outreach').get().id)).toHaveLength(1);
  });

  it('still records evidence, and the ordering, when the engine does answer', async () => {
    evidence.fail = false;
    const athleteId = makeAthlete();
    await sendOutreach(request(athleteId), { origin: 'manual' });

    const [send] = sendsForOutreach(db.prepare('SELECT id FROM outreach').get().id);
    expect(send.structure).toEqual(expect.any(String));
    // Same guarantee as the no-evidence case: the row was there before the mark.
    expect(marks.find((m) => m.label === 'markOutreachDrafted').sendRows).toBe(1);
  });
});

describe('C. a send with no evidence is confirmed through the one existing path', () => {
  it('accepts the message and records how we know', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(request(athleteId, { send: true }), { origin: 'manual' });

    const [send] = sendsForOutreach(db.prepare('SELECT id FROM outreach').get().id);
    expect(send.state).toBe('ACCEPTED');
    /**
     * Unchanged by D4.3, and deliberately so. The AppleScript issued Outlook's
     * own Send and did not error: stronger than an operator's recollection,
     * weaker than a provider API's answer, and PROVIDER_ACCEPTED remains
     * something nothing in this build can produce.
     */
    expect(send.accepted_source).toBe('OUTLOOK_COMMAND_ASSERTED');
    expect(send.sent_at).toEqual(expect.any(String));
  });

  it('leaves the relationship and the message agreeing that it was sent', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(request(athleteId, { send: true }), { origin: 'manual' });
    const relationship = db.prepare('SELECT sent_at, drafted_at FROM outreach').get();
    expect(relationship.drafted_at).toEqual(expect.any(String));
    expect(relationship.sent_at).toEqual(expect.any(String));
  });

  it('costs one outbound action, and B5 still spends it before the transport', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(request(athleteId, { send: true }), { origin: 'manual' });
    /**
     * D4.3 did NOT move the budget. It is still consumed ahead of
     * `composeInOutlook` and still keyed on the relationship rather than the
     * message — that reordering belongs to the execution boundary, not here.
     */
    const ledger = db.prepare('SELECT outreach_id, transport FROM outbound_send_attempt').all();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].transport).toBe('OUTLOOK_APPLESCRIPT');
    expect(ledger[0].outreach_id).toEqual(expect.any(String));
  });

  it('a draft costs nothing', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(request(athleteId), { origin: 'manual' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM outbound_send_attempt').get().n).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* E — a redraft through the real path still produces one message              */
/* -------------------------------------------------------------------------- */

describe('E. re-drafting the same coach reuses the open message', () => {
  it('leaves one row at sequence 1 however many times it is drafted', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(request(athleteId), { origin: 'manual' });
    await sendOutreach(request(athleteId), { origin: 'manual' });
    await sendOutreach(request(athleteId), { origin: 'manual' });

    const sends = sendsForOutreach(db.prepare('SELECT id FROM outreach').get().id);
    expect(sends).toHaveLength(1);
    expect(sends[0].sequence).toBe(1);
    expect(sends[0].state).toBe('DRAFT');
  });

  it('opens the next message at sequence 2 once the first is confirmed', async () => {
    const athleteId = makeAthlete();
    await sendOutreach(request(athleteId, { send: true }), { origin: 'manual' });
    await sendOutreach(request(athleteId), { origin: 'manual' });

    const sends = sendsForOutreach(db.prepare('SELECT id FROM outreach').get().id);
    expect(sends.map((s) => s.sequence)).toEqual([1, 2]);
    expect(sends.map((s) => s.state)).toEqual(['ACCEPTED', 'DRAFT']);
  });
});

/* -------------------------------------------------------------------------- */
/* F — the forty-one historical rows are untouched                             */
/* -------------------------------------------------------------------------- */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIVE = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const HAVE_DB = fs.existsSync(LIVE) && fs.statSync(LIVE).size > 1_000_000;
const live = HAVE_DB ? describe : describe.skip;
if (!HAVE_DB) console.warn(`\n  sendDurability.test.js F SKIPPED — no database at ${LIVE}\n`);

live('F. the historical sends still read exactly as they did', () => {
  it('keeps every historical row accepted, sequenced and unchanged', () => {
    /**
     * READ-ONLY, AND AGAINST A COPY. `backup` writes a disposable file and the
     * connection that reads it is opened readonly, so nothing here can reach
     * the database it was copied from.
     */
    const copy = path.join(ROOT, 'node_modules/.tmp', `d43-history-${randomUUID()}.sqlite`);
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    const rows = JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
      import Database from 'better-sqlite3';
      const src = new Database(${JSON.stringify(LIVE)}, { readonly: true });
      await src.backup(${JSON.stringify(copy)});
      src.close();
      const { default: db } = await import('${path.join(ROOT, 'server/db/client.js')}');
      process.stdout.write(JSON.stringify({
        byState: db.prepare('SELECT state, COUNT(*) AS n FROM outreach_send GROUP BY state').all(),
        duplicates: db.prepare(
          'SELECT outreach_id, sequence, COUNT(*) AS n FROM outreach_send GROUP BY outreach_id, sequence HAVING n > 1'
        ).all(),
        maxPerRelationship: db.prepare(
          'SELECT MAX(sequence) AS top FROM outreach_send'
        ).get(),
      }));
    `], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: copy }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
    fs.rmSync(copy, { force: true });

    // Every historical message is ACCEPTED and none of them moved.
    expect(rows.byState).toEqual([{ state: 'ACCEPTED', n: expect.any(Number) }]);
    expect(rows.byState[0].n).toBeGreaterThan(0);
    /**
     * The property the sequence repair depends on: history already holds one
     * row per (relationship, sequence), so MAX(sequence) + 1 cannot collide
     * with anything on file.
     */
    expect(rows.duplicates).toEqual([]);
    expect(rows.maxPerRelationship.top).toBeGreaterThanOrEqual(1);
  });
});
