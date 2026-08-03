import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PlayerFormSteps from '@/components/PlayerFormSteps';
import { entities } from '@/api/client';
import { sanitizePlayerData } from '@/pages/NewPlayer';

export default function EditPlayer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [player, setPlayer] = useState(null);

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
      });
    });
  }, [id]);

  async function handleSubmit(formData) {
    const sanitized = sanitizePlayerData(formData);
    sanitized.recommendations = null;
    sanitized.status = 'New';
    await entities.Player.update(id, sanitized);
    navigate(`/player/${id}`);
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
