import React from 'react';
import { Handshake, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ALREADY_IN_TOUCH, ALLOW_CAMPAIGN_OUTREACH, ALREADY_IN_TOUCH_FLAG_REASON,
} from '@/lib/outreachLabels';

/**
 * THE THIRD DECISION — F5b.
 *
 * `athlete_programmes` keeps three states in three columns because they will
 * be conflated in conversation and must not be in code:
 *
 *   FLAG        a fact about the world — we know the coach, the athlete
 *               visited, her father is an alum.
 *   TOP 100     a ranking decision — whether the school is on the actionable
 *               list.
 *   STANCE      a contact policy — whether the AUTOMATED CAMPAIGN may write.
 *
 * `ProgrammeRelationship` owns the first two and says in its own header that
 * the third is deliberately not there. This is the third, in its own control,
 * shared by the match cards and the Specific Schools list so the two cannot
 * drift into offering different actions for the same state.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE HIDES A SCHOOL OR STOPS A PERSON WRITING TO IT.
 *
 * `manual_only` leaves the programme in the Top 100, in Specific Schools, on
 * its match card and fully available to Relationship Outreach. It says the
 * campaign is not the path. An operator who reads the badge and assumes the
 * school has been closed off has been told the wrong thing, which is why the
 * copy beside it says both halves.
 * ---------------------------------------------------------------------------
 *
 * `do_not_contact` IS NEVER REACHABLE FROM HERE, in either direction. It is
 * the stronger rule — nobody writes to this programme for this athlete, by
 * hand or otherwise — and a control that could install or lift it beside
 * "allow campaign outreach" would put the two most different answers in the
 * product one click apart. The component renders nothing for it, and the
 * server refuses to downgrade it independently of any screen.
 */
export default function ContactStanceControl({
  collegeId = null, collegeName = null, relationship = null, busy = false,
  onSetContactStance, onFlag = null,
}) {
  const stance = relationship?.contact_stance ?? 'default';

  /**
   * THE COLLEGE-SHAPED HANDLE, which is what the relationship writers take
   * when there is no row yet — `{ id: college_id, name }`, exactly as the flag
   * control beside this one passes. A relationship carries its own
   * `college_id`, so a Specific Schools row and a match card produce the same
   * handle by different routes.
   */
  const college = (collegeId ?? relationship?.college_id)
    ? { id: collegeId ?? relationship.college_id, name: collegeName ?? relationship?.college_name }
    : null;

  /** A relationship row addresses itself; anything else goes through the registry. */
  const target = relationship?.id ? relationship : college;
  if (!onSetContactStance || !target) return null;

  /**
   * THE STRONGER STANCE HAS NO CONTROL HERE. Not disabled, not greyed out —
   * absent. A disabled "allow campaign outreach" beside a do-not-contact badge
   * reads as "this is how you would lift it", and it is not.
   */
  if (stance === 'do_not_contact') return null;

  if (stance === 'manual_only') {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => onSetContactStance(target, 'default')}
      >
        <Megaphone className="h-3.5 w-3.5 mr-1" /> {ALLOW_CAMPAIGN_OUTREACH}
      </Button>
    );
  }

  /**
   * TWO DELIBERATE MUTATIONS, MADE HERE AND NOT INFERRED ON THE SERVER.
   *
   * An operator clicking this is deciding two things at once — that we have
   * been in touch (a fact about the world) and that the campaign should leave
   * it alone (a contact policy) — and performing them as two writes is how the
   * two stay separable afterwards. `establishManualOnly` on the server changes
   * contact policy and nothing else, so a confirmed send never silently flags
   * a school; this button flags because a person said to.
   *
   * THE STANCE GOES FIRST. It is the half with a consequence outside Thriv3 —
   * it is what stops a campaign emailing a coach somebody has already spoken
   * to — so if only one of the two writes lands, that is the one worth having.
   *
   * AN EXISTING FLAG REASON IS NEVER OVERWRITTEN. "Trains with the assistant's
   * club side" is context somebody took the trouble to record and is strictly
   * more informative than the generic sentence this would otherwise install.
   */
  const alreadyInTouch = async () => {
    await onSetContactStance(target, 'manual_only');
    if (!relationship?.flagged && onFlag && college) {
      await onFlag(college, ALREADY_IN_TOUCH_FLAG_REASON);
    }
  };

  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={alreadyInTouch}>
      <Handshake className="h-3.5 w-3.5 mr-1" /> {ALREADY_IN_TOUCH}
    </Button>
  );
}
