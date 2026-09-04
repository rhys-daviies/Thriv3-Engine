import React from 'react';
import { fitCopyFor, fitQualification } from '@/lib/fitEvidenceCopy';
import EvidenceDetails from '@/components/EvidenceDetails';

/**
 * The academic match, and separately, how the team has been doing.
 *
 * TWO GROUPS THAT MUST NOT MERGE. One row says a subject on this athlete's
 * profile is taught here. The others say the team won a conference and reached
 * a round of 16. Reading them as one thing produces "a strong fit", which is a
 * claim no evidence object makes and which the operator would reasonably take
 * as a recommendation. So they sit under separate headings, each group states
 * what it is, and no sentence anywhere mentions two kinds at once.
 *
 * The groups are also why the two empty states are separate: a programme with
 * no academic match and three trophies has one gap and three findings, and a
 * single section-level empty state would hide which.
 *
 * NO SCORE, NO METER, NO BADGE. Nothing here is combined into a figure and
 * nothing is coloured. A title is rendered exactly as plainly as a first-round
 * exit.
 */

function MissingCopy({ kind }) {
  return (
    <p className="text-sm text-amber-600 dark:text-amber-500">
      No fit wording for <code className="font-mono text-xs">{kind}</code> yet.
    </p>
  );
}

function Row({ item }) {
  const copy = fitCopyFor(item);
  if (!copy) return <li className="py-3"><MissingCopy kind={item.kind} /></li>;

  const qualification = fitQualification(item);
  return (
    <li className="py-3">
      <p className="font-medium leading-snug">{copy.headline}</p>
      {copy.detail && <p className="mt-0.5 text-sm text-muted-foreground">{copy.detail}</p>}
      {qualification && (
        <p className="mt-1 text-xs text-muted-foreground/80">{qualification}</p>
      )}
      <EvidenceDetails item={item} />
    </li>
  );
}

function Group({ label, note, items, empty }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <>
          {note && <p className="mt-0.5 text-sm text-muted-foreground">{note}</p>}
          <ul className="divide-y divide-border">
            {items.map((item) => <Row key={item.kind} item={item} />)}
          </ul>
        </>
      )}
    </div>
  );
}

export default function AcademicProgrammeFit({ items = [] }) {
  /**
   * Split on whether the evidence mentions the athlete.
   *
   * Every kind here is FIT/STATIC, so unlike the other sections the decision
   * class cannot separate them. ACADEMIC_FIT is the only one built from
   * something on the athlete's own profile; the rest would read identically
   * for any recruit. The copy module makes that call from the facts and this
   * component reads its answer rather than hard-coding a kind list.
   */
  const athlete = items.filter((i) => fitCopyFor(i)?.scope === 'athlete');
  const programme = items.filter((i) => fitCopyFor(i)?.scope !== 'athlete');

  return (
    <section className="mt-5 border-t border-border pt-4">
      <h4 className="font-heading text-sm font-semibold">Academic and programme fit</h4>
      <p className="mt-0.5 text-sm text-muted-foreground">
        What the athlete’s stated subject matches here, and separately, how the team has been
        doing. These are two different things and neither strengthens the other.
      </p>

      {items.length === 0 ? (
        // Neither group has anything. One restrained line rather than two
        // empty headings, and it says what is missing from our records rather
        // than anything about the programme.
        <p className="mt-3 text-sm text-muted-foreground">
          No academic or programme-performance evidence on file for this programme.
        </p>
      ) : (
        <>
          <Group
            label="Academic match"
            items={athlete}
            // Not "no academic fit". We have nothing to match against — most
            // often because no intended subject is on the athlete's profile.
            empty="No academic-fit evidence on file."
          />
          <Group
            label="Programme results"
            note="How the team has performed. This says nothing about this athlete in particular."
            items={programme}
            // Not "the programme has not performed". Absence of a title is not
            // evidence of anything.
            empty="No programme-performance evidence on file."
          />
        </>
      )}
    </section>
  );
}
