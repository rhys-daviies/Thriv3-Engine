import React, { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  CONTRIBUTION_STATE, contributionError, formatAmount, hasUnconfirmedLegacy,
} from '@/lib/contributionIntake';

/**
 * The one financial question Thriv3 asks a family.
 *
 * It replaces the budget-band picker, which asked something subtly different
 * and, at its top band, asked nothing at all: "$40k+" states a floor and no
 * ceiling, and matching needs the ceiling. Every rule about what may be
 * answered lives in src/lib/contributionIntake.js; this renders it.
 *
 * NO MODEL VOCABULARY REACHES THIS SCREEN. No viability, no grades, no gaps,
 * no state names - a parent is answering a question about their own money.
 */

/** Radio rather than a select: three options, all of which should be readable at once. */
const CHOICES = [
  {
    value: CONTRIBUTION_STATE.STATED,
    label: 'We can contribute up to a set amount each year',
    help: 'Enter the most your family could pay in total per year.',
  },
  {
    value: CONTRIBUTION_STATE.NOT_A_CONSTRAINT,
    label: "Cost isn't a meaningful factor in my college choice",
    help: 'Programme cost will not reduce how strongly Thriv3 pursues a programme for you.',
  },
  {
    value: CONTRIBUTION_STATE.NEEDS_CONFIRMATION,
    label: 'I need to confirm this with my family',
    help: 'We can still build your profile. Financial fit stays unconfirmed until this is updated.',
  },
];

export default function FamilyContributionField({ value, onChoice, onAmount }) {
  /**
   * A radio group is scoped by NAME across the whole form, not by fieldset, so
   * a fixed name means two of these on one page silently become one group -
   * picking an answer for one athlete would clear the other's, and React would
   * keep believing both were set. `useId` also keeps every `htmlFor`/`id` pair
   * unique, which is what makes the labels clickable and the field nameable.
   */
  const uid = useId();
  const idFor = (choice) => `contribution-${uid}-${choice}`;
  const amountId = `max-annual-contribution-${uid}`;
  const helpId = `${amountId}-help`;
  const errorId = `${amountId}-error`;
  const error = contributionError(value);
  const stated = value.choice === CONTRIBUTION_STATE.STATED;
  const showLegacy = hasUnconfirmedLegacy(value);

  return (
    <fieldset className="space-y-3 max-w-md">
      <legend className="text-sm font-medium leading-none">
        How much could your family contribute per year toward college?
      </legend>
      <p className="text-xs text-muted-foreground">
        Enter the maximum your family could pay in total per year, before any athletic or academic scholarship.
      </p>

      {/*
        Shown, never used. The old band is context for whoever is confirming
        the answer; it is deliberately not loaded into the amount field, and
        "$40k+/yr" in particular must never reappear as a maximum of $40,000.
      */}
      {showLegacy && (
        <p className="text-xs rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-amber-900">
          <span className="font-medium">Needs confirmation.</span>{' '}
          Previous budget range: {value.legacyBand}. Please confirm one of the options below —
          the old range is kept for reference and is not read as a maximum.
        </p>
      )}

      <div className="space-y-2" role="radiogroup" aria-label="Family contribution">
        {CHOICES.map((c) => (
          <label
            key={c.value}
            htmlFor={idFor(c.value)}
            className={cn(
              'flex gap-3 rounded-md border p-3 cursor-pointer transition-colors',
              value.choice === c.value ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/40',
            )}
          >
            <input
              type="radio"
              id={idFor(c.value)}
              name={`contribution_choice-${uid}`}
              className="mt-1 h-4 w-4 shrink-0 accent-primary"
              value={c.value}
              checked={value.choice === c.value}
              onChange={() => onChoice(c.value)}
            />
            <span className="space-y-0.5">
              {/*
                The selected option is named in text as well as outlined, so
                the answer is readable without relying on the border colour.
              */}
              <span className="block text-sm font-medium">
                {c.label}
                {value.choice === c.value && <span className="sr-only"> (selected)</span>}
              </span>
              <span className="block text-xs text-muted-foreground">{c.help}</span>
            </span>
          </label>
        ))}
      </div>

      {stated && (
        <div className="space-y-1.5 pl-3 border-l-2 border-primary/30">
          <Label htmlFor={amountId}>Maximum annual family contribution</Label>
          <p className="text-xs text-muted-foreground -mt-1">The most your family could pay per year in total.</p>
          <div className="relative max-w-[14rem]">
            <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input
              id={amountId}
              className="pl-6"
              /*
                `inputMode` rather than type="number": a numeric keypad on a
                phone, without the spinner, the scroll-wheel edit, or the
                silent acceptance of "1e5" that type="number" allows.
              */
              inputMode="numeric"
              autoComplete="off"
              placeholder="35,000"
              aria-describedby={error ? `${helpId} ${errorId}` : helpId}
              aria-invalid={error ? 'true' : undefined}
              value={formatAmount(value.amount)}
              onChange={(e) => onAmount(e.target.value)}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">/ year</span>
          </div>
          <p id={helpId} className="text-xs text-muted-foreground">
            US dollars per year. Whole dollars, for example 20,000 or 35,000 or 50,000.
          </p>
          {error && (
            <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}
