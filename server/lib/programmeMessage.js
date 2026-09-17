import db from '../db/client.js';
import { evidenceFor } from './evidenceQueries.js';
import { buildSendSnapshot } from '../../shared/evidence/sendSnapshot.js';
import { templateVariant } from '../../shared/evidence/templateVariant.js';
import {
  emailBodyFor, fillTemplate, DEFAULT_EMAIL_SUBJECT,
} from '../../src/lib/emailTemplate.js';

/**
 * WHAT THIS CAMPAIGN WOULD ACTUALLY WRITE, COMPOSED ON THE SERVER — F10b-1.
 *
 * ---------------------------------------------------------------------------
 * THE THING THIS EXISTS TO CHANGE.
 *
 * Until now the prose that reaches a coach has been composed in a BROWSER and
 * POSTed to `/api/outreach/send` as `subject` and `body`. The evidence licence
 * has always been server-side and strict; the sentences that ship have not
 * been. So the server could say what it WOULD have written and never what it
 * did, and nothing without a browser could write an email at all.
 *
 * This is that composition, in Node, from identifiers alone.
 * ---------------------------------------------------------------------------
 *
 * IT IS A WRAPPER, NOT A SECOND ENGINE. Every decision below is made by the
 * module that already owns it:
 *
 *   evidenceFor        which claims are licensed, which structure, which step
 *   emailBodyFor       which composer runs and what the body says
 *   fillTemplate       the subject, from the athlete's own template
 *   buildSendSnapshot  what the message claimed, and what it held back
 *
 * Nothing here ranks evidence, chooses a structure, decides a step, writes a
 * sentence or re-implements a rule. `server/scripts/draftOutreach.js` has
 * composed exactly this way since the evidence engine shipped; what is new is
 * that the result is a VALUE rather than an argument to a send.
 *
 * ---------------------------------------------------------------------------
 * IT WRITES NOTHING AND SENDS NOTHING.
 *
 * No row is created, no token minted, no budget spent, no transport called, no
 * model asked. F10b-2 persists the value; F10b-3 gates it. This slice is the
 * seam and only the seam.
 * ---------------------------------------------------------------------------
 */

/* -------------------------------------------------------------------------- */
/* The pure primitive — no database, no campaign                               */
/* -------------------------------------------------------------------------- */

/**
 * SUBJECT, BODY AND PROVENANCE FROM A RESOLVED PAIRING.
 *
 * PURE. It touches no database and knows nothing about campaigns, so the
 * manual path can reuse it unchanged when it comes — which is the whole reason
 * it is separate from the resolver below. There must never be two
 * personalisation engines, and a campaign-only composer would be the second.
 *
 * WHAT IT DELIBERATELY DOES NOT PRODUCE. The body is the COMPOSED body and not
 * the body a coach receives: `sendOutreach` appends the compliance footer and
 * substitutes the tracked profile link at send, because both need facts that do
 * not exist yet — a postal address from configuration and a token minted by
 * `createOutreach`. So `{{player_profile_url}}` is still a token here, exactly
 * as it is in the browser preview and in the drafting CLI, and the footer is
 * absent. Adding either would be this function claiming to know what will be
 * sent rather than what was written.
 *
 * @param {object} args.athlete   a `players` row.
 * @param {object} args.college   `{ name, division }` — what `buildEmailContext` reads.
 * @param {string} args.coachName the coach's full name; the composer takes the
 *   first name from it through `coachFirstName`, which is where that rule lives.
 * @param {object} args.evidence  an `evidenceFor` / `selectEvidence` result.
 * @param {number|null} args.step the campaign-local step, DERIVED by the
 *   caller and never asserted by one. Reported, never used to compose: the
 *   step shaped the evidence result upstream, and re-reading it here would be
 *   a second opinion about a decision already made.
 * @returns {object} see `composeProgrammeMessage`.
 */
