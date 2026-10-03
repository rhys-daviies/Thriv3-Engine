import React, { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { academicIntentState, ACADEMIC_INTENT, majorLabelFor } from '@shared/academicMajors.js';

/**
 * THE ONE ACADEMIC PREFERENCE MATCHMAKING SCORES — A9.4 §I, §J.
 *
 * ===========================================================================
 * THE FAILURE THIS FIELD EXISTS TO END IS A SILENT ONE.
 *
 * It was a bare text input. An operator typing "Sports Management" saw it
 * save, saw it on the profile, and saw it listed as a ranking preference —
 * while `majorLabelFor` could not place it, `majorFit` returned NOT_APPLICABLE,
 * and the preference did nothing to any ranking. NOT_APPLICABLE costs no
 * coverage, so nothing anywhere looked wrong. The Evidence tab said so, on a
 * different tab, after the fact.
 *
 * So the field answers while it is being typed in, using
 * `academicIntentState` — the SAME function the scorer calls. Four states, the
 * model's own, not a second taxonomy and not a guess:
 *
 *   VALID        placed in a family; this will be used
 *   UNDECIDED    a real answer meaning "not yet"; correctly scores nothing
 *   UNSUPPORTED  saved, unplaceable, affecting nothing — the silent case
 *   MISSING      empty; optional, and that is fine
 *
 * -- WHAT THIS MAY NEVER SAY — §J, and A8.2 -------------------------------
 *
 * Every sentence below is about what THRIV3 can map. Not one is about what an
 * institution offers. `notable_majors` is PARTIAL POSITIVE evidence — 321 of
 * 349 Division I women's programmes omit Mathematics, Penn State and Ohio
 * State among them — so absence from it establishes nothing, and the engine
 * refuses rather than scoring a zero. A field that said "no programmes offer
 * this" would put that inference back at the point of entry, which is the
 * worst place for it: the operator would change the athlete's stated major to
 * suit a claim Thriv3 cannot make.
 * ===========================================================================
 */

/** Said about THRIV3's taxonomy. Never about an institution's catalogue. */
export const MAJOR_INTENT_NOTE = Object.freeze({
  [ACADEMIC_INTENT.VALID]: (label) => `Thriv3 reads this as ${label}, and will use it when ranking.`,
  [ACADEMIC_INTENT.UNDECIDED]: () => 'This reads as undecided, so no major preference is applied. '
    + 'That is the correct outcome until the athlete has a field in mind.',
  [ACADEMIC_INTENT.UNSUPPORTED]: () => 'Saved, but Thriv3 cannot currently map this to an academic family, '
    + 'so it will not affect ranking. Try the subject itself — “business”, '
    + '“exercise science”, “computer science”.',
  [ACADEMIC_INTENT.MISSING]: () => 'Optional. Left blank, Thriv3 ranks on everything else and '
    + 'applies no major preference.',
});

export default function IntendedMajorField({ value, onChange }) {
  const uid = useId();
  const inputId = `intended-major-${uid}`;
  const noteId = `${inputId}-note`;
  const intent = academicIntentState(value);
  const label = majorLabelFor(value);
  const note = MAJOR_INTENT_NOTE[intent](label);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={inputId}>Intended major</Label>
        {/*
          REMOVAL IS A BUTTON, NOT A CONVENTION — §I, §Q.

          Clearing the box has always worked (EditPlayer treats a field the
          form knows about and the sanitiser dropped as an intentional clear),
          but "select all and delete" is not an affordance and is not reachable
          the same way for everyone. A real `type="button"` is keyboard
          operable, has a name, and states what it does.

          Hidden when there is nothing to remove, so it never offers to undo
          something that has not happened.
        */}
        {(value ?? '') !== '' && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange('')}
            data-testid="remove-major"
          >
            Remove
          </Button>
        )}
      </div>
      <Input
        id={inputId}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Sport Science"
        aria-describedby={noteId}
      />
      {/*
        `role="status"` so the verdict is announced when it changes rather than
        only being visible — §Q. It is the only thing that tells an operator
        their input will do nothing.
      */}
      <p
        id={noteId}
        role="status"
        data-testid={`major-intent-${intent}`}
        className={intent === ACADEMIC_INTENT.UNSUPPORTED ? 'mt-1 text-xs text-amber-400' : 'mt-1 text-xs text-muted-foreground'}
      >
        {note}
      </p>
      <p className="text-[11px] text-muted-foreground">
        Optional, and used to find programmes that offer it. Plain English is fine:
        &ldquo;business&rdquo;, &ldquo;comp sci&rdquo;, &ldquo;exercise science&rdquo;.
      </p>
    </div>
  );
}
