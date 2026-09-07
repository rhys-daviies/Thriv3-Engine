import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import db from '../db/client.js';
import {
  recordDraft, confirmSend, nextSequence, confirmedSends, sendsForOutreach, sendById, sendsByPolicy,
} from './outreachSend.js';
import { buildSendSnapshot, bodyHash } from '../../shared/evidence/sendSnapshot.js';
import { OUTREACH_POLICY_VERSION, LEGACY_POLICY_VERSION, comparablePolicies, KNOWN_POLICY_VERSIONS } from '../../shared/evidence/outreachPolicy.js';

/**
 * ONE EMAIL, ONE ROW, FOREVER.
 *
 * The model this replaces held one evidence row per athlete-coach pair and
 * upserted it, so a follow-up would have overwritten the record of the message
 * before it — and the analytics fields H17 and H18 defined (`hook_kind`,
 * `primary_role`, `has_personalisation`) were computed and written nowhere at
 * all. These tests fix both, and fix the direction the fields are derived
 * from: RENDERED, never selected.
 */

beforeEach(() => {
  db.exec('DELETE FROM outreach_send; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches;');
  db.prepare("INSERT INTO players (id, full_name, position, sport, created_date, updated_date) VALUES ('a1', 'Rhys Davies', 'DEFENSE', 'mens-soccer', '2026-01-01', '2026-01-01')").run();
  db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, sport) VALUES ('c1', '2026-01-01', 'Sam Baker', 'sam@x.test', 'Jacksonville', 'mens-soccer')").run();
  db.prepare("INSERT INTO outreach (id, athlete_id, coach_id, token, created_at) VALUES ('o1','a1','c1','tok1','2026-01-01')").run();
});

/** A composition, in the shape `evidenceFor` produces one. */
const evidenceWith = (sentences, { held = [], structure = 'PLAYER_FIRST' } = {}) => ({
  structure: { key: structure, source: 'ENGINE' },
  engineSelected: sentences.map((s) => s.kind),
  composition: {
    sentences: sentences.map((s, i) => ({ order: i, ...s })),
    placement: [
      ...sentences.map((s, i) => ({ order: i, kind: s.kind, slot: s.slot, displayed: true })),
      ...held.map((k, i) => ({ order: sentences.length + i, kind: k, slot: null, displayed: false })),
    ],
  },
});

const HOOK = { slot: 'HOOK', kind: 'COACH_ARRIVAL_SAME_COUNTRY', text: 'you brought Joby Reid in from New Zealand in 2026' };
const RELEVANCE = { slot: 'RELEVANCE', kind: 'POSITION_GRADUATION', text: 'two defenders are listed to graduate in 2027 — A and B' };
const RECOGNITION = { slot: 'RECOGNITION', kind: 'CONFERENCE_TITLE', text: 'Congrats on winning the ACC last year as well — looks like a great season.' };

const draft = (evidence, over = {}) => recordDraft({
  outreachId: 'o1', athleteId: 'a1', coachId: 'c1', collegeName: 'Jacksonville',
  sport: 'mens-soccer', evidence, body: 'Hi Coach\n\nbody', subject: 'Rhys Davies | Defender',
  bodySource: 'STRUCTURED', templateVariant: 'default', ...over,
});

/* -------------------------------------------------------------------------- */