export function composeMessage({
  athlete, college, coachName, evidence = null, step = null, composedFor = null,
} = {}) {
  const composed = emailBodyFor(athlete, college, coachName, { evidence });

  /**
   * THE SAME SUBJECT THE BROWSER AND THE CLI COMPOSE, from the same context.
   *
   * F10 moves authority rather than redesigning copy, so this is unchanged:
   * the athlete's own saved subject or the default, filled from the context
   * the body was filled from. It sees no evidence and no step, which is a
   * known gap and deliberately not this slice's.
   */
  const subject = fillTemplate(
    athlete?.email_subject || DEFAULT_EMAIL_SUBJECT, composed.context,
  );

  /**
   * WHAT THE MESSAGE CLAIMED, IN THE REPRESENTATION THAT ALREADY EXISTS.
   *
   * `buildSendSnapshot` is reused rather than approximated, because a second
   * shape for the same facts is how two records of one email start disagreeing
   * — which is the failure `outreach_evidence` already demonstrates. It derives
   * everything from the sentences that were RENDERED, hashes the body with the
   * profile URL normalised, and recomputes nothing.
   *
   * `renderedKinds` is deliberately NOT passed. That argument narrows the
   * record to what survived an operator's editing, and nothing has been edited
   * yet: at generation the composed body IS the engine's body. F10b-2 will pass
   * it when a reviewed version exists to compare.
   */
  const snapshot = buildSendSnapshot({
    evidence,
    body: composed.body,
    subject,
    bodySource: composed.source,
    templateVariant: templateVariant(composed.template),
  });

  return {
    subject,
    body: composed.body,
    bodySource: composed.source,
    structure: composed.structure,
    step,

    /**
     * WHAT THIS WAS COMPOSED FOR, so a later writer can VERIFY rather than
     * trust — F10b-2.
     *
     * Without it, persistence would take a caller's word for which pairing a
     * body belongs to, and an email about Duke could be frozen against a
     * Clemson attempt with nothing able to notice afterwards. Null for the
     * pure primitive, which composes for a pairing nobody has named.
     *
     * IT IS NOT PERSISTENCE METADATA. These are identifiers of the SUBJECT of
     * the composition, not of the composition itself — the same two arguments
     * that produced it — so the value stays deterministic and two compositions
     * of the same pairing still compare equal.
     */
    composedFor,

    /**
     * WHY THRIV3 WROTE THIS, in the words it wrote.
     *
     * `rendered` carries each sentence's order, slot, role, kind and TEXT, and
     * `held` the claims the body cap licensed and withheld — the two things no
     * later re-render can supply, because the data underneath will have moved.
     */
    evidence: {
      rendered: snapshot.payload.rendered,
      held: snapshot.payload.held,
      structure: snapshot.structure,
      structureSource: snapshot.structure_source,
      templateVariant: snapshot.template_variant,
      hasPersonalisation: snapshot.has_personalisation,
      primaryKind: snapshot.primary_kind,
      primaryRole: snapshot.primary_role,
      hookKind: snapshot.hook_kind,
      renderedKinds: snapshot.rendered_kinds,
      renderedRoles: snapshot.rendered_roles,
      renderedCount: snapshot.rendered_count,
      operatorSelected: snapshot.payload.operator_selected,
      engineSelected: snapshot.payload.engine_selected,
      sequence: snapshot.payload.sequence ?? null,
    },

    /**
     * TWO POLICIES, MOVING SEPARATELY. `policy_version` says what a claim may
     * assert and how it is worded; the sequence policy says what a second
     * message may draw on. A message records both because a later reader asking
     * why it said what it said needs both, and they will not change together.
     */
    policyVersion: snapshot.policy_version,
    sequencePolicyVersion: snapshot.payload.sequence?.policy_version ?? null,

    /**
     * SHA-256 of the composed body, profile URL normalised — `bodyHash`'s own
     * rule, so the same email to two coaches hashes the same and a token
     * rotation does not read as a changed body.
     *
     * IT IS CONTENT, NOT METADATA. There is deliberately no id and no
     * timestamp anywhere in this value: composing the same pairing twice must
     * produce the same object, or a durable snapshot could never be compared
     * with a regeneration. Identity and time belong to the row F10b-2 writes.
     */
    bodyHash: snapshot.body_hash,
  };
}

/* -------------------------------------------------------------------------- */
/* The campaign resolver — identifiers in, value out                           */
/* -------------------------------------------------------------------------- */

