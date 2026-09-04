import React from 'react';
import { operatorCopyFor, DECISION_CLASS_LABEL } from '@/lib/operatorEvidenceCopy';

/**
 * The ranked reasons this programme is worth an operator's attention.
 *
 * A LIST, not cards. Four reasons in four cards read as four separate findings
 * of equal weight; the whole point of this component is that the first one
 * matters most, and a numbered column says that without a single badge.
 *
 * IT DOES NOT SORT. The order is the server's — a comparator with its own
 * tests, over decision class, specificity, confidence and strength — and
 * re-sorting here would mean the screen and the API disagreed about what
 * mattered most, with no way to tell which was right.
 *
 * A GROUP IS ONE REASON. `supporting` items sit inside their primary and never
 * take a rank of their own. Three roster items can belong to one story and
 * still count different populations over different windows, so they stay
 * separate lines under one heading rather than being merged into one number.
 */

/** A small class tag. Muted on purpose — the rank already carries the weight. */
function ClassTag({ decisionClass }) {
  const label = DECISION_CLASS_LABEL[decisionClass];
  if (!label) return null;
  return (
    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}

/**
 * A kind this screen has no words for.
 *
 * Shown rather than skipped. A reason dropped because the copy registry has no
 * entry for it is a reason the operator never learns we had, and the gap would
 * look identical to the programme simply not having one.
 */
function MissingCopy({ kind }) {
  return (
    <p className="text-sm text-amber-600 dark:text-amber-500">
      No operator wording for <code className="font-mono text-xs">{kind}</code> yet.
    </p>
  );
}

function Supporting({ items }) {
  if (!items.length) return null;
  return (
    <ul className="mt-2 space-y-1 border-l border-border pl-3">
      {items.map((item, i) => {
        const copy = operatorCopyFor(item, 'supporting');
        return (
          <li key={`${item.kind}-${i}`} className="text-sm text-muted-foreground">
            {/* One line. `operatorCopyFor` collapses a supporting item to a
                single string precisely so this cannot render the wrong one. */}
            {copy ? copy.conclusion : <MissingCopy kind={item.kind} />}
          </li>
        );
      })}
    </ul>
  );
}

export default function TopReasons({ reasons = [] }) {
  return (
    <ol className="divide-y divide-border">
      {reasons.map((reason, i) => {
        const copy = operatorCopyFor(reason.primary, 'primary');
        return (
          <li key={`${reason.dedupeGroup}-${reason.primary.kind}`} className="flex gap-4 py-4 first:pt-0 last:pb-0">
            <span
              aria-hidden="true"
              className="mt-0.5 w-5 shrink-0 text-right font-heading text-sm tabular-nums text-muted-foreground"
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              {copy ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium leading-snug">{copy.conclusion}</p>
                    <ClassTag decisionClass={reason.decisionClass} />
                  </div>
                  {copy.detail && (
                    <p className="mt-1 text-sm text-muted-foreground">{copy.detail}</p>
                  )}
                </>
              ) : (
                <MissingCopy kind={reason.primary.kind} />
              )}
              <Supporting items={reason.supporting ?? []} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
