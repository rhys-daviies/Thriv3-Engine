import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PlayerFormSteps from '@/components/PlayerFormSteps';
import { entities } from '@/api/client';
import { sanitizePlayerData } from '@/lib/playerPayload';

export { sanitizePlayerData } from '@/lib/playerPayload';

export default function NewPlayer() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sport = searchParams.get('sport') || 'mens-soccer';

  async function handleSubmit(formData) {
    const sanitized = sanitizePlayerData(formData);
    sanitized.sport = sport;
    const player = await entities.Player.create(sanitized);
    navigate(`/player/${player.id}`);
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <p className="text-xs font-semibold tracking-wide text-primary uppercase">Recruitment Console</p>
        <h1 className="font-heading text-2xl font-bold mt-1">New Player File</h1>
      </div>
      <PlayerFormSteps sport={sport} onSubmit={handleSubmit} submitLabel="Create Player" />
    </div>
  );
}
