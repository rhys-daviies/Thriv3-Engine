import {
  NOT_IN_TOP_100, MANUAL_ONLY_BADGE, DO_NOT_CONTACT_BADGE, CAMPAIGN_MAY_CONTACT,
  contactStateShort, engagementShort,
} from '@/lib/outreachLabels';
import { contactIntelligenceKey } from '@shared/contactIntelligenceKey.js';

/**
 * WHAT THRIV3 ALREADY KNOWS ABOUT A PROGRAMME, IN ONE PLACE — A11 §4, §10.
 *
 * ===========================================================================
 * ONE DERIVATION, THREE SURFACES. NOT A PARALLEL STATUS SYSTEM.
 *
 * Top 100, Full Universe and Specific Schools must say the same thing about
 * the same school, and the only way to guarantee that is for them to compute
 * it once — here — from the same two canonical sources Specific Schools has
 * always used:
 *
 *   athlete_programmes   the consultant's own decisions: requested, flagged,
 *                        contact stance, Top-100 visibility
 *   contact intelligence what has actually gone to the programme, and what
 *                        came back
 *
 * Nothing here invents a state, and nothing is derived from a score. A card
 * with no relationship row and no contact history produces an EMPTY LIST, not
 * a row of grey "none" chips — §4 is explicit that there are no empty chips.
 *
 * -- IDENTITY IS CANONICAL, NEVER THE DISPLAY NAME ALONE --------------------
 *
 * Both lookups are keyed by `contactIntelligenceKey(college_name, sport)`,
 * which is the key both stores are already written with. Matching on the
 * displayed name alone would collide the two sports — a men's and a women's
 * programme share a `college_name` — and would attach one athlete's outreach
 * history to the other's card. The key carries the sport for that reason.
 *
 * -- UNKNOWN IS NOT NONE ----------------------------------------------------
 *
 * `contactKnown` is false until the athlete's contact history has actually
 * loaded. Until then this reports no contact chips at all, rather than
 * "No contact recorded" — which would be an assertion we have not earned.
 * `contactStateShort` already enforces that; this passes the flag through
 * rather than defaulting it to true.
 * ===========================================================================
 */

/** Chip kinds, so a caller can order or filter without matching on prose. */
export const STATUS_KIND = Object.freeze({
  REQUESTED: 'REQUESTED',
  NOT_IN_TOP_100: 'NOT_IN_TOP_100',
  CONTACT_STANCE: 'CONTACT_STANCE',
  CONTACT_STATE: 'CONTACT_STATE',
  ENGAGEMENT: 'ENGAGEMENT',
  FLAGGED: 'FLAGGED',
});

/**
 * @param {object}  args
 * @param {string}  args.collegeName
 * @param {string}  args.sport
 * @param {Map}     args.relationships  byCollegeName, from the workspace
 * @param {Map}     args.contactByProgramme
 * @param {boolean} args.contactKnown   has the history actually loaded?
 * @returns {Array<{kind: string, label: string, tone: string}>}
 */
export function programmeStatuses({
  collegeName, sport, relationships = null, contactByProgramme = null, contactKnown = false,
}) {
  const chips = [];
  const rel = relationships?.get?.(collegeName) ?? null;
  const key = contactIntelligenceKey(collegeName, sport);
  const contact = contactByProgramme?.get?.(key) ?? null;

  /* ---- The consultant's own decisions ---- */
  if (rel) {
    if (rel.request_state === 'requested') {
      chips.push({ kind: STATUS_KIND.REQUESTED, label: 'Specific school', tone: 'outline' });
    }
    if (rel.visibility === 'suppressed') {
      chips.push({ kind: STATUS_KIND.NOT_IN_TOP_100, label: NOT_IN_TOP_100, tone: 'muted' });
    }
    /**
     * Exactly one stance chip, and only when it is not the default. "Campaign
     * may contact" is the ordinary state of every programme in the universe;
     * printing it on all 1,205 would be badge soup that says nothing — §12.
     * It appears only where an operator has returned a restricted programme
     * to it, which is a decision somebody made.
     */
    if (rel.contact_stance === 'manual_only') {
      chips.push({ kind: STATUS_KIND.CONTACT_STANCE, label: MANUAL_ONLY_BADGE, tone: 'amber' });
    } else if (rel.contact_stance === 'do_not_contact') {
      chips.push({ kind: STATUS_KIND.CONTACT_STANCE, label: DO_NOT_CONTACT_BADGE, tone: 'destructive' });
    }
    if (rel.flagged) {
      chips.push({
        kind: STATUS_KIND.FLAGGED,
        label: rel.flag_reason ? String(rel.flag_reason) : 'Flagged',
        tone: 'muted',
      });
    }
  }

  /* ---- What has actually happened ---- */
  const state = contactStateShort(contact, contactKnown);
  /**
   * "No contact recorded" is true and useful on a Specific Schools row, where
   * the question is "have we written to this school yet". On a ranked list of
   * a hundred it is the answer for almost all of them, so it is omitted here
   * and only its positive forms are chips. The absence of the chip says it.
   */
  if (state && state !== 'No contact recorded') {
    chips.push({ kind: STATUS_KIND.CONTACT_STATE, label: state, tone: 'blue' });
  }
  const engagement = engagementShort(contact);
  if (engagement) {
    chips.push({ kind: STATUS_KIND.ENGAGEMENT, label: engagement, tone: 'green' });
  }

  return chips;
}

/** True when a programme carries any relationship or outreach history at all. */
export const hasStatuses = (args) => programmeStatuses(args).length > 0;

export { CAMPAIGN_MAY_CONTACT };
