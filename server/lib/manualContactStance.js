import db from '../db/client.js';
import {
  findRelationship, updateAthleteProgramme, upsertAthleteProgramme,
} from './athleteProgrammes.js';
import { OUTREACH_ORIGIN } from '../../shared/outreachOrigin.js';

/**
 * A HUMAN WROTE TO THIS SCHOOL, SO THE CAMPAIGN STOPS WRITING TO IT — F5b.
 *
 * ===========================================================================
 * TWO KINDS OF TRUTH, AND THIS FILE IS THE ONE PLACE THEY MEET.
 *
 *   `outreach` / `outreach_send`        HISTORY. What was written, to whom,
 *                                       when, and by which part of the
 *                                       product. Append-only in spirit, never
 *                                       edited, and authoritative for ever.
 *   `athlete_programmes.contact_stance` CURRENT CONTACT POLICY. Whether the
 *                                       automated campaign may write to this
 *                                       athlete-school-sport relationship now.
 *
 * They are NOT the same fact and this module does not merge them. It does one
 * narrow thing: when history records a confirmed manual contact, it ESTABLISHES
 * the policy that follows from it. The policy is then a row an operator can
 * read, explain and — deliberately — change back, which a derived rule could
 * never be.
 *
 * WHY POLICY IS STORED RATHER THAN DERIVED, in one sentence each:
 *
 *   A derived rule could not express the case that matters most — "the athlete
 *   emailed this coach last year, outside Thriv3" leaves no row to derive from.
 *
 *   A derived rule could not be reversed. An operator who decides a school
 *   SHOULD now go into the campaign would have to delete history to say so.
 *
 *   A second campaign-safety authority alongside `campaignStanceDecision` is
 *   two authorities that can disagree, which is how a school gets contacted
 *   because only one of them was asked.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * IT CHANGES CONTACT POLICY AND NOTHING ELSE.
 *
 * Not `flagged`, not `flag_reason`, not `visibility`, not `request_state`, not
 * `note`. `athlete_programmes` keeps three states in three columns precisely
 * so one operator action cannot mean three things — see the schema's own note
 * — and a contact-policy function that quietly flagged a school would be the
 * first thing to break that.
 *
 * The "We've already been in touch" BUTTON does flag as well, and that is
 * correct: it is an operator making two decisions at once and saying so. It
 * performs two explicit mutations from the client. The difference matters —
 * a person may decide two things, a policy function may not infer one from
 * the other.
 * ---------------------------------------------------------------------------
 *
 * IT IMPORTS NO CAMPAIGN CODE AND NO CONTACT INTELLIGENCE. The campaign reads
 * the stance through `campaignStanceDecision`, which this file has never heard
 * of, and that one-way arrow is the whole integration. Nothing here is aware
 * of a campaign, a claim, a budget, a schedule or a transport.
 */

/** Why an establish attempt did not change anything. Never a thrown error. */
export const STANCE_OUTCOME = Object.freeze({
  /** The stance moved to manual_only. */
  ESTABLISHED: 'ESTABLISHED',
  /** It was already manual_only. Idempotent, and the common case on a re-run. */
  ALREADY_MANUAL_ONLY: 'ALREADY_MANUAL_ONLY',
  /**
   * The relationship is do_not_contact, which is STRONGER and is left alone.
   *
   * Not an error and not a failure. Nobody may write to this programme for
   * this athlete at all, so "a person may write to it, a campaign may not" is
   * a weaker statement and installing it would be a downgrade nobody asked
   * for. Reported so a caller can say so rather than silently appear to have
   * worked.
   */
  STRONGER_STANCE_KEPT: 'STRONGER_STANCE_KEPT',
  /**
   * There is no relationship row and the registry cannot supply an identity
   * for one — the programme is not in `colleges` under this sport, or it is
   * there and retired.
   *
   * `athleteProgrammes` refuses to add an inactive programme to an athlete's
   * list, and that refusal is its rule, not ours to override from a contact
   * function. Reported rather than thrown: the caller is a post-send seam and
   * a policy that could not be written must never undo a message that went.
   */
  PROGRAMME_UNRESOLVABLE: 'PROGRAMME_UNRESOLVABLE',
  /** The caller did not name an athlete, a school and a sport. */
  IDENTITY_INCOMPLETE: 'IDENTITY_INCOMPLETE',
});

const MANUAL_ONLY = 'manual_only';
const DO_NOT_CONTACT = 'do_not_contact';

