import React, { useCallback, useEffect, useState } from 'react';
import { Radar, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { engagement } from '@/api/client';
import { usePlayerWorkspace } from './PlayerWorkspace';
import OutreachFunnel from '@/components/engagement/OutreachFunnel';
import CoachTable from '@/components/engagement/CoachTable';
import RetentionCurve from '@/components/engagement/RetentionCurve';
import ChapterEngagement from '@/components/engagement/ChapterEngagement';
import CoachDetail from '@/components/engagement/CoachDetail';

export default function EngagementTab() {
  const { player } = usePlayerWorkspace();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [sync, setSync] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);

  const load = useCallback(async () => {
    const result = await engagement.athlete(player.id);
    setData(result);
    return result;
  }, [player.id]);

  useEffect(() => {
    let cancelled = false;
    engagement.athlete(player.id).then((result) => {
      if (!cancelled) setData(result);
    });
    engagement.syncStatus().then((status) => {
      if (!cancelled) setSync(status);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [player.id]);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await engagement.syncNow();
      setSync((prev) => ({ ...prev, lastSyncedAt: result.syncedAt }));
      await load();
    } catch (err) {
      setSyncError(err.message);
    }
    setSyncing(false);
  }

  async function handleToggleResponded(coach) {
    setBusyId(coach.outreach_id);
    try {
      await engagement.setResponded(coach.outreach_id, !coach.responded_at);
      const refreshed = await load();
      if (selected) {
        setSelected(refreshed.coaches.find((c) => c.outreach_id === selected.outreach_id) || null);
      }
    } finally {
      setBusyId(null);
    }
  }

  if (!data) return <p className="text-sm text-muted-foreground">Loading engagement…</p>;

  if (data.funnel.sent === 0) {
    return (
      <div className="text-center py-20 max-w-md mx-auto">
        <Radar className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <p className="font-heading text-lg font-semibold">No outreach sent yet</p>
        <p className="text-sm text-muted-foreground mt-2">
          Once this athlete's profile has been sent to coaches, you will see which coaches
          opened it, how much film they watched, and who came back for a second look.
        </p>
      </div>
    );
  }

  if (selected) {
    return <CoachDetail coach={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="space-y-4">
      {sync?.configured && (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-border bg-card px-4 py-2.5">
          <p className="text-xs text-muted-foreground">
            {sync.lastSyncedAt
              ? `Last pulled from the collector ${new Date(sync.lastSyncedAt).toLocaleString()}`
              : 'Not yet pulled from the collector'}
            {syncError && <span className="text-destructive"> — {syncError}</span>}
          </p>
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>
      )}

      <OutreachFunnel funnel={data.funnel} />
      <CoachTable
        coaches={data.coaches}
        onSelect={setSelected}
        onToggleResponded={handleToggleResponded}
        busyId={busyId}
      />
      <RetentionCurve retention={data.retention} />
      <ChapterEngagement chapters={data.chapters} />
    </div>
  );
}