describe('a send event is a confirmed email, and nothing less', () => {
  it('records a draft without counting it as a send', () => {
    draft(evidenceWith([HOOK]));
    expect(sendsForOutreach('o1')).toHaveLength(1);
    expect(sendsForOutreach('o1')[0].sent_at).toBe(null);
    // The denominator I1 found trustworthy, and it does not move for a draft.
    expect(confirmedSends()).toHaveLength(0);
  });

  it('becomes a send when something we observed sent it', () => {
    draft(evidenceWith([HOOK]));
    confirmSend('o1');
    expect(confirmedSends()).toHaveLength(1);
    expect(confirmedSends()[0].sent_at).toEqual(expect.any(String));
  });

  it('re-drafting replaces the open draft rather than creating a second send', () => {
    // A redraft is not a follow-up. `outreach.drafted_at` has always
    // overwritten for exactly this reason.
    const first = draft(evidenceWith([HOOK]));
    const second = draft(evidenceWith([RELEVANCE]));
    expect(second.id).toBe(first.id);
    expect(second.sequence).toBe(1);
    expect(sendsForOutreach('o1')).toHaveLength(1);
    expect(sendsForOutreach('o1')[0].rendered_kinds).toBe('POSITION_GRADUATION');
  });

  it('confirming twice does not move the timestamp or add a row', () => {
    draft(evidenceWith([HOOK]));
    const a = confirmSend('o1', '2026-05-01T00:00:00Z');
    const b = confirmSend('o1', '2026-06-01T00:00:00Z');
    expect(b).toBe(null);            // nothing left open
    expect(sendById(a.id).sent_at).toBe('2026-05-01T00:00:00Z');
    expect(sendsForOutreach('o1')).toHaveLength(1);
  });

  it('has nothing to confirm for a relationship drafted before this table', () => {
    expect(confirmSend('o1')).toBe(null);
  });
});

describe('sequence, and the follow-up nobody sends yet', () => {
  it('numbers the initial approach 1', () => {
    expect(nextSequence('o1')).toBe(1);
    draft(evidenceWith([HOOK]));
    expect(sendsForOutreach('o1')[0].sequence).toBe(1);
  });

  it('advances only on a confirmed send, never on a redraft', () => {
    draft(evidenceWith([HOOK]));
    draft(evidenceWith([HOOK]));
    expect(nextSequence('o1')).toBe(1);
    confirmSend('o1');
    expect(nextSequence('o1')).toBe(2);
  });

  it('keeps send 1 byte-for-byte when send 2 is written', () => {
    /**
     * THE PROPERTY THE OLD MODEL COULD NOT OFFER. One `outreach_evidence` row
     * per pair, upserted: a follow-up would have replaced the first email's
     * account of itself, and no analysis afterwards could have known.
     */
    draft(evidenceWith([HOOK]));
    confirmSend('o1', '2026-05-01T00:00:00Z');
    const before = JSON.stringify(sendsForOutreach('o1')[0]);

    draft(evidenceWith([RELEVANCE, RECOGNITION]));
    confirmSend('o1', '2026-06-01T00:00:00Z');

    const sends = sendsForOutreach('o1');
    expect(sends).toHaveLength(2);
    expect(sends.map((s) => s.sequence)).toEqual([1, 2]);
    expect(JSON.stringify(sends[0])).toBe(before);
    expect(sends[0].rendered_kinds).toBe('COACH_ARRIVAL_SAME_COUNTRY');
    expect(sends[1].rendered_kinds).toBe('POSITION_GRADUATION,CONFERENCE_TITLE');
  });

  it('refuses a duplicate sequence outright', () => {
    draft(evidenceWith([HOOK]));
    confirmSend('o1');
    expect(() => db.prepare(`
      INSERT INTO outreach_send (id, outreach_id, sequence, athlete_id, coach_id, policy_version, created_at)
      VALUES ('dupe', 'o1', 1, 'a1', 'c1', 'P2', '2026-01-01')
    `).run()).toThrow(/UNIQUE/i);
  });
});