const result = (outcome, over = {}) => ({
  outcome,
  changed: outcome === STANCE_OUTCOME.ESTABLISHED,
  stance: null,
  created: false,
  relationshipId: null,
  ...over,
});

/**
 * THE REGISTRY ROW FOR A NAME, EXACTLY.
 *
 * `=`, not `LIKE`, not `instr`, and no alias table: this is RESOLUTION, which
 * `collegeSearch.js` refuses to do for typed text and for good reason — the
 * matcher that did answer when it was unsure published Belmont Abbey's domain
 * for Belmont. What is resolved here is not typed text. It is
 * `coaches.school`, which every join in this product already treats as the
 * canonical name, so an exact match is the only match that can be right and a
 * miss is an honest miss.
 *
 * Only reached when no relationship row exists yet, which is the batch
 * confirmation path: a draft written from the Top 100 composer or the CLI
 * reaches a coach without anybody having said anything about the programme.
 */
function registryIdFor(collegeName, sport) {
  const row = db.prepare(
    'SELECT id FROM colleges WHERE name = ? AND sport = ? ORDER BY active DESC, id LIMIT 1',
  ).get(collegeName, sport);
  return row?.id ?? null;
}

/**
 * Record that this athlete-school-sport relationship is worked by hand.
 *
 * ---------------------------------------------------------------------------
 * THE WHOLE PROGRAMME, NOT THE COACH WHO WAS WRITTEN TO. Deliberate, and the
 * product decision behind it is worth keeping next to the code: if a person
 * has emailed one coach at University X about this athlete, the campaign
 * should regard University X as handled. Coaching staffs talk to each other,
 * and an automated introduction landing in the office next door a week after a
 * real conversation is the exact failure this exists to prevent.
 *
 * `contact_stance` is per (athlete, college_name, sport) and has always been,
 * so this is the grain the column already has rather than a new one.
 * ---------------------------------------------------------------------------
 *
 * IDEMPOTENT. Calling it on an already-manual_only relationship changes
 * nothing, bumps no timestamp and reports ALREADY_MANUAL_ONLY.
 *
 * IT NEVER THROWS FOR A STATE IT CANNOT REACH. Every caller is downstream of a
 * message that has already gone; raising here would turn "we could not write
 * down a policy" into "the send failed", which is both false and the more
 * alarming of the two.
 *
 * @returns {{outcome: string, changed: boolean, stance: string|null,
 *            created: boolean, relationshipId: string|null}}
 */
export function establishManualOnly({ athleteId, collegeName, sport } = {}) {
  if (!athleteId || !collegeName || !sport) {
    return result(STANCE_OUTCOME.IDENTITY_INCOMPLETE);
  }

  const existing = findRelationship(athleteId, collegeName, sport);

  if (existing) {
    if (existing.contact_stance === DO_NOT_CONTACT) {
      return result(STANCE_OUTCOME.STRONGER_STANCE_KEPT, {
        stance: DO_NOT_CONTACT, relationshipId: existing.id,
      });
    }
    if (existing.contact_stance === MANUAL_ONLY) {
      return result(STANCE_OUTCOME.ALREADY_MANUAL_ONLY, {
        stance: MANUAL_ONLY, relationshipId: existing.id,
      });
    }
    /**
     * ONE FIELD TRAVELS. `updateAthleteProgramme` applies exactly the keys it
     * is given, so the flag, its reason, the visibility, the request and the
     * note are not merely preserved by intention — they are never named.
     */
    const updated = updateAthleteProgramme(athleteId, existing.id, {
      contact_stance: MANUAL_ONLY,
    });
    return result(STANCE_OUTCOME.ESTABLISHED, {
      stance: updated.contact_stance, relationshipId: updated.id,
    });
  }

  /**
   * NO RELATIONSHIP YET, WHICH IS ORDINARY. Most programmes an athlete is
   * matched with have never been flagged, requested or suppressed, and a
   * message can be written to one of them from the Top 100 composer without
   * anybody having said anything about it. The policy still has to land
   * somewhere, so the row is created carrying nothing but the stance.
   */
  const collegeId = registryIdFor(collegeName, sport);
  if (!collegeId) return result(STANCE_OUTCOME.PROGRAMME_UNRESOLVABLE);

  try {
    const { programme } = upsertAthleteProgramme(athleteId, {
      college_id: collegeId,
      contact_stance: MANUAL_ONLY,
    });
    return result(STANCE_OUTCOME.ESTABLISHED, {
      stance: programme.contact_stance, relationshipId: programme.id, created: true,
    });
  } catch {
    // COLLEGE_INACTIVE, COLLEGE_SPORT_MISMATCH, ATHLETE_NOT_FOUND. Each is
    // athleteProgrammes refusing an identity it will not store, which is its
    // decision to make; reported, never overridden, and never raised into a
    // send path that has already finished.
    return result(STANCE_OUTCOME.PROGRAMME_UNRESOLVABLE);
  }
}

