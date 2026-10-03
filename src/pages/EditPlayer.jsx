import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import PlayerFormSteps from '@/components/PlayerFormSteps';
import { entities } from '@/api/client';
import { sanitizePlayerData } from '@/pages/NewPlayer';

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

export default function EditPlayer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [player, setPlayer] = useState(null);
  const returnTab = RETURN_TO[searchParams.get('return')] ?? null;

  useEffect(() => {
    entities.Player.get(id).then((p) => {
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

    sanitized.recommendations = null;
    sanitized.status = 'New';
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
     * The V1 line above (`recommendations = null`) is untouched and still
     * clears V1's pointer. It does not reach `matchmaking_runs`, which is why
     * a V2 run survives the edit that makes it stale.
     */
    navigate(returnTab ? `/player/${id}/${returnTab}` : `/player/${id}`);
  }

  if (!player) return <div className="text-sm text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <p className="text-xs font-semibold tracking-wide text-primary uppercase">Recruitment Console</p>
        <h1 className="font-heading text-2xl font-bold mt-1">Edit Player Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Saving will clear existing match recommendations — you'll need to re-analyze.</p>
      </div>
      <PlayerFormSteps initialData={player} sport={player.sport} onSubmit={handleSubmit} submitLabel="Save Changes" />
    </div>
  );
}