describe('the snapshot describes what was rendered', () => {
  it('reads a hook from the hook slot, and calls it the primary', () => {
    draft(evidenceWith([HOOK, RELEVANCE], { structure: 'RELATIONSHIP_FIRST' }));
    const s = sendsForOutreach('o1')[0];
    expect(s.hook_kind).toBe('COACH_ARRIVAL_SAME_COUNTRY');
    expect(s.primary_kind).toBe('COACH_ARRIVAL_SAME_COUNTRY');
    expect(s.primary_role).toBe('HOOK');
    expect(s.has_personalisation).toBe(1);
    expect(s.rendered_roles).toBe('HOOK,RELEVANCE');
  });

  it('records no hook when the flow has no hook slot', () => {
    // In PLAYER_FIRST a hook claim renders in the RELEVANCE block. There is no
    // hook, and inventing one would misreport where the email led.
    draft(evidenceWith([RELEVANCE]));
    const s = sendsForOutreach('o1')[0];
    expect(s.hook_kind).toBe(null);
    expect(s.primary_kind).toBe('POSITION_GRADUATION');
    expect(s.primary_role).toBe('RELEVANCE');
  });

  it('does not count a congratulation as personalisation', () => {
    // Recognition alone says nothing about whether THIS athlete belongs at
    // THIS programme. `outreachEvidenceFor` owns the rule; this records it.
    draft(evidenceWith([RECOGNITION]));
    const s = sendsForOutreach('o1')[0];
    expect(s.has_personalisation).toBe(0);
    expect(s.primary_kind).toBe(null);
    expect(s.primary_role).toBe(null);
    expect(s.rendered_kinds).toBe('CONFERENCE_TITLE');
  });

  it('never names recognition as the primary, even beside a claim', () => {
    draft(evidenceWith([RECOGNITION, RELEVANCE]));
    expect(sendsForOutreach('o1')[0].primary_role).not.toBe('RECOGNITION');
    expect(sendsForOutreach('o1')[0].primary_kind).toBe('POSITION_GRADUATION');
  });

  it('records a generic email as generic, and invents no kind for it', () => {
    draft(evidenceWith([]));
    const s = sendsForOutreach('o1')[0];
    expect(s.has_personalisation).toBe(0);
    expect(s.rendered_kinds).toBe(null);
    expect(s.rendered_count).toBe(0);
    expect(s.primary_kind).toBe(null);
    expect(s.hook_kind).toBe(null);
    expect(s.payload.rendered).toEqual([]);
  });

  it('derives from RENDERED, not from selected', () => {
    /**
     * 232 claims across the H18 corpus are selected, qualified and held back
     * by the body cap. Counting them would credit an angle no coach read.
     */
    const ev = evidenceWith([RELEVANCE], { held: ['ACADEMIC_FIT', 'HISTORICAL_SAME_REGION'] });
    draft(ev);
    const s = sendsForOutreach('o1')[0];
    expect(s.rendered_kinds).toBe('POSITION_GRADUATION');
    expect(s.rendered_count).toBe(1);
    // Held is kept, and kept separate: "we had this and chose not to say it".
    expect(s.payload.held).toEqual(['ACADEMIC_FIT', 'HISTORICAL_SAME_REGION']);
  });

  it('narrows to what the operator actually left in the body', () => {
    // An operator who deletes the supporting paragraph delivered one claim of
    // two, and logging two would inflate that angle by exactly the cut.
    draft(evidenceWith([HOOK, RELEVANCE], { structure: 'RELATIONSHIP_FIRST' }),
      { renderedKinds: new Set(['COACH_ARRIVAL_SAME_COUNTRY']) });
    const s = sendsForOutreach('o1')[0];
    expect(s.rendered_kinds).toBe('COACH_ARRIVAL_SAME_COUNTRY');
    expect(s.rendered_count).toBe(1);
  });

  it('stores the sentences with their text', () => {
    draft(evidenceWith([HOOK]));
    const s = sendsForOutreach('o1')[0];
    expect(s.payload.rendered[0].text).toBe(HOOK.text);
    expect(s.payload.rendered[0].slot).toBe('HOOK');
  });

  it('represents all ten licensed kinds', () => {
    // Some are rare in the live corpus; the snapshot must hold any of them.
    const KINDS = ['COACH_ARRIVAL_SAME_COUNTRY', 'ARRIVAL_SAME_COUNTRY_POSITION',
      'HISTORICAL_SAME_COUNTRY', 'CURRENT_SAME_COUNTRY', 'ARRIVAL_SAME_REGION_POSITION',
      'HISTORICAL_SAME_REGION', 'POSITION_GRADUATION', 'ACADEMIC_FIT',
      'CONFERENCE_TITLE', 'POSTSEASON_RESULT'];
    for (const kind of KINDS) {
      const slot = ['CONFERENCE_TITLE', 'POSTSEASON_RESULT'].includes(kind) ? 'RECOGNITION' : 'RELEVANCE';
      const snap = buildSendSnapshot({ evidence: evidenceWith([{ slot, kind, text: `a claim about ${kind}` }]) });
      expect(snap.rendered_kinds, kind).toBe(kind);
      expect(snap.payload.rendered[0].kind, kind).toBe(kind);
    }
  });
});

