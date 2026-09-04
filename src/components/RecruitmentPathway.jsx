import React from 'react';
import { pathwayCopyFor, pathwayQualification } from '@/lib/pathwayEvidenceCopy';

/**
 * How athletes with this athlete's background have reached this programme.
 *
 * INSPECTION, NOT PROBABILITY. Nothing in this section is a forecast: a
 * programme that has recruited from New Zealand four times may take nobody
 * next year, and one that never has may sign this athlete tomorrow. The
 * section exists so an operator can see what the recruiting record actually
 * contains before deciding what to make of it, which is why there are no bars,
 * no percentages of fit and no colour that means good.
 *
 * IT DOES NOT REORDER. The comparator puts the athlete-specific pathway
 * evidence before the programme-wide measurements — 0 exceptions across 2,613
 * real sections — so the split below follows the payload rather than imposing
 * an order on it.
 *
 * THE AXES DO NOT MIX. Each row is built from one evidence object's own facts.
 * Two rows that sit next to each other, one naming a coach and one naming a
 * position, do not combine into a claim about that coach and that position.
 */

function MissingCopy({ kind }) {
  return (
    <p className="text-sm text-amber-600 dark:text-amber-500">
      No pathway wording for <code className="font-mono text-xs">{kind}</code> yet.
    </p>
  );
}

/** Per-intake rows for the position intake history. */
function Timeline({ rows }) {
  return (
    <dl className="mt-2 space-y-1 border-l border-border pl-3">
      {rows.map((row) => (
        <div key={row.label} className="flex gap-3 text-sm">
          <dt className="w-24 shrink-0 tabular-nums text-muted-foreground">{row.label}</dt>
          <dd className="text-muted-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Row({ item }) {
  const copy = pathwayCopyFor(item);
  if (!copy) return <li className="py-3"><MissingCopy kind={item.kind} /></li>;

  const qualification = pathwayQualification(item);
  return (
    <li className="py-3">
      <p className="font-medium leading-snug">{copy.headline}</p>
      {copy.detail && <p className="mt-0.5 text-sm text-muted-foreground">{copy.detail}</p>}
      {/* A named arrival or the players themselves — the detail a Top Reason
          states a count for and stops. */}
      {copy.names?.length > 0 && (
        <p className="mt-0.5 text-sm text-muted-foreground">{copy.names.join(', ')}</p>
      )}
      {copy.timeline && <Timeline rows={copy.timeline} />}
      {qualification && (
        <p className="mt-1 text-xs text-muted-foreground/80">{qualification}</p>
      )}
    </li>
  );
}

export default function RecruitmentPathway({ items = [] }) {
  /**
   * Two groups, taken from each item's own scope.
   *
   * `scope` is derived in the copy module from the decision class the server
   * assigned: evidence cut to this athlete's country, region or position on
   * one side, measurements of the whole squad and the whole intake on the
   * other. Both are worth reading and they answer different questions, so the
   * programme-wide rows sit beneath a rule rather than competing with the
   * arrivals that actually resemble this athlete.
   */
  const athlete = items.filter((i) => pathwayCopyFor(i)?.scope !== 'programme');
  const programme = items.filter((i) => pathwayCopyFor(i)?.scope === 'programme');

  return (
    <section className="mt-5 border-t border-border pt-4">
      <h4 className="font-heading text-sm font-semibold">Recruitment pathway</h4>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Recruiting history and roster make-up showing how athletes with a similar background
        have reached this programme. This is a record of what has happened, not an indication
        of what this programme will do next.
      </p>

      {items.length === 0 ? (
        // Not "no pathway". We hold no recruiting history we can read for this
        // programme, which says nothing about whether it would recruit this
        // athlete.
        <p className="mt-3 text-sm text-muted-foreground">
          No recruiting-pathway evidence on file for this programme.
        </p>
      ) : (
        <>
          <ul className="mt-1 divide-y divide-border">
            {athlete.map((item) => <Row key={item.kind} item={item} />)}
          </ul>
          {programme.length > 0 && (
            <div className="mt-3 border-t border-dashed border-border pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Squad and intake overall
              </p>
              <ul className="divide-y divide-border">
                {programme.map((item) => <Row key={item.kind} item={item} />)}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
