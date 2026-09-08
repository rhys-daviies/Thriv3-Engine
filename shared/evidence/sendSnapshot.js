import { createHash } from 'node:crypto';
import { OUTREACH_POLICY_VERSION } from './outreachPolicy.js';

/**
 * WHAT ONE EMAIL SAID, FROZEN AT THE MOMENT IT SAID IT.
 *
 * I1 asked whether analytics could answer "what evidence was actually used in
 * this email" from stored state, and the answer was half. The prose was
 * stored; the decision was not. `hook_kind`, `primary_role` and
 * `has_personalisation` — the three fields H17 and H18 spent two stages
 * defining — were computed at send time by `evidenceLogPayload` and written
 * nowhere. The grouping columns Stage I needs were being thrown away.
 *
 * Worse, what WAS stored could be overwritten: one `outreach_evidence` row per
 * athlete-coach pair, upserted, so a second email would replace the first
 * email's record of itself.
 *
 * ---------------------------------------------------------------------------
 * RENDERED, NEVER SELECTED.
 *
 * Every field below is derived from `composition.sentences` — the claims that
 * actually appear in the body — and not from `selected`, `roles` or
 * `alternatives`. The difference is not academic: 232 claims across the H18
 * corpus are selected, qualified and deliberately held back by the body cap,
 * and counting them would credit an angle that no coach ever read. H18 pinned
 * that the two agree today; this makes the STORED record derive from the side
 * that is true by construction.
 *
 * NOTHING IS RECOMPUTED. This takes the already-produced result and the body
 * as it was about to be sent. It never calls `evidenceFor`, `outreachEvidenceFor`
 * or `outreachCopyFor`, and it must never learn how: the moment a snapshot can
 * be rebuilt, it will be rebuilt from data that has moved underneath it.
 */

/**
 * The sequence decision, flattened to what a later reader actually needs.
 *
 * Not the whole strategy object: `available` restates the licence decision the
 * dispositions already carry, and copying it would make the payload a second
 * account of the same thing — the failure mode this file was written to end.
 */
function sequenceRecord(seq) {
  return {
    policy_version: seq.sequencePolicyVersion,
    step: seq.step,
    status: seq.status,
    /** Dedupe groups this campaign had already sent to this coach. */
    previously_used: [...new Set((seq.previouslyUsed ?? [])
      .filter((p) => p.source === 'SENT').map((p) => p.group))],
    /** And the group this message was allowed to draw on. Empty is valid. */
    selected: [...new Set((seq.available ?? [])
      .filter((a) => (seq.preferredForThisMessage ?? []).includes(a.kind))
      .map((a) => a.group))],
  };
}

/** The slot a claim occupied, which is also the role it was playing. */
const ROLE_OF_SLOT = Object.freeze({
  HOOK: 'HOOK', RELEVANCE: 'RELEVANCE', RECOGNITION: 'RECOGNITION',
});

/**
 * A profile link is per-relationship and per-environment.
 *
 * Fixed before hashing, exactly as `evidenceBaseline.js` fixes it, so the same
 * email to two coaches hashes the same and a token rotation does not read as a
 * changed body. The same normalisation boundary as H18, for the same reason,
 * and it is the only thing normalised: the compliance footer, the greeting and
 * every evidence sentence are content.
 */
const FIXED_PROFILE_URL = 'https://baseline.invalid/p/FIXED';
const normaliseBody = (body) => String(body ?? '')
  .replace(/https?:\/\/\S*\?ref=[A-Za-z0-9_-]+/g, FIXED_PROFILE_URL)
  .replace(/\r\n/g, '\n')
  .trim();

/** SHA-256 of the normalised body, full digest. */
export const bodyHash = (body) => createHash('sha256')
  .update(normaliseBody(body), 'utf8').digest('hex');

/**
 * The analytics record for one outbound email.
 *
 * @param {object}  evidence   the `evidenceFor` result this email was built
 *   from — WHOLE, so the composition it actually used is the one read here.
 * @param {string}  body       the body as it is about to reach Outlook,
 *   personalised and footed. Pre-transport: nothing after this point changes
 *   what the coach reads.
 * @param {string}  subject    the subject line as it will be sent.
 * @param {string}  bodySource STRUCTURED or TEMPLATE, from the composer.
 * @param {string}  templateVariant  which intro variant was filled.
 * @param {Set<string>|null} renderedKinds  the kinds the send path found in
 *   the body it handed over. Null means nobody checked — a third state, and
 *   not the same as none. When present it NARROWS the sentence list, because
 *   an operator who deleted a paragraph delivered fewer claims than we wrote.
 */