describe('the body hash', () => {
  it('is stable for the same body and moves for a different one', () => {
    expect(bodyHash('hello')).toBe(bodyHash('hello'));
    expect(bodyHash('hello')).not.toBe(bodyHash('hello.'));
    expect(bodyHash('x')).toHaveLength(64);
  });

  it('ignores the per-relationship profile link, as H18 does', () => {
    // A token rotation is not a changed email. Same boundary, same reason.
    const a = 'Hi\n\nhttps://app.test/p/rhys.html?ref=TOKENA\n\nBest';
    const b = 'Hi\n\nhttps://app.test/p/rhys.html?ref=TOKENB\n\nBest';
    expect(bodyHash(a)).toBe(bodyHash(b));
  });

  it('is the hash of the body that was actually sent', () => {
    // The snapshot must carry THIS email, not a constant and not a re-render.
    const ev = evidenceWith([HOOK]);
    const a = buildSendSnapshot({ evidence: ev, body: 'Hi Coach\n\nfirst body' });
    const b = buildSendSnapshot({ evidence: ev, body: 'Hi Coach\n\nsecond body' });
    expect(a.body_hash).toBe(bodyHash('Hi Coach\n\nfirst body'));
    expect(a.body_hash).not.toBe(b.body_hash);
  });

  it('is null when no body was captured', () => {
    expect(buildSendSnapshot({ evidence: evidenceWith([]) }).body_hash).toBe(null);
  });
});

describe('policy version', () => {
  it('stamps a current send with the current policy', () => {
    draft(evidenceWith([HOOK]));
    expect(sendsForOutreach('o1')[0].policy_version).toBe(OUTREACH_POLICY_VERSION);
    /**
     * P3 since J8. J3 changed licensing, qualification and selection, J4 added
     * a cross-group hold and J7 changed copy — all on the bump list — while
     * the constant stayed at P2.
     */
    expect(OUTREACH_POLICY_VERSION).toBe('P3');
  });

  it('cannot silently disappear', () => {
    expect(() => db.prepare(`
      INSERT INTO outreach_send (id, outreach_id, sequence, athlete_id, coach_id, created_at)
      VALUES ('nopolicy', 'o1', 9, 'a1', 'c1', '2026-01-01')
    `).run()).toThrow(/NOT NULL/i);
  });

  it('has one owner, and keeps every version it has ever shipped', () => {
    // P2 is retired and still known: a row carrying it must be nameable, not
    // treated as corruption, and never rewritten.
    expect(KNOWN_POLICY_VERSIONS).toEqual([LEGACY_POLICY_VERSION, 'P2', OUTREACH_POLICY_VERSION]);
    expect(LEGACY_POLICY_VERSION).toBe('LEGACY_UNKNOWN');
  });

  it('refuses to pool legacy rows with each other or with current ones', () => {
    // We do not know WHICH pre-P2 policy produced any legacy send, so two of
    // them are not known to be comparable either.
    expect(comparablePolicies('P2', 'P2')).toBe(true);
    expect(comparablePolicies(LEGACY_POLICY_VERSION, LEGACY_POLICY_VERSION)).toBe(false);
    expect(comparablePolicies('P2', LEGACY_POLICY_VERSION)).toBe(false);
  });

  it('lets analytics ask for one policy at a time', () => {
    draft(evidenceWith([HOOK]));
    confirmSend('o1');
    db.prepare(`
      INSERT INTO outreach_send (id, outreach_id, sequence, sent_at, athlete_id, coach_id, policy_version, created_at)
      VALUES ('legacy-x', 'o1', 7, '2026-01-01', 'a1', 'c1', 'LEGACY_UNKNOWN', '2026-01-01')
    `).run();
    expect(confirmedSends({ policyVersion: OUTREACH_POLICY_VERSION })).toHaveLength(1);
    expect(confirmedSends({ policyVersion: LEGACY_POLICY_VERSION })).toHaveLength(1);
    expect(confirmedSends()).toHaveLength(2);
    expect(sendsByPolicy().map((r) => r.policy_version).sort())
      .toEqual(['LEGACY_UNKNOWN', OUTREACH_POLICY_VERSION].sort());
  });
});

