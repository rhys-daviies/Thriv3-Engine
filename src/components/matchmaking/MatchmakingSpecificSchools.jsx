import React, { useMemo, useState } from 'react';
import ManualOutreachDialog from '@/components/ManualOutreachDialog';
import SpecificSchools from '@/components/SpecificSchools';
import MatchmakingSpecificSearch from './MatchmakingSpecificSearch';
import { usePlayerWorkspace } from '@/pages/player/PlayerWorkspace';
import { useContactIntelligence, CONTACT_INTELLIGENCE } from '@/lib/useContactIntelligence';
import { usePendingManualDrafts } from '@/lib/usePendingManualDrafts';
import { manualOutreach } from '@/api/client';
import { CONFIRM_FAILED, DISCARD_FAILED } from '@/lib/outreachLabels';
import { standingsFor } from '@/lib/matchmakingStandings';

/**
 * SPECIFIC SCHOOLS, UNDER V2 — A10 §D, §F, §H.
 *
 * ===========================================================================
 * THE SAME LIST, THE SAME ROWS, THE SAME CONTROLS. NOTHING WAS MIGRATED.
 *
 * This renders `athlete_programmes` — the one canonical row per
 * (athlete, programme, sport) that has always carried the consultant's
 * decisions: the request itself, the flag, the note, the contact stance and
 * the Top-100 visibility. V1 reads those rows through
 * `useAthleteProgrammes`; so does this, through the identical workspace
 * context, through the identical API.
 *
 * THAT IS THE WHOLE PRESERVATION STRATEGY, and it is stronger than a
 * migration would have been. There is no second store to copy into, so there
 * is no copy to go stale, no identity to re-map, and no count that can come
 * out at 98. An athlete with ninety-nine specific schools has ninety-nine
 * rows; this component is a different way of looking at them.
 *
 * WHAT V2 ADDS IS A READ. Each row is enriched with where the PERSISTED run
 * put that programme — rank, band, pursuit, the three layers, evidence state.
 * Read off the run already on screen, never recomputed: see
 * src/lib/matchmakingStandings.js.
 * ===========================================================================
 *
 * EVERY V1 CONTROL IS PASSED THROUGH, not a chosen subset. Remove, Create
 * Email Draft, Details, Manual Outreach Only, Allow Campaign Outreach, notes,
 * flags, Not-in-Top-100 and the draft confirm/discard pair are all handed to
 * the same `SpecificSchools` component the V1 tab mounts, with the same
 * handlers from the same hooks. A control omitted here would be a capability
 * the consultant loses by having V2 switched on.
 */
export default function MatchmakingSpecificSchools({ run }) {
  /**
   * `?? {}` for the same reason the panel does it: these surfaces are mounted
   * directly by their own suites, outside the workspace Outlet. An absent
   * context renders an empty list, which is the truth about it there.
   */
  const {
    player,
    specific = [], byCollegeName,
    loading: programmesLoading, failed: programmesFailed,
    pending, error: programmeError,
    add, withdraw, flag, setVisibility, setContactStance, saveNote,
  } = usePlayerWorkspace() ?? {};

  /** The relationship being written to by hand, addressed by its own id. */
  const [manualTarget, setManualTarget] = useState(null);
  const [draftError, setDraftError] = useState(null);

  const {
    byProgramme: contactByProgramme, status: contactStatus, reload: reloadContact,
  } = useContactIntelligence(player?.id);
  const contactUnavailable = contactStatus === CONTACT_INTELLIGENCE.FAILED;
  const contactKnown = contactStatus === CONTACT_INTELLIGENCE.READY;

  const {
    byProgramme: pendingByProgramme, reload: reloadPendingDrafts,
  } = usePendingManualDrafts(player?.id);

  /**
   * ONE INDEX FOR THE WHOLE LIST, built once per run.
   *
   * Ninety-nine rows cost ninety-nine Map lookups against the array the panel
   * has already loaded for the other two tabs — no request per row, and no
   * second hydration of a 500–700 KB run. §S.
   */
  const standings = useMemo(() => standingsFor(run), [run]);

  const standingFor = useMemo(
    () => (programme) => standings.for(programme.college_name, programme.sport),
    [standings],
  );

  const isOnList = useMemo(
    () => (collegeName) => byCollegeName?.has?.(collegeName) ?? false,
    [byCollegeName],
  );

  /**
   * ON CLOSE, NOT ON A CALLBACK — the same two bounded athlete-level reads the
   * V1 tab makes for the same reason. `ManualOutreachDialog` composes through
   * `EmailComposer` and reports its own results; this never learns whether a
   * draft was created, so it re-asks at the one moment something may have
   * changed. It polls nothing and it sends nothing.
   */
  const closeManualOutreach = (isOpen) => {
    if (isOpen) return;
    setManualTarget(null);
    reloadPendingDrafts();
    reloadContact();
  };

  /**
   * NO OPTIMISTIC UPDATE — carried over verbatim in spirit from the V1 tab.
   * The pending row IS the outstanding obligation; removing it on a request
   * that then failed would say a message is accounted for when it is not.
   */
  const decide = async (draft, call, message) => {
    const relationship = byCollegeName?.get(draft.college_name);
    if (!relationship) {
      setDraftError({ sendId: draft.send_id, message });
      return;
    }
    setDraftError(null);
    try {
      await call(player.id, relationship.id, draft.send_id);
    } catch (err) {
      setDraftError({ sendId: draft.send_id, message: err?.message || message });
      return;
    }
    reloadPendingDrafts();
    reloadContact();
  };

  return (
    <div className="space-y-4" data-testid="tab-specific-schools">
      {/*
        §H. THE SEARCH LIVES HERE, where the list it adds to is.

        It was a floating control above the ranking, which put "add a school
        somebody asked for" in the middle of "here is how we ranked every
        school" — two different jobs sharing one place on the page. The
        standing it reports comes from the run that is on screen.
      */}
      <MatchmakingSpecificSearch
        player={player}
        run={run}
        onAdd={add}
        isOnList={isOnList}
        addPending={pending}
      />

      <SpecificSchools
        specific={specific}
        /**
         * NO V1 `recommendations` ARRAY. Under V2 the rank on a row is the
         * persisted run's rank, supplied by `standingFor` — not a position in
         * the V1 analysis file, which is a different engine's answer and would
         * be a second, quietly disagreeing number for the same school.
         */
        recommendations={null}
        standingFor={standingFor}
        loading={programmesLoading}
        failed={programmesFailed}
        pending={pending}
        error={programmeError}
        onRemove={withdraw}
        onManualOutreach={(relationship) => setManualTarget(relationship?.id ?? null)}
        onSetContactStance={setContactStance}
        onFlag={flag}
        onSaveNote={saveNote}
        onSetVisibility={setVisibility}
        contactByProgramme={contactByProgramme}
        contactUnavailable={contactUnavailable}
        contactKnown={contactKnown}
        pendingByProgramme={pendingByProgramme}
        draftError={draftError}
        onConfirmSent={(draft) => decide(draft, manualOutreach.confirmSent, CONFIRM_FAILED)}
        onDiscardDraft={(draft) => decide(draft, manualOutreach.discardDraft, DISCARD_FAILED)}
      />

      {manualTarget && (
        <ManualOutreachDialog
          player={player}
          relationshipId={manualTarget}
          open={!!manualTarget}
          onOpenChange={closeManualOutreach}
        />
      )}
    </div>
  );
}
