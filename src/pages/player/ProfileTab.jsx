import React from 'react';
import { Card } from '@/components/ui/card';
import { usePlayerWorkspace } from './PlayerWorkspace';

export default function ProfileTab() {
  const { player } = usePlayerWorkspace();

  return (
    <div className="grid grid-cols-3 gap-3">
      <Card className="p-4 text-center">
        <p className="text-xs text-muted-foreground">Divisions</p>
        <p className="font-semibold mt-1">{(player.preferred_divisions || []).join(', ') || 'Any'}</p>
      </Card>
      <Card className="p-4 text-center">
        <p className="text-xs text-muted-foreground">GPA</p>
        <p className="font-semibold mt-1">{player.gpa ?? '—'}</p>
      </Card>
      <Card className="p-4 text-center">
        <p className="text-xs text-muted-foreground">Budget</p>
        <p className="font-semibold mt-1">{player.budget_range || '—'}</p>
      </Card>
    </div>
  );
}
