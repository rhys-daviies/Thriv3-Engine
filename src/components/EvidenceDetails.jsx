import React, { useId, useState } from 'react';
import { provenanceRows } from '@/lib/evidenceProvenance';

/**
 * One click from a claim to what it rests on.
 *
 * THE SAME AFFORDANCE ON EVERY ROW of every section, including the primary and
 * each supporting item of a Top Reason. Six provenance implementations would
 * drift, and an operator who learns the gesture once should not have to learn
 * it again three sections down.
 *
 * An inline disclosure rather than a modal: the question it answers — what
 * period, whose data, compared against what — is asked while reading the row
 * above it, and a dialog would take that row off the screen to answer it.
 *
 * COLLAPSED BY DEFAULT, and it changes nothing when opened. It adds no
 * ordering, no selection, and no navigation; the row above is untouched.
 */
export default function EvidenceDetails({ item, label = 'Where this comes from' }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const rows = provenanceRows(item);
  // Nothing to show, no control. An empty disclosure is a promise the page
  // cannot keep, and every real item has at least a source.
  if (!rows.length) return null;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        // A real button: focusable, activated by Enter and Space without any
        // key handling of our own, and announced with its state.
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        {open ? 'Hide provenance' : label}
      </button>
      <div id={panelId} hidden={!open}>
        <dl className="mt-2 space-y-1 border-l border-border pl-3">
          {rows.map((row) => (
            <div key={row.label} className="flex gap-3 text-xs">
              <dt className="w-40 shrink-0 text-muted-foreground">{row.label}</dt>
              <dd className="text-muted-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
