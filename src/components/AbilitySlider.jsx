import React from 'react';
import { Button } from '@/components/ui/button';

function colorForValue(v) {
  if (v <= 3) return '#ef4444'; // red
  if (v <= 5) return '#f59e0b'; // amber
  if (v <= 7) return '#eab308'; // yellow
  if (v <= 9) return '#84cc16'; // lime
  return '#16a34a'; // green
}

/**
 * A 1–10, step 0.5 ability slider with a dynamic color gradient track.
 * When `notImportantOption` is set, an "N/A" button toggles the value
 * between a numeric score and the sentinel string "Not Important".
 *
 * `notImportantLabel` is what the readout says while that sentinel is set.
 * The default reads correctly for a preference; a control that sets a *floor*
 * needs to say "No minimum", because "Not Important" describes the wrong kind
 * of thing entirely.
 */
export default function AbilitySlider({
  value,
  onChange,
  lowLabel = 'Developmental',
  highLabel = 'Elite',
  notImportantOption = false,
  notImportantLabel = 'Not Important',
}) {
  const isNotImportant = value === 'Not Important';
  const numericValue = isNotImportant ? 5 : Number(value) || 5;
  const color = colorForValue(numericValue);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={1}
          max={10}
          step={0.5}
          value={numericValue}
          disabled={isNotImportant}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="flex-1 h-2 rounded-full appearance-none cursor-pointer disabled:opacity-40"
          style={{
            background: `linear-gradient(to right, ${color} 0%, ${color} ${((numericValue - 1) / 9) * 100}%, hsl(var(--muted)) ${((numericValue - 1) / 9) * 100}%, hsl(var(--muted)) 100%)`,
          }}
        />
        {notImportantOption && (
          <Button
            type="button"
            size="sm"
            variant={isNotImportant ? 'default' : 'outline'}
            onClick={() => onChange(isNotImportant ? 5 : 'Not Important')}
          >
            N/A
          </Button>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{lowLabel}</span>
        <span className="font-semibold text-foreground">
          {isNotImportant ? notImportantLabel : `${numericValue.toFixed(1)} / 10`}
        </span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}