/* -------------------------------------------------------------------------- */
/* Resolving a confirmed message back to the relationship it was about         */
/* -------------------------------------------------------------------------- */

const SEND_ORIGIN = db.prepare('SELECT origin FROM outreach_send WHERE id = ?');

const RELATIONSHIP_FOR_OUTREACH = db.prepare(`
  SELECT o.athlete_id AS athleteId, c.school AS collegeName, c.sport AS sport
    FROM outreach o
    JOIN coaches c ON c.id = o.coach_id
   WHERE o.id = ?
`);

/**
 * WHICH ATHLETE-SCHOOL-SPORT RELATIONSHIP A CONFIRMED MESSAGE WAS ABOUT, and
 * whether it was a manual one at all.
 *
 * ---------------------------------------------------------------------------
 * RESOLVED FROM STORED ROWS, NEVER FROM A LABEL THE CALLER HELD.
 *
 * `coaches.school` and `coaches.sport` are where the message actually went —
 * the same columns `programmesReachedBy` consults for the same reason. A
 * caller's own idea of which school a batch was for is exactly the value that
 * can be stale or wrong, and `confirmSends` in particular is confirming a list
 * an operator was shown some minutes ago.
 * ---------------------------------------------------------------------------
 *
 * ORIGIN MUST BE `manual`, EXPLICITLY. Three values are possible and only one
 * establishes anything:
 *
 *   `manual`    a person composed and approved this message. Establishes.
 *   `campaign`  written by the automated engine, and `recordDraft` sets this
 *               itself from the attribution it verifies rather than from
 *               anything a caller says. The campaign must never write manual
 *               contact policy — that is the coupling the two workstreams are
 *               kept apart to avoid, and a campaign that silently switched
 *               itself off for a school would be a bug nobody could see.
 *   NULL        written before the origin vocabulary existed. It means "not
 *               recorded", which is not the same as either of the other two,
 *               and nothing backfills it. Declining to establish is the same
 *               refusal the rest of the schema makes about these rows: a
 *               policy invented from a provenance nobody observed is a
 *               fabrication, and the operator can still set the stance by hand
 *               with full knowledge of what they are asserting.
 *
 * @returns {{athleteId, collegeName, sport}|null} null when the message is not
 *   manual-origin, or when the relationship cannot be resolved.
 */
export function manualRelationshipForConfirmedSend({ outreachId, outreachSendId = null } = {}) {
  if (!outreachId) return null;

  /**
   * NO MESSAGE MEANS NO PROVENANCE. A handful of relationships were drafted
   * before `outreach_send` existed at all — `confirmSends` still confirms them
   * and deliberately writes no message row for them — so there is nothing that
   * says how they were composed. Same refusal as a NULL origin, for the same
   * reason.
   */
  if (!outreachSendId) return null;
  const origin = SEND_ORIGIN.get(outreachSendId)?.origin ?? null;
  if (origin !== OUTREACH_ORIGIN.MANUAL) return null;

  const row = RELATIONSHIP_FOR_OUTREACH.get(outreachId);
  if (!row?.athleteId || !row?.collegeName || !row?.sport) return null;
  return { athleteId: row.athleteId, collegeName: row.collegeName, sport: row.sport };
}

/**
 * The two steps together, for a caller that has just confirmed one message.
 *
 * Returns the same result shape as `establishManualOnly`, with
 * IDENTITY_INCOMPLETE standing for "this was not a manual message" — the
 * caller's handling is identical either way, which is the point: a confirm
 * loop should not have to branch on provenance.
 */
export function establishManualOnlyForConfirmedSend({ outreachId, outreachSendId = null } = {}) {
  const relationship = manualRelationshipForConfirmedSend({ outreachId, outreachSendId });
  if (!relationship) return result(STANCE_OUTCOME.IDENTITY_INCOMPLETE);
  return establishManualOnly(relationship);
}