describe('analytics reads the snapshot, and cannot reach the engine', () => {
  it('imports no evidence engine, at any depth', async () => {
    /**
     * THE POINT OF THE WHOLE STAGE.
     *
     * A stored sentence from a real 2026 send reads "you've got three
     * defenders graduating in 2027 (…)". The same programme re-rendered today
     * says "three defenders are listed to graduate in 2027 — …". Anything that
     * can rebuild a historical decision will eventually rebuild it, from data
     * that has moved, and produce an email nobody received.
     *
     * Asserted on the SOURCE rather than by mocking, because the failure mode
     * is a future edit adding an import — which a mock would not notice.
     */
    const src = readFileSync(new URL('./outreachSend.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const forbidden of ['evidenceFor', 'outreachEvidenceFor', 'outreachCopyFor',
      'generateEvidence', 'evidenceQueries', 'outreachCopy.js', 'outreachEvidence.js']) {
      expect(code, `analytics must not reach ${forbidden}`).not.toContain(forbidden);
    }
    // The snapshot builder is the only evidence module it may touch, and that
    // one reads an already-produced result rather than producing one.
    const snap = readFileSync(new URL('../../shared/evidence/sendSnapshot.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const forbidden of ['evidenceFor', 'outreachEvidenceFor', 'outreachCopyFor']) {
      expect(snap, `the snapshot must not reach ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('returns the stored text, whatever the engine would say now', () => {
    draft(evidenceWith([{ slot: 'RELEVANCE', kind: 'POSITION_GRADUATION', text: "you've got three defenders graduating in 2027" }]));
    confirmSend('o1');
    // The wording no current renderer produces. It is what the coach read.
    expect(confirmedSends()[0].payload.rendered[0].text)
      .toBe("you've got three defenders graduating in 2027");
  });
});

describe('failure states leave no false send', () => {
  it('records nothing when the snapshot cannot be built', () => {
    expect(() => recordDraft({
      outreachId: 'o1', athleteId: 'a1', coachId: 'c1', evidence: null,
    })).not.toThrow();
    // A null evidence result still produces a valid, empty, generic snapshot —
    // it does not throw and it does not claim personalisation.
    expect(sendsForOutreach('o1')[0].has_personalisation).toBe(0);
    expect(confirmedSends()).toHaveLength(0);
  });

  it('leaves a draft unconfirmed when nothing confirmed it', () => {
    // The transport failing after `recordDraft` is exactly this state: a row
    // exists, `sent_at` is null, and no denominator counts it.
    draft(evidenceWith([HOOK]));
    expect(sendsForOutreach('o1')).toHaveLength(1);
    expect(confirmedSends()).toHaveLength(0);
  });

  it('refuses a send event for an outreach that does not exist', () => {
    expect(() => recordDraft({
      outreachId: 'nope', athleteId: 'a1', coachId: 'c1', evidence: evidenceWith([HOOK]),
    })).toThrow(/FOREIGN KEY/i);
  });

  it('is idempotent under duplicate invocation', () => {
    draft(evidenceWith([HOOK]));
    draft(evidenceWith([HOOK]));
    draft(evidenceWith([HOOK]));
    confirmSend('o1');
    confirmSend('o1');
    expect(confirmedSends()).toHaveLength(1);
  });
});
