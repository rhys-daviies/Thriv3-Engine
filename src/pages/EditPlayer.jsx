import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import PlayerFormSteps from '@/components/PlayerFormSteps';
import { entities } from '@/api/client';
import { sanitizePlayerData } from '@/pages/NewPlayer';
import { changedPreviousEngineInputs } from '@shared/matchingInputFields.js';

/**
 * Where a save returns to — A9.4 §H.
 *
 * An allow-list of ONE, not a free-text destination. `?return=` arrives in a
 * URL, and a URL is something anyone can hand an operator; resolving it into
 * `navigate()` would be an open redirect in a product that holds athlete
 * records. Anything unrecognised falls back to the player page, which is where
 * this has always gone.
 */
const RETURN_TO = Object.freeze({ matching: 'matching' });

/**
 * Which form step to open on - Phase 5 (#12). Allow-listed like `return`: the
 * family contribution lives on step 2, and the matching screen's "Add the
 * family contribution" used to land on step 1. Unknown values open step 1.
 */
const OPEN_STEP = Object.freeze({ contribution: 1 });

export default function EditPlayer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [player, setPlayer] = useState(null);
  /** The record as stored, before the form's display defaults: what a save is compared against. */
  const [stored, setStored] = useState(null);
  const returnTab = RETURN_TO[searchParams.get('return')] ?? null;
  const initialStep = OPEN_STEP[searchParams.get('step')] ?? 0;

  useEffect(() => {
    entities.Player.get(id).then((p) => {
      setStored(p);
      setPlayer({
        ...p,
        preferred_divisions: p.preferred_divisions || [],
        preferred_conferences: p.preferred_conferences || [],
        gpa: p.gpa ?? '',
        football_ability: p.football_ability ?? 5,
        academic_importance: p.academic_importance ?? 'Not Important',
        secondary_position: p.secondary_position || 'None',
        sport_attributes: p.sport_attributes || {},
        video_chapters: p.video_chapters || [],
      });
    });
  }, [id]);

  async function handleSubmit(formData) {
    const sanitized = sanitizePlayerData(formData);

    // sanitizePlayerData drops empty values, which is right when creating but
    // wrong when editing: a field the user deliberately cleared would keep its
    // previous value. Anything the form knows about and the sanitiser removed
    // is an intentional clear.
    for (const key of Object.keys(formData)) {
      if (!(key in sanitized)) sanitized[key] = null;
    }

    /**
     * PHASE 5 (#5): ONLY A MATCHING CHANGE RETIRES THE PREVIOUS ENGINE'S ANALYSIS.
     *
     * This used to clear `recommendations` (the previous engine's stored list,
     * which Decision Evidence and Evidence still read) and reset `status` on
     * EVERY save - so assigning a representative or fixing a bio threw the list
     * away. Now it is cleared only when a field THAT ENGINE reads has changed
     * (PREVIOUS_ENGINE_INPUT_FIELDS in shared/matchingInputFields.js, pinned to
     * what normaliseAthlete reads). Matcher V2's own staleness is separate: it
     * compares the run's snapshot of V2's inputs on the server, and a V2 run is
     * never touched here.
     */
    if (changedPreviousEngineInputs(stored ?? player, sanitized).length > 0) {
      sanitized.recommendations = null;
      sanitized.status = 'New';
    }
    await entities.Player.update(id, sanitized);
    /**
     * SAVING RETURNS. IT DOES NOT RANK — A9.4 §M.
     *
     * This navigates and nothing else. No matchmaking POST happens here, on
     * any path: a run is a dated historical record of somebody asking, and
     * creating one as a side effect of saving a profile would turn the history
     * into a log of form submissions. The operator lands on Matchmaking with
     * their previous run still showing, now marked outdated, and chooses.
     *
     * The V1 clear above, when a matching input changed, does not reach
     * `matchmaking_runs`, which is why a V2 run survives the edit that makes it
     * stale.
     */
    navigate(returnTab ? `/player/${id}/${returnTab}` : `/player/${id}`);
  }

  if (!player) return <div className="text-sm text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <p className="text-xs font-semibold tracking-wide text-primary uppercase">Recruitment Console</p>
        <h1 className="font-heading text-2xl font-bold mt-1">Edit Player Profile</h1>
        <p className="text-sm text-muted-foreground mt-1" data-testid="edit-save-effect">
          Changing a field matching uses marks this athlete&rsquo;s current matches as outdated; refresh them on the Analysis &amp; Matching tab. Other changes leave matches as they are.
        </p>
      </div>
      <PlayerFormSteps initialData={player} sport={player.sport} onSubmit={handleSubmit} submitLabel="Save Changes" initialStep={initialStep} />
    </div>
  );
}
