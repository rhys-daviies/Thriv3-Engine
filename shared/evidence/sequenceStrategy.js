import { kindSpec, kindLabel } from './kinds.js';
import { ROLES } from './outreachEvidence.js';

/**
 * WHAT THE NEXT MESSAGE MAY SAY, GIVEN WHAT THE LAST ONE ALREADY SAID.
 *
 * The one thing the outbound evidence engine has never known: it composes each
 * email as though it were the only one. Ask it twice for the same athlete at
 * the same programme and it returns the same claims both times, because
 * nothing in it has ever been told that a message went out four days ago.
 * A follow-up built that way repeats the initial email's reasons back to a
 * coach who has already read them, which is worse than saying nothing new —
 * it advertises that nobody was paying attention.
 *
 * ---------------------------------------------------------------------------
 * IT IS NOT A SELECTOR, AND IT MUST NEVER BECOME ONE.
 *
 * `outreachEvidenceFor` decides what may be said: the licence, the confidence
 * floor, the qualification contract, the specificity ladder, the dedupe, the
 * caps, the dispositions. This module NARROWS that answer and can never widen
 * it. It reads a finished result and reports which of its already-permitted
 * claims are still unused — so a denied kind cannot become available because
 * a permitted one was excluded, and there is nothing here that could make it.
 *
 * The output is a PREFERENCE LIST, which is the shape the existing engine
 * already accepts: `applyPrefer` chooses among what the licence permitted, and
 * naming a subset is how you narrow it. No new selection surface, no second
 * ranking policy, no change to any existing evidence file.
 * ---------------------------------------------------------------------------
 *
 * NOTHING HERE GENERATES COPY, AND NOTHING HERE WRITES. It answers a question
 * about which claims are available. What a follow-up actually says, and
 * whether it is composed at all, is C3's.
 */

/**
 * The sequence policy in force. SEPARATE FROM `OUTREACH_POLICY_VERSION`, and
 * deliberately so — the two describe different things and will move at
 * different times.
 *
 *   P3    what a claim may assert, how it is qualified, and how it is worded.
 *         A P2 email and a P3 email are different products.
 *   ESP1  how a PREVIOUS message affects what the next one may draw on.
 *
 * A change to one is not a change to the other: retiring a kind's licence
 * would bump P3 and leave this untouched, and allowing a follow-up two new
 * reasons instead of one would bump this and leave P3 alone. Folding them into
 * one number would make every later comparison ambiguous about which policy
 * moved.
 *
 * ESP1 — a follow-up draws on connections the initial message did not use, one
 * body claim at a time, and invents nothing when none remain.
 */
export const EVIDENCE_SEQUENCE_POLICY_VERSION = 'ESP1';

/**
 * The deepest campaign-local step this policy describes.
 *
 * PP1 permits one initial message and one follow-up per coach, and this stops
 * exactly where that stops. A caller asking for step 3 has not found a gap in
 * the policy — it has a bug, or it is executing a sequence B6 would refuse to
 * plan. Answering it would let a third message be composed with no
 * personalisation rather than not composed at all, so this refuses instead.
 */
export const MAX_SEQUENCE_STEP = 2;

/**
 * How many BODY claims a follow-up may draw on. One.
 *
 * Not a guess: composition already renders exactly one body claim beside the
 * hook — `planFromRoles` takes `body.slice(0, 1)` and holds the rest — so a
 * follow-up permitted two would have the second held and never read. One is
 * also what a second message is for. The first email made the case; the second
 * re-opens the conversation with one thing the coach has not been told. A
 * follow-up carrying three fresh reasons is not persistence, it is a second
 * scouting report, and it reads as a mail-merge cadence rather than a person
 * following up.
 *
 * Zero is a legitimate outcome and is not an error — see NO_NEW_EVIDENCE.
 */
export const MAX_FOLLOW_UP_EVIDENCE = 1;

/**
 * WHAT THIS MESSAGE'S EVIDENCE SITUATION IS.
 *
 *   INITIAL           step 1. Production's own selection stands, untouched.
 *   NEW_EVIDENCE      a follow-up has at least one unused connection to draw on.
 *   NO_NEW_EVIDENCE   everything permitted here has already been said. Valid,
 *                     and not an error: C3 may still write a short follow-up
 *                     that makes no new claim, and must not be handed an
 *                     invented one.
 */
