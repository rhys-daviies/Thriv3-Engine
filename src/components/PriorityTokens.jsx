import React, { useMemo, useState } from 'react';
import { GripVertical, RotateCcw, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CRITERION_KEYS, criterionCopy,
  defaultRanking, moveItem, readRanking, resolveWeights, boostedCriteria,
} from '@/lib/criteriaRanking';
import { resolveCouplings } from '@shared/matching/couplings.js';

/**
 * Rank an athlete's priorities as moveable tokens, inside the intake form.
 *
 * Tokens rather than the row list on the matching tab because this is a quick
 * pass while a player file is being built — the operator wants to shuffle six
 * chips into an order, not study contributions. The weight each one carries is
 * still shown, because a ranking is abstract until you can see what it does.
 *
 * Reordering is available three ways on purpose: drag for the mouse, the arrow
 * keys for the keyboard, and tap-to-select-then-tap-to-place for touch, where
 * HTML5 drag does not fire at all.
 */
export default function PriorityTokens({ value, onChange, budgetRange, state, origin }) {
  // Location means a different thing for an overseas athlete, so it is named
  // for what it actually scores rather than for the domestic case.
  const { short: CRITERION_SHORT, blurb: CRITERION_BLURB } = criterionCopy(origin);
  const fallback = useMemo(() => defaultRanking(), []);
  const ranking = readRanking(value) || fallback;
  const explicit = readRanking(value) !== null;

  const [dragIndex, setDragIndex] = useState(null);
  const [selected, setSelected] = useState(null);

  // Couplings are part of the weighting the operator is looking at, so the
  // percentages have to include them or the tokens lie about the outcome.
  const activeRanking = explicit ? ranking : null;
  // Same two passes as the ranker: academics' own weight decides whether the
  // admissibility coupling fires, so it has to be resolved before couplings.
  const coupled = useMemo(
    () => resolveCouplings(
      { budgetRange, state, origin },
      { academicWeight: resolveWeights({ ranking: activeRanking }).academic }
    ),
    [budgetRange, state, origin, activeRanking]
  );
  const weights = useMemo(
    () => resolveWeights({ ranking: activeRanking, couplings: coupled.weights }),
    [activeRanking, coupled]
  );
  const boosted = useMemo(
    () => boostedCriteria({ ranking: activeRanking, couplings: coupled.weights }),
    [activeRanking, coupled]
  );

  function commit(next) {
    if (next !== ranking) onChange(next);
  }

  function handleTokenClick(i) {
    if (selected === null) { setSelected(i); return; }
    if (selected === i) { setSelected(null); return; }
    commit(moveItem(ranking, selected, i));
    setSelected(null);
  }

  function handleKey(e, i) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const to = e.key === 'ArrowLeft' ? i - 1 : i + 1;
    const next = moveItem(ranking, i, to);
    if (next === ranking) return;
    commit(next);
    // Keep focus on the token that moved, so the arrow keys keep working.
    requestAnimationFrame(() => {
      e.target.parentElement?.querySelectorAll('[data-token]')?.[to]?.focus();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="list">
        {ranking.map((key, i) => {
          const share = weights[key] || 0;
          return (
            <button
              key={key}
              type="button"
              data-token
              role="listitem"
              draggable
              title={CRITERION_BLURB[key]}
              aria-label={`${CRITERION_SHORT[key]}, priority ${i + 1} of ${ranking.length}. Use the left and right arrow keys to move it.`}
              onDragStart={() => { setDragIndex(i); setSelected(null); }}
              onDragEnd={() => setDragIndex(null)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragIndex === null || dragIndex === i) return;
                commit(moveItem(ranking, dragIndex, i));
                setDragIndex(i);
              }}
              onDrop={(e) => { e.preventDefault(); setDragIndex(null); }}
              onClick={() => handleTokenClick(i)}
              onKeyDown={(e) => handleKey(e, i)}
              className={cn(
                'flex items-center gap-2 rounded-full border py-1.5 pl-2 pr-3 text-sm transition-all cursor-grab active:cursor-grabbing',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                dragIndex === i && 'opacity-50',
                selected === i
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card hover:border-primary/40'
              )}
            >
              <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums">
                {i + 1}
              </span>
              <span className="font-medium">{CRITERION_SHORT[key]}</span>
              <span className={cn('text-xs tabular-nums', boosted.has(key) ? 'text-amber-400' : 'text-muted-foreground')}>
                {boosted.has(key) && <ArrowUp className="mr-0.5 inline h-3 w-3" aria-hidden />}
                {(100 * share).toFixed(0)}%
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-xs text-muted-foreground">
          {selected !== null
            ? `Now click where ${CRITERION_SHORT[ranking[selected]]} should go.`
            : 'Drag a token, or click one and then click where it should go. Arrow keys work too.'}
        </p>
        {explicit && (
          <button
            type="button"
            onClick={() => { setSelected(null); onChange(null); }}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <RotateCcw className="h-3 w-3" /> Reset to defaults
          </button>
        )}
      </div>

      {coupled.notes.length > 0 && (
        <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 p-2.5 space-y-1">
          {boosted.size > 0 && (
            <p className="text-xs text-amber-400">
              <ArrowUp className="mr-0.5 inline h-3 w-3" aria-hidden />
              marks a priority weighted above its rank for this athlete&apos;s circumstances:
            </p>
          )}
          {coupled.notes.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">{note}</p>
          ))}
        </div>
      )}

      {!explicit && (
        <p className="text-xs text-muted-foreground italic">
          Not set — these are the defaults, adjusted for what has been entered so far. Move a token to override them.
        </p>
      )}
    </div>
  );
}

export { CRITERION_KEYS };
