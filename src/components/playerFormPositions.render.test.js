/**
 * Legacy positions in the edit form: what a stored value looks like when the
 * form opens, and whether the operator is stopped before a save the server
 * would refuse. A static render - the step-1 markup is what matters.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PlayerFormSteps from './PlayerFormSteps.jsx';

const BASE = {
  full_name: 'Legacy Athlete', recruiting_class_year: 2028, preferred_divisions: ['NCAA D1'], sport: 'mens-soccer',
};
const render = (over) => renderToStaticMarkup(
  React.createElement(PlayerFormSteps, { initialData: { ...BASE, ...over }, sport: 'mens-soccer', onSubmit: () => {} }),
);
const nextDisabled = (html) => /<button[^>]*disabled=""[^>]*>Next<\/button>/.test(html);

describe('the edit form with legacy position values', () => {
  // Radix renders no selected value statically, so the group a stored value
  // resolves to is read from the ranking note under the pickers.
  const note = (html) => html.match(/data-testid="position-ranking-note">([^<]*)</)?.[1] ?? '';

  it('reads a legacy coarse value as its group and lets the operator continue', () => {
    const html = render({ position: 'Defense', secondary_position: 'None' });
    expect(note(html)).toMatch(/^Matching ranks on the defender group\./);
    expect(html).not.toContain('secondary-position-invalid');
    expect(nextDisabled(html)).toBe(false);
  });

  it('reads a detailed key as its group and lets the operator continue', () => {
    const html = render({ position: 'CB', secondary_position: 'DM' });
    expect(note(html)).toMatch(/^Matching ranks on the defender group\./);
    expect(nextDisabled(html)).toBe(false);
  });

  it('names an unsupported secondary and blocks the step, rather than letting the save fail silently', () => {
    const html = render({ position: 'Midfielder', secondary_position: 'Attacking Midfielder' });
    expect(html).toContain('data-testid="secondary-position-invalid"');
    expect(html).toContain('\u201cAttacking Midfielder\u201d is not a position Thriv3 can match on');
    expect(nextDisabled(html)).toBe(true);
  });

  it('names an unsupported primary and blocks the step', () => {
    const html = render({ position: 'Left Winger', secondary_position: 'None' });
    expect(html).toContain('\u201cLeft Winger\u201d is not a position Thriv3 can match on');
    expect(nextDisabled(html)).toBe(true);
  });
});
