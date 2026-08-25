import React, { useMemo, useState } from 'react';
import { GripVertical, ChevronUp, ChevronDown, RotateCcw, Sparkles, Info, ArrowUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  criterionCopy, defaultRanking, moveItem as move, readRanking, resolveWeights, boostedCriteria,
} from '@/lib/criteriaRanking';
import { resolveCouplings } from '@shared/matching/couplings.js';
import { normaliseAthlete } from '@shared/matching/pool.js';

/**
 * Lets an operator rank what matters to this athlete and see, before
 * committing, exactly what it does to the weighting.
 *
 * A ranking rather than six number boxes, because that is how a family talks
 * about it — "cost first, then staying near home" — and because the mapping
 * from rank to weight is a tuning decision that will keep moving. What gets
 * stored is the ranking; the numbers are derived.
 */
export default function CriteriaRanking({ player, onApply, busy }) {
  const stored = useMemo(() => readRanking(player.criterion_ranking), [player.criterion_ranking]);

  // Opening the panel shows where things already stand, so the first drag is
  // a change to something visible rather than to an arbitrary starting order.
  const baseline = useMemo(
    () => stored || defaultRanking(player.academic_importance),
    [stored, player.academic_importance]
  );

  const [ranking, setRanking] = useState(baseline);
  const [dragIndex, setDragIndex] = useState(null);
  const dirty = ranking.join('|') !== baseline.join('|');

  const athlete = useMemo(() => normaliseAthlete(player), [player]);
  const { label: LABEL, blurb: BLURB } = criterionCopy(athlete.origin);
  const coupled = useMemo(() => resolveCouplings(athlete), [athlete]);

  // Show the weights that are actually in force until the operator changes
  // something, then switch to a preview of what applying would do. Rendering
  // the preview all the time reads as "these are your current weights", and
  // for an athlete with no saved ranking they are not — applying a ranking
  // replaces the intake-derived weighting wholesale.
  const previewing = dirty || Boolean(stored);
  const weights = useMemo(
    () => resolveWeights({
      academicImportance: player.academic_importance,
      ranking: previewing ? ranking : null,
      couplings: coupled.weights,
      overrides: athlete.weightOverrides,
    }),
    [player.academic_importance, ranking, previewing, coupled, athlete]
  );
  // A coupling can put a lower-ranked criterion above a higher-ranked one.
  // Correct, but an ordered list whose numbers disagree with its order reads
  // as a bug unless the boosted rows say so.
  const boosted = useMemo(
    () => boostedCriteria({
      academicImportance: player.academic_importance,
      ranking: previewing ? ranking : null,
      couplings: coupled.weights,
    }),
    [player.academic_importance, ranking, previewing, coupled]
  );

  const academicRanked = ranking.includes('academic');
  const academicSlider = player.academic_importance;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-heading text-base font-semibold">Match priorities</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Drag to rank what matters most to {player.full_name?.split(' ')[0] || 'this athlete'}.{' '}
            {dirty
              ? 'The percentages preview what applying would do.'
              : stored
                ? 'These are the weights currently in force.'
                : 'These are the weights currently in force, from the intake form.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setRanking(baseline)} disabled={!dirty || busy}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
          </Button>
          <Button size="sm" onClick={() => onApply(ranking)} disabled={!dirty || busy}>
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            {busy ? 'Re-ranking…' : 'Apply & re-rank'}
          </Button>
        </div>
      </div>

      <ol className="space-y-1.5">
        {ranking.map((key, i) => {
          const share = weights[key] || 0;
          return (
            <li
              key={key}
              draggable={!busy}
              onDragStart={() => setDragIndex(i)}
              onDragEnd={() => setDragIndex(null)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragIndex === null || dragIndex === i) return;
                setRanking((r) => move(r, dragIndex, i));
                setDragIndex(i);
              }}
              onDrop={(e) => { e.preventDefault(); setDragIndex(null); }}
              className={cn(
                'flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-all',
                dragIndex === i ? 'opacity-50 border-primary/40' : 'hover:border-primary/30',
                !busy && 'cursor-grab active:cursor-grabbing'
              )}
            >
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">
                {i + 1}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{LABEL[key]}</p>
                <p className="text-xs text-muted-foreground truncate">{BLURB[key]}</p>
              </div>

              {/* The bar is the point: a ranking is abstract until you can see
                  what it does to the arithmetic. */}
              <div className="hidden sm:block w-24 shrink-0">
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, share * 250)}%` }} />
                </div>
              </div>
              <span className={cn(
                'w-14 shrink-0 text-right text-sm font-semibold tabular-nums',
                boosted.has(key) ? 'text-amber-400' : dirty && 'text-primary'
              )}>
                {boosted.has(key) && <ArrowUp className="mr-0.5 inline h-3 w-3" aria-hidden />}
                {(100 * share).toFixed(0)}%
              </span>

              <span className="flex shrink-0 flex-col">
                <button
                  type="button"
                  aria-label={`Move ${LABEL[key]} up`}
                  disabled={i === 0 || busy}
                  onClick={() => setRanking((r) => move(r, i, i - 1))}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-25"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${LABEL[key]} down`}
                  disabled={i === ranking.length - 1 || busy}
                  onClick={() => setRanking((r) => move(r, i, i + 1))}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-25"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </span>
            </li>
          );
        })}
      </ol>

      {/* Couplings change the weights behind the operator's back unless the
          panel says so — the percentages above already include them. */}
      {coupled.notes.length > 0 && (
        <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 p-3 space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
            <Info className="h-3.5 w-3.5" /> Adjusted for this athlete&apos;s circumstances
          </p>
          {boosted.size > 0 && (
            <p className="text-xs text-amber-400/80">
              <ArrowUp className="mr-0.5 inline h-3 w-3" aria-hidden />
              marks a criterion weighted above its rank.
            </p>
          )}
          {coupled.notes.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">{note}</p>
          ))}
        </div>
      )}

      {academicRanked && academicSlider != null && academicSlider !== 'Not Important' && (
        <p className="text-xs text-muted-foreground">
          Academics was set to <Badge variant="muted">{academicSlider}/10</Badge> on the intake form. This ranking
          overrides that.
        </p>
      )}

      {dirty && (
        <p className="text-xs text-muted-foreground">
          Nothing is saved until you apply — re-ranking recalculates every program.
          {!stored && ' Applying a ranking replaces the weighting derived from the intake form.'}
        </p>
      )}
    </Card>
  );
}
