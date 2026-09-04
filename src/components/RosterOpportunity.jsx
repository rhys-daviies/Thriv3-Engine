import React from 'react';
import { rosterCopyFor, rosterQualification } from '@/lib/rosterEvidenceCopy';

/**
 * The roster evidence behind a programme's opening, laid out for inspection.
 *
 * An evidence file rather than a dashboard: compact rows, one measurement
 * each, in the order the server ranked them. Seven cards with seven numbers in
 * them would make every measurement look equally decisive, which is the
 * opposite of what this section is for.
 *
 * IT DOES NOT REORDER, and it does not need to. The comparator already puts
 * openings before context and leaves SQUAD_GRADUATION last — checked across
 * 3,498 real athlete-programme pairs, with zero exceptions in either. Imposing
 * subgroups of my own would be a second ranking dressed as a layout.
 *
 * NOTHING HERE IS ADDED UP. The graduating class, the projected starters and
 * the eligibility cliff count overlapping populations over different windows,
 * and each keeps its own number, its own names and its own years. The only
 * relationship the page asserts between them is that they sit near each other.
 */

/** A kind this screen has no way to present. Shown, never skipped. */
function MissingCopy({ kind }) {
  return (
    <p className="text-sm text-amber-600 dark:text-amber-500">
      No roster wording for <code className="font-mono text-xs">{kind}</code> yet.
    </p>
  );
}

/** The per-year rows for a cliff that spans more than one season. */
function Timeline({ rows }) {
  return (
    <dl className="mt-2 space-y-1 border-l border-border pl-3">
      {rows.map((row) => (
        <div key={row.label} className="flex gap-3 text-sm">
          <dt className="w-12 shrink-0 tabular-nums text-muted-foreground">{row.label}</dt>
          <dd className="text-muted-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Row({ item }) {
  const copy = rosterCopyFor(item);
  if (!copy) return <li className="py-3"><MissingCopy kind={item.kind} /></li>;

  const qualification = rosterQualification(item);
  return (
    <li className="py-3">
      <p className="font-medium leading-snug">{copy.headline}</p>
      {copy.detail && <p className="mt-0.5 text-sm text-muted-foreground">{copy.detail}</p>}
      {/* Names as secondary detail. This is the depth the section adds over
          the Top Reason above, which states the count and stops. */}
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

export default function RosterOpportunity({ items = [] }) {
  /**
   * Split by what the facts say, not by a grouping invented here.
   *
   * SQUAD_GRADUATION is the one roster kind whose facts name no position — it
   * counts the whole squad. Keeping it beneath a rule and in smaller type is
   * what stops a programme-wide number competing with the evidence about this
   * athlete's own position group, which is the question the section asks.
   */
  const position = items.filter((i) => rosterCopyFor(i)?.scope !== 'programme');
  const programme = items.filter((i) => rosterCopyFor(i)?.scope === 'programme');

  return (
    <section className="mt-5 border-t border-border pt-4">
      <h4 className="font-heading text-sm font-semibold">Roster opportunity</h4>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Current roster structure and upcoming turnover at this athlete’s position. These are
        separate measurements of overlapping groups — they are not steps in one calculation,
        and none of them is a claim about playing time.
      </p>

      {items.length === 0 ? (
        // Not "no roster opportunity". We did not read anything about this
        // squad, which is a gap in what we hold rather than a finding about
        // the programme. Lighter than the page-level zero state, because the
        // page has already said whether anything at all was found.
        <p className="mt-3 text-sm text-muted-foreground">
          No roster evidence on file for this programme.
        </p>
      ) : (
        <>
          <ul className="mt-1 divide-y divide-border">
            {position.map((item) => <Row key={item.kind} item={item} />)}
          </ul>
          {programme.length > 0 && (
            <div className="mt-3 border-t border-dashed border-border pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Across the whole squad
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
