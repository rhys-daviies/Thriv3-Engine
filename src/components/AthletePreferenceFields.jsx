import React, { useId } from 'react';
import { cn } from '@/lib/utils';
import { PREFERENCE_QUESTIONS, PRIORITY_SCALE } from '@/lib/preferenceIntake';

/**
 * The three things only the athlete can tell us.
 *
 * Every question, every label and the legal values come from
 * `src/lib/preferenceIntake.js`, which reads them from the model's own intake
 * contract. Nothing about the scale is written here.
 *
 * NO MODEL VOCABULARY REACHES THIS SCREEN. No layer names, no weights, no
 * component names - an athlete is saying what they want.
 *
 * NOTHING IS PRE-SELECTED. A form that arrives with "Moderately important"
 * already chosen collects that answer from everyone who does not notice the
 * question, and afterwards it is indistinguishable from the athletes who
 * meant it. Unanswered stays unanswered until somebody clicks.
 */
export default function AthletePreferenceFields({ value, onChange }) {
  /**
   * Radio groups are scoped by NAME across the whole document, so a fixed
   * name would merge two instances of this component into one group - and
   * with three groups in here, it would merge nine controls into three.
   */
  const uid = useId();

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-sm font-medium leading-none">What matters to you</p>
        <p className="text-xs text-muted-foreground">
          Three questions, answered by the athlete. Leave any of them unanswered if you have not
          asked yet — Thriv3 treats an unanswered question as unknown, not as a middle answer.
        </p>
      </div>

      {PREFERENCE_QUESTIONS.map(({ field, question, helper, choices }) => {
        const selected = value?.[field] ?? null;
        const groupName = `${field}-${uid}`;
        const helpId = `${groupName}-help`;
        return (
          <fieldset key={field} className="space-y-2">
            <legend className="text-sm font-medium leading-none">{question}</legend>
            <p id={helpId} className="text-xs text-muted-foreground">{helper}</p>
            <div
              role="radiogroup"
              aria-describedby={helpId}
              className="grid grid-cols-1 sm:grid-cols-5 gap-2"
            >
              {choices.map((c) => {
                const id = `${groupName}-${c.value}`;
                const isOn = selected === c.value;
                return (
                  <label
                    key={c.value}
                    htmlFor={id}
                    className={cn(
                      'flex sm:flex-col sm:items-center items-baseline gap-2 sm:gap-1 rounded-md border p-2.5',
                      'cursor-pointer transition-colors text-center',
                      isOn ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/40',
                    )}
                  >
                    <input
                      type="radio"
                      id={id}
                      name={groupName}
                      className="h-4 w-4 shrink-0 accent-primary sm:mb-0.5"
                      value={c.value}
                      checked={isOn}
                      onChange={() => onChange(field, c.value)}
                    />
                    {/* The number is the stored value, so it is on screen beside
                        the words rather than only in the markup. */}
                    <span className="text-xs font-medium leading-tight">
                      <span className="tabular-nums text-muted-foreground mr-1 sm:mr-0 sm:block">
                        {c.value}
                      </span>
                      {c.label}
                      {isOn && <span className="sr-only"> (selected)</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            {selected === null && (
              <p className="text-xs text-muted-foreground italic">
                Not answered. Thriv3 will rank without this preference rather than assume one.
              </p>
            )}
            {selected !== null && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => onChange(field, selected)}
              >
                Clear this answer
              </button>
            )}
          </fieldset>
        );
      })}
      <p className="sr-only">
        Each question is answered on a scale of {PRIORITY_SCALE.min} to {PRIORITY_SCALE.max}.
      </p>
    </div>
  );
}
