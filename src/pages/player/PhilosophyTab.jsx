import React, { useEffect, useState } from 'react';
import { BookOpen, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { philosophy } from '@/api/client';
import { PhilosophyRow } from '@/components/philosophy/PhilosophyRow';
import { usePlayerWorkspace } from './PlayerWorkspace';

const PAGE_SIZE = 20;
const MAX_PAGE_BUTTONS = 5;

/**
 * Summaries, keyed by player and the exact set of schools asked for.
 *
 * Promises rather than values, so two renders of the same page share one
 * request; deleted on rejection, so a failure retries instead of sticking.
 */
const cache = new Map();
function loadSummaries(playerId, ids) {
  const key = `${playerId}|${[...ids].sort().join(',')}`;
  if (!cache.has(key)) {
    cache.set(key, philosophy.summaries(playerId, ids).catch((err) => {
      cache.delete(key);
      throw err;
    }));
  }
  return cache.get(key);
}

/**
 * What a first year at each matched programme has looked like, and who takes
 * the minutes when a place comes free.
 *
 * Paging is local rather than the workspace's shared `page`. Analysis &
 * Matching scopes its bulk-email recipient list to whichever twenty schools
 * that counter selects, so writing to it from here would silently retarget a
 * send from another tab.
 */
export default function PhilosophyTab() {
  const { player, recommendations, analyzing, onAnalyze } = usePlayerWorkspace();
  const [page, setPage] = useState(1);
  const [summaries, setSummaries] = useState({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const total = recommendations?.length ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const pageItems = recommendations ? recommendations.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];

  // A re-analysis can return a shorter list; without this the pager strands on
  // an empty page.
  useEffect(() => { setPage(1); }, [recommendations]);

  useEffect(() => {
    if (!player?.id || !pageItems.length) return undefined;
    const ids = pageItems.map((c) => c.id).filter(Boolean);
    if (!ids.length) return undefined;
    let cancelled = false;
    setLoading(true);
    setFailed(null);
    loadSummaries(player.id, ids)
      .then((res) => { if (!cancelled) setSummaries((prev) => ({ ...prev, ...res.summaries })); })
      .catch((err) => { if (!cancelled) setFailed(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.id, page, recommendations, attempt]);

  if (!recommendations && !analyzing) {
    return (
      <div className="py-20 text-center max-w-md mx-auto">
        <BookOpen className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <h2 className="font-heading text-lg font-semibold">No matches yet</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Program Philosophy reads the same schools Analysis &amp; Matching produces. Run the
          analysis and every match will appear here with its first-year record.
        </p>
        <Button className="mt-4" onClick={() => onAnalyze()}>
          <Sparkles className="h-4 w-4 mr-1.5" /> Find Matches
        </Button>
      </div>
    );
  }

  if (analyzing) {
    return (
      <p className="text-sm text-muted-foreground py-8">
        Analysis running — matches will appear here when it finishes.
      </p>
    );
  }

  const pageButtons = Array.from({ length: Math.min(totalPages, MAX_PAGE_BUTTONS) }, (_, i) => i + 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg font-semibold">Program philosophy</h2>
          <p className="text-sm text-muted-foreground">
            What a first year has looked like at each match, who has been in charge, and who takes
            the minutes when a place comes free. Two PDFs per school — one about the programme, one
            read for {player.full_name.split(' ')[0]}.
          </p>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">{total} schools</p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Reading roster history…</p>}

      {failed && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <strong>Could not read the roster history.</strong> {failed}{' '}
          <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}

      <div className="space-y-3">
        {pageItems.map((college) => (
          <PhilosophyRow
            key={college.id || college.name}
            college={college}
            summary={summaries[college.id]}
            player={player}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1 pt-2">
          {pageButtons.map((n) => (
            <Button key={n} size="sm" variant={n === page ? 'default' : 'outline'}
              onClick={() => setPage(n)}>
              {n}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
