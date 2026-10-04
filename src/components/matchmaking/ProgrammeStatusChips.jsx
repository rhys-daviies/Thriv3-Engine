import React from 'react';
import { Badge } from '@/components/ui/badge';
import { programmeStatuses } from '@/lib/programmeStatus';

/**
 * THE RELATIONSHIP CHIPS, RENDERED THE SAME WAY EVERYWHERE — A11 §4, §10.
 *
 * Presentation only. Every decision about WHAT to show lives in
 * `src/lib/programmeStatus.js`, so a surface cannot accidentally show a
 * different set from its neighbour — which is the whole point of §4.
 *
 * Renders NOTHING when there is nothing true to say. A programme nobody has
 * requested, written to or flagged produces no element at all, not a row of
 * empty chips.
 */
export default function ProgrammeStatusChips({
  collegeName, sport, relationships, contactByProgramme, contactKnown = false,
  className = '',
}) {
  const chips = programmeStatuses({
    collegeName, sport, relationships, contactByProgramme, contactKnown,
  });
  if (!chips.length) return null;

  return (
    <>
      {chips.map((c) => (
        <Badge
          key={`${c.kind}-${c.label}`}
          variant={c.tone}
          className={className}
          data-testid={`status-chip-${c.kind}`}
        >
          {c.label}
        </Badge>
      ))}
    </>
  );
}
