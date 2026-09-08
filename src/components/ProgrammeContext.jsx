import React from 'react';
import { contextCopyFor, contextWindow } from '@/lib/contextEvidenceCopy';
import EvidenceDetails from '@/components/EvidenceDetails';

/**
 * Who is in charge, and how much of their time in post we actually watched.
 *
 * THE LIGHTEST SECTION ON THE PAGE, on purpose. It holds one kind, it is
 * supporting information rather than a reason, and it is sized to say so: no
 * card, no heading weight matching the sections above, no ladder. Giving one
 * piece of context the visual footprint of four roster measurements would
 * misrepresent what it is.
 *
 * IT IS PROVENANCE, NOT A FINDING. A recruiting record that predates the
 * current coach reads differently from one that does not, and that is the
 * whole job. Nothing here says the programme is stable, unstable, rebuilding
 * or receptive, and nothing joins up with the coach-attributed arrivals in the
 * pathway section — those are a different claim, made by a different evidence
 * object, about people the coach actually signed.
 */

function MissingCopy({ kind }) {
  return (
    <p className="text-sm text-amber-600 dark:text-amber-500">
      No context wording for <code className="font-mono text-xs">{kind}</code> yet.
    </p>
  );
}

function Row({ item }) {
  const copy = contextCopyFor(item);
  if (!copy) return <li className="py-2"><MissingCopy kind={item.kind} /></li>;

  const window = contextWindow(item);
  return (
    <li className="py-2">
      <p className="text-sm">
        <span className="font-medium">{copy.headline}</span>
        {copy.tenure && <span className="text-muted-foreground"> · {copy.tenure}</span>}
      </p>
      {copy.detail && <p className="mt-0.5 text-sm text-muted-foreground">{copy.detail}</p>}
      {window && (
        <p className="mt-1 text-xs text-muted-foreground/80">
          {window.measured}
          {window.coverage ? ` · ${window.coverage}` : ''}
        </p>
      )}
      <EvidenceDetails item={item} />
    </li>
  );
}

export default function ProgrammeContext({ items = [] }) {
  return (
    <section className="mt-5 border-t border-border pt-4">
      <h4 className="font-heading text-sm font-semibold">Programme context</h4>
        {/* The description frames how to read the rows beneath it. With no
            rows there is nothing to frame, and on a programme where every
            section is empty the page said the same thing six times over —
            once at the top and once more under each heading. */}
        {items.length > 0 && (
        <p className="mt-0.5 text-sm text-muted-foreground">
        Coaching context that may change how the evidence above should be read — who has been in
        charge, and over how much of the record we hold.
        </p>
        )}

      {items.length === 0 ? (
        // Not "there is no relevant context". We hold no coaching records for
        // this programme, which is a gap in what we have collected.
        <p className="mt-3 text-sm text-muted-foreground">
          No programme-context evidence on file for this programme.
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {items.map((item) => <Row key={item.kind} item={item} />)}
        </ul>
      )}
    </section>
  );
}