export const SEQUENCE_STATUS = Object.freeze({
  INITIAL: 'INITIAL',
  NEW_EVIDENCE: 'NEW_EVIDENCE',
  NO_NEW_EVIDENCE: 'NO_NEW_EVIDENCE',
});

/**
 * WHY A PERMITTED CLAIM IS OR IS NOT THIS MESSAGE'S.
 *
 * These live HERE rather than in `outreachEvidenceFor`'s dispositions, and the
 * separation is the point. That vocabulary answers "may this be said at all" —
 * NOT_LICENSED, DENIED, BELOW_CONFIDENCE, UNQUALIFIED, DEDUPED, OVER_CAP, HELD
 * — and every one of them is a property of the claim. These answer "has this
 * already been said to this coach in this campaign", which is a property of
 * the CONVERSATION and changes with no change to the evidence at all.
 *
 * Overloading DEDUPED would have been the tempting shortcut and would have
 * been wrong twice: a previously-used claim is not a restatement of another
 * claim, and the disposition list is read by the operator panel and pinned by
 * a behavioural baseline. A sequence layer must not move either.
 */
export const SEQUENCE_REASON = Object.freeze({
  /** Step 1: nothing has been said yet, so nothing is withheld. */
  FIRST_MESSAGE: 'FIRST_MESSAGE',
  /** Chosen: this connection has not been put to this coach in this campaign. */
  UNUSED_CONNECTION: 'UNUSED_CONNECTION',
  /** Withheld: an accepted message in this campaign already made this point. */
  PREVIOUSLY_SENT: 'PREVIOUSLY_SENT',
  /** Withheld: the message currently open on this relationship already uses it. */
  IN_OPEN_DRAFT: 'IN_OPEN_DRAFT',
  /** Withheld: a stronger unused connection took the follow-up's one slot. */
  OVER_FOLLOW_UP_CAP: 'OVER_FOLLOW_UP_CAP',
  /**
   * Withheld: a congratulation is not a reason to write again.
   *
   * `outreachEvidenceFor` already holds that recognition is not
   * personalisation — `hasPersonalisation` counts hooks and relevance and
   * excludes it. This applies the same rule across messages rather than
   * inventing a second opinion of it.
   */
  RECOGNITION_NOT_A_REASON: 'RECOGNITION_NOT_A_REASON',
});

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * THE IDENTITY A REASON IS REMEMBERED BY: its dedupe group, not its kind.
 *
 * The kind is what gets stored — `outreach_send.rendered_kinds` is a list of
 * them — but the GROUP is what a coach experiences. "You have a New Zealander
 * on the roster now" and "you've had New Zealanders before" are two kinds and
 * one connection, and `international-connection` is the registry's own name
 * for that fact. A follow-up allowed to use the second because the first was
 * technically a different kind would be saying the same thing again in
 * different words, which is precisely the false corroboration the licence
 * layer refuses WITHIN a message.
 *
 * So identity is derived from the registry and nothing is invented: no hash,
 * no fact tuple, no parsed English. Rendered wording can change entirely — a
 * copy revision, a different structure — and the identity does not move,
 * because it never depended on the words.
 *
 * WHAT THIS DELIBERATELY CANNOT DISTINGUISH: two POSITION_GRADUATION claims
 * whose underlying numbers differ. Within one campaign — a fortnight, one
 * frozen roster season — they do not differ, and telling them apart would need
 * per-claim facts that no message record stores. Noted rather than
 * approximated; see the persistence note at the foot of this file.
 */
export const identityOf = (kind) => kindSpec(kind)?.dedupeGroup ?? null;

/** Every group named by a list of kinds, unknown kinds dropped rather than guessed. */
function groupsOf(kinds = []) {
  const out = new Map();
  for (const kind of kinds) {
    if (typeof kind !== 'string' || !kind) continue;
    let group = null;
    try { group = identityOf(kind); } catch { group = null; }
    if (!group) continue;
    if (!out.has(group)) out.set(group, kind);
  }
  return out;
}

