import React from 'react';
import TopReasons from '@/components/TopReasons';

/**
 * One programme's answer to "why do we think this is relevant to this athlete?"
 *
 * Every empty case below is a DIFFERENT STATEMENT, and the whole design of the
 * backend contract was to let this component tell them apart without counting
 * anything:
 *
 *   unresolved        we could not match this name to a programme we hold
 *   resolved, empty   we hold the programme and have little to read
 *   resolved, quiet   we hold plenty and none of it is a reason to act
 *   resolved, reasons the ranked list
 *
 * The first of those used to be indistinguishable from the second, which is
 * why `programme.resolved` exists. It is read here and never inferred from an
 * evidence count.
 */

function Line({ children, tone = 'muted' }) {
  const cls = tone === 'strong' ? 'text-sm' : 'text-sm text-muted-foreground';
  return <p className={cls}>{children}</p>;
}

/**
 * The compact state line above the reasons.
 *
 * Deliberately words rather than figures. A count of reasons is a fact about
 * what we found and reads honestly; a score would be a judgement this surface
 * has not earned, and a tile of numbers would make the reasons beneath it look
 * like supporting detail for a metric.
 */
function Summary({ summary }) {
  const { reasonCount, openingIdentified } = summary;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {/*
        The count only when there is one to give. At zero the panel below is
        headed "No positive reasons identified", and "0 reasons identified"
        beside it says the same thing twice — which reads less like emphasis
        than like two components that have not been introduced.
      */}
      {reasonCount > 0 && (
        <>
          <span className="font-medium">
            {reasonCount === 1 ? '1 reason identified' : `${reasonCount} reasons identified`}
          </span>
          <span aria-hidden="true" className="text-border">·</span>
        </>
      )}
      {/*
        "Not identified", never "no opening". The difference is the difference
        between what we found and what is true: a programme whose roster we
        cannot read has no opening we can see, and saying "no positional
        opening" would report our own blind spot as a fact about their squad.
      */}
      <span className={openingIdentified ? 'text-foreground' : 'text-muted-foreground'}>
        {openingIdentified ? 'Positional opening identified' : 'No positional opening identified'}
      </span>
    </div>
  );
}

export default function ProgrammeDecision({ model, loading = false, failed = false }) {
  if (loading) {
    return <Line>Reading what we hold on this programme…</Line>;
  }

  // A failed request is not a finding. Kept apart from every state below so a
  // server problem can never read as a statement about the school.
  if (failed) {
    return (
      <p className="text-sm text-amber-600 dark:text-amber-500">
        Could not load the decision evidence for this programme. This is a problem at our
        end, not a finding about the programme — try again.
      </p>
    );
  }

  if (!model) return null;

  const { programme, summary, topReasons } = model;

  /**
   * We could not match the name to a programme we hold.
   *
   * Says nothing about the school itself, deliberately: the name may be a
   * spelling we do not carry, or a programme in a sport or division we have
   * not loaded. Presenting this as "no reasons identified" would report a
   * lookup miss as an assessment.
   */
  if (!programme.resolved) {
    return (
      <div className="rounded-md border border-dashed border-border p-4">
        <p className="text-sm font-medium">Programme evidence unavailable</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We could not match this name to a programme in our data, so nothing here has been
          assessed. This is a gap on our side — it does not tell you anything about the
          programme itself.
        </p>
      </div>
    );
  }

  if (summary.reasonCount > 0) {
    return (
      <div className="space-y-3">
        <Summary summary={summary} />
        <TopReasons reasons={topReasons} />
      </div>
    );
  }

  /**
   * Resolved, and nothing rose to a reason.
   *
   * Two different sentences beneath one heading. Evidence we hold but did not
   * rank is a real answer — we looked and none of it argues for acting — while
   * evidence we do not hold is a gap in what we have read. Framing either as
   * a mark against the programme would turn absence into negative evidence,
   * which is not what the engine said.
   */
  return (
    <div className="space-y-3">
      <Summary summary={summary} />
      <div className="rounded-md border border-border bg-muted/40 p-4">
        <p className="text-sm font-medium">No positive reasons identified</p>
        {summary.hasEvidence ? (
          <p className="mt-1 text-sm text-muted-foreground">
            We hold {summary.evidenceCount === 1 ? '1 piece' : `${summary.evidenceCount} pieces`} of
            evidence on this programme, and none of it argues for acting on it now. The detail
            behind that is not on this screen yet.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            We hold almost nothing on this programme — no roster, recruiting or results data we
            can read. That is a gap in what we have collected, not a judgement about the
            programme.
          </p>
        )}
      </div>
    </div>
  );
}
