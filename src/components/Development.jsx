import React from 'react';
import { developmentCopyFor, developmentWindow, BAND_ORDER } from '@/lib/developmentEvidenceCopy';
import EvidenceDetails from '@/components/EvidenceDetails';

/**
 * What has happened to first-year players at this programme.
 *
 * MEASUREMENTS, NOT A VERDICT ON THE PROGRAMME. All four kinds here are
 * neutral: none is a top reason, none carries a polarity, and nothing in this
 * component adds one. There is no colour that means good, no arrow, no score.
 * A programme whose most-used first-year plays more minutes than three
 * quarters of the pool is doing something measurable — whether it is the right
 * place for this athlete is a judgement the operator makes with the rest of
 * the page.
 *
 * OPEN BY DEFAULT, which on this surface simply means rendered. Nothing else
 * on the Decision Evidence page collapses, and adding an accordion for one
 * section would make this the only thing an operator has to open.
 *
 * The measurements are not ranked against each other and are not numbered.
 * They answer four different questions and the order is the server's.
 */

function MissingCopy({ kind }) {
  return (
    <p className="text-sm text-amber-600 dark:text-amber-500">
      No development wording for <code className="font-mono text-xs">{kind}</code> yet.
    </p>
  );
}

/**
 * The four bands as a position marker.
 *
 * Four equal ticks with one filled — no gradient, no red-to-green, no width
 * that implies magnitude. It says where in the pool this programme sits and
 * refuses to say whether that is good, which is the entire design brief for
 * this measurement.
 */
function BandScale({ band }) {
  const at = BAND_ORDER.indexOf(band);
  if (at < 0) return null;
  return (
    <div className="mt-2 flex items-center gap-1" aria-hidden="true">
      {BAND_ORDER.map((key, i) => (
        <span
          key={key}
          className={`h-1.5 w-8 rounded-full ${i === at ? 'bg-foreground/70' : 'bg-border'}`}
        />
      ))}
    </div>
  );
}

/** Ladder rows: one line per rank, with the range and the measurement's labels. */
function Ladder({ rows }) {
  return (
    <ol className="mt-2 space-y-1 border-l border-border pl-3">
      {rows.map((row) => (
        <li key={row.rank} className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="w-6 shrink-0 tabular-nums text-muted-foreground">{row.rank}</span>
          <span className="tabular-nums">{row.value} min</span>
          {row.range && <span className="text-muted-foreground">({row.range})</span>}
          {/* The measurement's own band and agreement labels, carried through
              as words rather than turned into a colour. */}
          {row.band && <span className="text-xs text-muted-foreground">{row.band}</span>}
          {row.agreement && <span className="text-xs text-muted-foreground/70">{row.agreement}</span>}
        </li>
      ))}
    </ol>
  );
}

/** Season rows for the programme pattern. */
function Seasons({ rows }) {
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
  const copy = developmentCopyFor(item);
  if (!copy) return <li className="py-3"><MissingCopy kind={item.kind} /></li>;

  const window = developmentWindow(item);
  return (
    <li className="py-3">
      <p className="font-medium leading-snug">{copy.headline}</p>
      {copy.detail && <p className="mt-0.5 text-sm text-muted-foreground">{copy.detail}</p>}
      {copy.band && <BandScale band={copy.band} />}
      {copy.shares && (
        <dl className="mt-2 space-y-1 border-l border-border pl-3">
          {copy.shares.map(([label, value]) => (
            <div key={label} className="flex gap-3 text-sm">
              <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
              <dd className="tabular-nums text-muted-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {copy.ladder && <Ladder rows={copy.ladder} />}
      {copy.seasons?.length > 0 && <Seasons rows={copy.seasons} />}
      {window && (
        <p className="mt-1 text-xs text-muted-foreground/80">
          {window.measured}
          {/* No bare "n=" here: `window.n` counts players for one kind and
              seasons for another, so one label would carry three meanings.
              Each measurement states its own sample in its own words. */}
          {/* Coverage is stated only when there is something to state. An
              empty `seasonsUnread` means the window was checked and nothing
              was missing, which needs no sentence; a null one means we cannot
              say, which does. */}
          {window.coverage ? ` · ${window.coverage}` : ''}
        </p>
      )}
      <EvidenceDetails item={item} />
    </li>
  );
}

export default function Development({ items = [] }) {
  const athlete = items.filter((i) => developmentCopyFor(i)?.scope !== 'programme');
  const programme = items.filter((i) => developmentCopyFor(i)?.scope === 'programme');

  return (
    <section className="mt-5 border-t border-border pt-4">
      <h4 className="font-heading text-sm font-semibold">Development</h4>
        {/* The description frames how to read the rows beneath it. With no
            rows there is nothing to frame, and on a programme where every
            section is empty the page said the same thing six times over —
            once at the top and once more under each heading. */}
        {items.length > 0 && (
        <p className="mt-0.5 text-sm text-muted-foreground">
        How first-year players have been used here, measured across the programme and across the
        cohort closest to this athlete. These are records of what happened in earlier seasons,
        not predictions about what this athlete would get.
        </p>
        )}

      {items.length === 0 ? (
        // Not "this programme does not develop first-years". We hold no
        // readable freshman history for it, which is a gap in the measurement
        // rather than a finding about the coaching.
        <p className="mt-3 text-sm text-muted-foreground">
          No development-history evidence on file for this programme.
        </p>
      ) : (
        <>
          <ul className="mt-1 divide-y divide-border">
            {athlete.map((item) => <Row key={item.kind} item={item} />)}
          </ul>
          {programme.length > 0 && (
            <div className="mt-3 border-t border-dashed border-border pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Across every first-year
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