/**
 * WHAT THE NEXT MESSAGE TO THIS COACH MAY DRAW ON.
 *
 * Pure. It reads a finished evidence result and two lists of kind names, and
 * returns a decision. It performs no query, writes nothing, composes nothing,
 * and cannot reach an evidence object the licence did not already permit.
 *
 * @param {object} args.outreach   an `outreachEvidenceFor` result, WHOLE. The
 *   licensed set, with its roles and its alternatives — this narrows it and
 *   never re-derives it.
 * @param {number} args.step       the CAMPAIGN-LOCAL step, from B6. 1 is the
 *   initial message of this campaign to this coach, 2 the one follow-up. It is
 *   never a lifetime `outreach_send.sequence`: a coach an earlier campaign
 *   wrote to twice begins a new campaign at step 1, and must be able to hear
 *   the same reason a new cycle later.
 * @param {string[]} [args.previouslySentKinds]  kinds RENDERED in accepted
 *   messages of this campaign to this coach. What the coach has read.
 * @param {string[]} [args.openDraftKinds]  kinds in the message currently open
 *   on this relationship, if one is being regenerated. What the coach has NOT
 *   read — kept separate for exactly that reason.
 */
export function evidenceStrategyForMessage({
  outreach, step, previouslySentKinds = [], openDraftKinds = [],
} = {}) {
  if (!outreach || !Array.isArray(outreach.hooks) || !Array.isArray(outreach.relevance)) {
    throw fail(
      'OUTREACH_RESULT_REQUIRED',
      'A sequence strategy needs an outreachEvidenceFor result: it narrows what the '
      + 'licence already permitted and must never be asked to decide that itself.',
    );
  }
  if (!Number.isInteger(step) || step < 1) {
    throw fail('INVALID_SEQUENCE_STEP', `A campaign-local step must be a positive integer, got ${JSON.stringify(step)}`);
  }
  if (step > MAX_SEQUENCE_STEP) {
    throw fail(
      'UNSUPPORTED_SEQUENCE_STEP',
      `${EVIDENCE_SEQUENCE_POLICY_VERSION} describes ${MAX_SEQUENCE_STEP} messages per coach `
      + `and was asked for step ${step}. The pursuit policy plans an initial message and one `
      + 'follow-up; a third has no evidence policy, and composing one without personalisation '
      + 'would be worse than not composing it.',
    );
  }

  /**
   * Everything the licence permitted, in the order it permitted it.
   *
   * Survivors only. `alternatives` are same-connection siblings whose group is
   * already represented, so offering one as a follow-up's "new" reason would
   * be the repetition this whole module exists to prevent.
   */
  const available = [
    ...outreach.hooks.map((i) => ({ ...i, group: identityOf(i.kind) })),
    ...outreach.relevance.map((i) => ({ ...i, group: identityOf(i.kind) })),
    ...(outreach.recognition ?? []).map((i) => ({ ...i, group: identityOf(i.kind) })),
  ];

  /* ---- step 1: production's own answer, untouched ------------------------ */
  if (step === 1) {
    return {
      sequencePolicyVersion: EVIDENCE_SEQUENCE_POLICY_VERSION,
      step,
      status: SEQUENCE_STATUS.INITIAL,
      available,
      previouslyUsed: [],
      /**
       * NULL, NOT A LIST, AND THE DIFFERENCE IS THE WHOLE OF §6.
       *
       * Null means "this layer has no opinion; send what the engine chose".
       * A caller passes it straight through and `applyPrefer` is never invoked
       * with it, so an initial email is composed by exactly the code that
       * composes it today and is byte-identical. Returning the same kinds as a
       * list would LOOK equivalent and would not be: a prefer list makes the
       * result operator-selected, rewrites its dispositions and sets
       * `operator_selected` in the stored payload.
       */
      preferredForThisMessage: null,
      notPreferred: [],
      reasons: [{ code: SEQUENCE_REASON.FIRST_MESSAGE, detail: null }],
    };
  }

  /* ---- step 2: the follow-up -------------------------------------------- */
  const sentGroups = groupsOf(previouslySentKinds);
  const draftGroups = groupsOf(openDraftKinds);

  const previouslyUsed = [
    ...[...sentGroups].map(([group, kind]) => ({ kind, group, source: 'SENT' })),
    ...[...draftGroups]
      .filter(([group]) => !sentGroups.has(group))
      .map(([group, kind]) => ({ kind, group, source: 'OPEN_DRAFT' })),
  ];

  const notPreferred = [];
  const chosen = [];

  for (const item of available) {
    if (sentGroups.has(item.group)) {
      notPreferred.push({
        kind: item.kind,
        group: item.group,
        reason: SEQUENCE_REASON.PREVIOUSLY_SENT,
        detail: sameThingAlreadySaid(sentGroups.get(item.group), item.kind),
      });
      continue;
    }
    if (draftGroups.has(item.group)) {
      notPreferred.push({
        kind: item.kind, group: item.group, reason: SEQUENCE_REASON.IN_OPEN_DRAFT, detail: null,
      });
      continue;
    }
    /**
     * A congratulation cannot carry a follow-up.
     *
     * It may still accompany one — the caller passes the whole preference list
     * to `applyPrefer`, which applies MAX_RECOGNITION itself — but an unused
     * CONFERENCE_TITLE is not a reason to write to somebody a second time, and
     * a policy that counted it would report NEW_EVIDENCE for a message whose
     * only new content is "well done on the season". The licence layer already
     * excludes recognition from `hasPersonalisation`; this is the same rule
     * across messages rather than a second opinion of it.
     */
    if (item.role === ROLES.RECOGNITION) {
      notPreferred.push({
        kind: item.kind, group: item.group,
        reason: SEQUENCE_REASON.RECOGNITION_NOT_A_REASON, detail: null,
      });
      continue;
    }
    if (chosen.length >= MAX_FOLLOW_UP_EVIDENCE) {
      notPreferred.push({
        kind: item.kind, group: item.group,
        reason: SEQUENCE_REASON.OVER_FOLLOW_UP_CAP, detail: null,
      });
      continue;
    }
    chosen.push(item);
  }

  /**
   * NOTHING LEFT IS A VALID ANSWER, AND IT IS NOT AN ERROR.
   *
   * The alternative would be a fallback that repeats an initial claim, and
   * ESP1 deliberately has none. Repetition is a COPY decision — whether a
   * follow-up should briefly recall what the first message said, in its own
   * voice — and answering it here would dress a copy choice as an evidence
   * one. C3 owns it, and it can only own it if this layer says plainly that
   * there is nothing new rather than quietly handing back the old.
   *
   * The empty ARRAY matters as much as the status: unlike step 1's null, it
   * says "this layer does have an opinion, and the opinion is none".
   */
  return {
    sequencePolicyVersion: EVIDENCE_SEQUENCE_POLICY_VERSION,
    step,
    status: chosen.length ? SEQUENCE_STATUS.NEW_EVIDENCE : SEQUENCE_STATUS.NO_NEW_EVIDENCE,
    available,
    previouslyUsed,
    preferredForThisMessage: chosen.map((i) => i.kind),
    notPreferred,
    reasons: chosen.map((i) => ({ code: SEQUENCE_REASON.UNUSED_CONNECTION, detail: i.kind })),
  };
}

