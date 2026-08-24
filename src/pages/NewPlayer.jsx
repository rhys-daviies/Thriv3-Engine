import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PlayerFormSteps from '@/components/PlayerFormSteps';
import { entities } from '@/api/client';

export function sanitizePlayerData(raw) {
  const out = { ...raw };
  out.gpa = out.gpa === '' || out.gpa === null || out.gpa === undefined ? undefined : parseFloat(out.gpa);
  out.graduation_year = out.graduation_year === '' ? undefined : Number(out.graduation_year);
  out.recruiting_class_year = out.recruiting_class_year === '' ? undefined : Number(out.recruiting_class_year);
  out.sat_score = out.sat_score === '' ? undefined : Number(out.sat_score);
  out.act_score = out.act_score === '' ? undefined : Number(out.act_score);
  out.height_cm = out.height_cm === '' ? undefined : Number(out.height_cm);
  out.weight_kg = out.weight_kg === '' ? undefined : Number(out.weight_kg);
  out.academic_importance = out.academic_importance === 'Not Important' ? 'Not Important' : String(out.academic_importance);

  for (const key of Object.keys(out)) {
    if (out[key] === undefined || out[key] === '' || out[key] === null) delete out[key];
  }

  // A ranking reset to null must reach the server as an explicit empty array,
  // not be dropped by the loop above — dropping it leaves the previous ranking
  // in place, so "Reset to defaults" would appear to do nothing on save.
  if (raw.criterion_ranking === null || raw.criterion_ranking === undefined) out.criterion_ranking = [];
  return out;
}

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