export function buildSendSnapshot({
  evidence, body = null, subject = null,
  bodySource = null, templateVariant = null, renderedKinds = null,
} = {}) {
  const comp = evidence?.composition ?? {};
  const all = comp.sentences ?? [];
  // Only what survived into the body the operator actually sent.
  const sentences = renderedKinds ? all.filter((s) => renderedKinds.has(s.kind)) : all;

  const rendered = sentences.map((s) => ({
    order: s.order,
    slot: s.slot,
    role: ROLE_OF_SLOT[s.slot] ?? null,
    kind: s.kind,
    text: s.text,
  }));

  /**
   * A congratulation is not personalisation.
   *
   * `outreachEvidenceFor` owns that rule and this only records its
   * consequence: an email whose one claim is RECOGNITION says nothing about
   * whether THIS athlete belongs at THIS programme, and counting it would make
   * the personalisation rate a measure of how many programmes won something.
   * Derived from the rendered slots rather than copied from the flag, so a
   * held or deleted claim cannot leave the flag true.
   */
  const personal = rendered.filter((r) => r.slot !== 'RECOGNITION');
  const hook = rendered.find((r) => r.slot === 'HOOK') ?? null;
  /**
   * The claim the email rests on: the hook if there is one, otherwise the
   * first non-recognition claim. Recognition is never primary. In PLAYER_FIRST
   * a hook renders in the RELEVANCE block — it has no hook slot — so the
   * primary is that first personal sentence and `hook_kind` is correctly null.
   */
  const primary = personal[0] ?? null;

  return {
    policy_version: OUTREACH_POLICY_VERSION,

    /* --- how the email was shaped ------------------------------------- */
    structure: evidence?.structure?.key ?? null,
    structure_source: evidence?.structure?.source ?? null,
    body_source: bodySource,
    template_variant: templateVariant,

    /* --- what it claimed, from what was rendered ----------------------- */
    has_personalisation: personal.length > 0,
    primary_kind: primary?.kind ?? null,
    primary_role: primary?.role ?? null,
    hook_kind: hook?.kind ?? null,
    /** Ordered, comma-joined — so "which COMBINATION" is a GROUP BY. */
    rendered_kinds: rendered.map((r) => r.kind).join(',') || null,
    rendered_roles: rendered.map((r) => r.role).join(',') || null,
    rendered_count: rendered.length,

    /* --- proof of what the coach read ---------------------------------- */
    subject,
    body_hash: body == null ? null : bodyHash(body),

    payload: {
      /** The sentences with their text. The record no future render can supply. */
      rendered,
      /**
       * Licensed, qualified, and deliberately not sent — the body cap held
       * them. Kept because "we had this and chose not to say it" is what makes
       * a later comparison causal rather than merely descriptive, and it is
       * information no other field carries.
       */
      held: (comp.placement ?? [])
        .filter((p) => p.displayed === false)
        .map((p) => p.kind),
      /**
       * Whether an operator overrode the engine's choice. A manually preferred
       * claim is a different treatment and has to be separable, or the first
       * comparison between angles silently mixes the two.
       */
      operator_selected: Boolean(evidence?.operatorSelected),
      /** What the engine would have sent unaided, for that same comparison. */
      engine_selected: evidence?.engineSelected ?? [],
      /**
       * WHICH MESSAGE OF A CAMPAIGN THIS WAS, AND WHAT THAT COST IT.
       *
       * ABSENT for every unattributed send, which is why no existing payload
       * changes shape: a manual email and a legacy relationship have no
       * campaign, no step and no sequence policy, and inventing a step 1 for
       * them would claim a campaign they were never part of.
       *
       * In the payload rather than in columns of its own. `outreach_send`
       * already carries the queryable facts — `programme_campaign_id`,
       * `state`, `rendered_kinds` — and nothing here is a filter or a GROUP BY;
       * it is the record of a decision, read when somebody asks why this
       * particular follow-up said what it said. A column per field would be
       * five migrations in service of an audit.
       *
       * IDENTITIES ARE DEDUPE GROUPS, matching ESP1. The kinds are already in
       * `rendered_kinds`; what is not recoverable afterwards is the GROUP
       * reasoning — that "you have a New Zealander now" was withheld because
       * "you've had New Zealanders before" had already gone. Storing the kind
       * alone would leave a later reader unable to reconstruct why a claim
       * they can see was licensed did not appear.
       *
       * `policy_version` beside it is P5 and moves on its own schedule. These
       * are two independent authorities and a row records both.
       */
      ...(evidence?.sequence ? { sequence: sequenceRecord(evidence.sequence) } : {}),
    },
  };
}