/**
 * Why a claim is being held back, in words an operator could read.
 *
 * The registry's LABEL, never its key — the same rule `sameConnectionAs` in
 * outreachEvidence.js learned when a panel baseline printed a constant at a
 * human.
 */
function sameThingAlreadySaid(sentKind, candidateKind) {
  return sentKind === candidateKind
    ? 'already sent to this coach in this campaign'
    : `the same connection as ${kindLabel(sentKind).toLowerCase()}, which this campaign has already sent`;
}

/**
 * WHAT A MESSAGE WILL EVENTUALLY HAVE TO REMEMBER, and what it already does.
 *
 * `outreach_send` stores enough for this policy TODAY and needs no schema
 * change: `rendered_kinds` names what the coach actually read,
 * `programme_campaign_id` scopes it to one campaign, `state` says whether it
 * was accepted, and `payload.rendered` carries the claim-by-claim record.
 * That is why this module takes kind names and not evidence objects.
 *
 * What a future message SHOULD additionally carry, when C3 integrates:
 *
 *   sequence_policy_version   which policy chose its evidence. Nothing stores
 *                             ESP1 today because nothing has run under it.
 *   campaign_local_step       B6 derives it from accepted messages, so it is
 *                             recomputable and is not yet worth storing.
 *   exclusion basis           the kinds withheld as previously sent, if a
 *                             later analysis wants to ask what a follow-up
 *                             could have said and did not.
 *
 * None of it is added here. A column nothing writes is the mistake B4 made
 * with `next_action_at`, and the first thing that should touch these is the
 * code that produces them.
 */