const ATHLETE = db.prepare('SELECT * FROM players WHERE id = ?');
const COACH = db.prepare('SELECT id, full_name, email, school, sport FROM coaches WHERE id = ?');
const COLLEGE = db.prepare('SELECT name, division FROM colleges WHERE name = ? AND sport = ?');
const PROGRAMME_CAMPAIGN = db.prepare(`
  SELECT pc.id, pc.college_name, pc.sport, pc.campaign_id, c.athlete_id
  FROM programme_campaigns pc
  JOIN campaigns c ON c.id = pc.campaign_id
  WHERE pc.id = ?
`);

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * COMPOSE THE MESSAGE THIS CAMPAIGN WOULD SEND THIS COACH.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CALLER MAY SAY, AND IT IS THREE IDENTIFIERS.
 *
 * A programme campaign, a coach, and nothing else. Not a recipient address,
 * not a subject, not a body, not an evidence kind, not a structure, not a
 * template and NOT A STEP. Every one of those is derived here or by the
 * modules this calls, which is the property that makes server-side composition
 * worth having: a browser cannot inject a sentence, name a claim the licence
 * would refuse, or assert that a second message is a first.
 *
 * The athlete is read from the campaign rather than accepted, so nothing can
 * compose against somebody else's profile by being asked nicely — the same
 * rule `campaignAttribution` applies to every campaign write.
 * ---------------------------------------------------------------------------
 *
 * WHAT IT ASSUMES ABOUT ITS CALLER — F10b-3's job, stated here so the gap is
 * explicit rather than forgotten:
 *
 *   IT DOES NOT ASK WHETHER THIS MESSAGE MAY BE WRITTEN. No stance, no
 *   suppression, no revocation, no programme or campaign lifecycle, no
 *   first-touch review, no budget and no timing. It answers what the campaign
 *   WOULD say, exactly as `programmePursuitPlan` answers what it would do.
 *
 *   SO THE CALLER MUST ALREADY HAVE AUTHORISED IT. In this slice the only
 *   callers are tests. When an endpoint arrives it runs the preparation
 *   decision first, and this function must never become the place that checks
 *   — a composer that also gates is two authorities in one function, and one
 *   of them will eventually be skipped.
 *
 * IT VERIFIES IDENTITY, which is not the same thing. A coach who is not at the
 * campaign's programme is a caller bug rather than a policy question, and
 * composing an email about Duke addressed to a Clemson coach would produce a
 * plausible, wrong artefact. So it throws, matching `contactAttempts` and
 * `campaignAttribution`, which refuse the same mismatch the same way.
 *
 * @param {string} args.programmeCampaignId
 * @param {string} args.coachId
 * @returns {object} the `composeMessage` value, with `step` derived.
 * @throws when identity does not resolve, or when the campaign's sequence
 *   policy has nothing left to say — see below.
 */
export function composeProgrammeMessage({ programmeCampaignId, coachId } = {}) {
  const pc = PROGRAMME_CAMPAIGN.get(programmeCampaignId);
  if (!pc) {
    throw fail('PROGRAMME_CAMPAIGN_NOT_FOUND', `No programme campaign ${programmeCampaignId}`);
  }

  const coach = COACH.get(coachId);
  if (!coach) throw fail('COACH_NOT_FOUND', `No coach ${coachId}`);
  if (coach.school !== pc.college_name || coach.sport !== pc.sport) {
    throw fail(
      'CAMPAIGN_PROGRAMME_MISMATCH',
      `Programme campaign ${programmeCampaignId} is for ${pc.college_name} (${pc.sport}), `
      + `but this coach is at ${coach.school} (${coach.sport}). A message is composed for the `
      + 'programme it is addressed to.',
    );
  }

  const athlete = ATHLETE.get(pc.athlete_id);
  if (!athlete) throw fail('ATHLETE_NOT_FOUND', `No athlete ${pc.athlete_id}`);

  /**
   * THE STEP IS DERIVED, AND IT IS DERIVED BY THE ONE MODULE THAT MAY.
   *
   * `evidenceFor` holds the sequence policy: given a programme campaign and a
   * coach it counts that campaign's accepted messages to that coach, asks
   * ESP1 what a message at that step may draw on, and composes under the
   * answer. Nothing here counts anything, and this module deliberately does
   * not import `sequenceStrategy` — a guard in `followUpSequence.test.js`
   * requires exactly that of every composition client, so a browser, a CLI and
   * a route cannot disagree about what a follow-up is.
   *
   * A THIRD MESSAGE THROWS RATHER THAN COMPOSING. PP1 plans one initial
   * message and one follow-up per coach; ESP1 describes those two. Asking for
   * a third is asking for a generic email nobody chose to send, and the
   * refusal reaches this caller as `UNSUPPORTED_SEQUENCE_STEP`.
   */
  const evidence = evidenceFor(athlete, pc.college_name, {
    sport: pc.sport,
    programmeCampaignId,
    coachId,
  });

  /**
   * The college as the composer reads it. `evidenceFor` already resolved the
   * programme for evidence; this is the small `{ name, division }` object
   * `buildEmailContext` wants, and the name is the campaign's own snapshotted
   * one rather than anything a caller supplied.
   */
  const college = COLLEGE.get(pc.college_name, pc.sport)
    ?? { name: pc.college_name, division: null };

  return composeMessage({
    athlete,
    college,
    coachName: coach.full_name,
    evidence,
    step: evidence.sequence?.step ?? null,
    composedFor: Object.freeze({ programmeCampaignId: pc.id, coachId: coach.id }),
  });
}
