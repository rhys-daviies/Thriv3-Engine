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
export default function EvidenceDetails({ item, label = 'Provenance' }) {
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
        // The same focus treatment the app's Button uses, so a keyboard user
        // sees this control the way they see every other one.
        className="rounded-sm text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* One word, because a rich programme carries twenty-seven of these
            down one page and "Where this comes from" repeated that often is
            the loudest text on the screen. */}
        {open ? 'Hide provenance' : label}
      </button>
      <div id={panelId} hidden={!open}>
        <dl className="mt-2 space-y-1 border-l border-border pl-3">
          {rows.map((row) => (
            <div key={row.label} className="flex gap-3 text-xs">
              {/* Narrower label column on a phone: 160px of a 375px screen
                  left "Roster records — projected minutes" wrapping to four
                  lines beside a mostly empty gutter. */}
              <dt className="w-28 shrink-0 text-muted-foreground sm:w-40">{row.label}</dt>
              <dd className="text-muted-foreground">
                {row.href ? (
                  /**
                   * The one link in the drawer, and only where the server
                   * verified the page belongs to this programme.
                   *
                   * "View source", not "proof" — the page is the record the
                   * claim was read from, and for a count that is the same
                   * thing, but the word must not promise more than that.
                   *
                   * `target`/`rel` follow the app's existing external-link
                   * pattern (CollegeCard, PublishCard) rather than inventing a
                   * second one, and the focus ring is the same treatment the
                   * disclosure button above already uses.
                   */
                  <a
                    href={row.href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-sm text-primary underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {row.value}
                  </a>
                ) : row.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
