/**
 * A7.12.1 — the markup the three questions actually produce.
 *
 * A static render, not a DOM interaction test: what has to be true here is
 * structural, and A7.9.3 lost a day to exactly the structural thing this
 * checks. A radio group is scoped by NAME across the whole document, so a
 * fixed name silently merges every instance of a component into one group -
 * the DOM showed zero checked radios while React believed each was set.
 *
 * Rendered rather than grepped, because the bug that motivates it is only
 * visible once `useId` has actually run.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AthletePreferenceFields from './AthletePreferenceFields.jsx';
import { PREFERENCE_QUESTIONS, PREFERENCE_FIELD_NAMES } from '@/lib/preferenceIntake';

const render = (value) => renderToStaticMarkup(
  React.createElement(AthletePreferenceFields, { value, onChange: () => {} }),
);

const names = (html) => [...html.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
const checked = (html) => (html.match(/checked=""/g) ?? []).length;

const BLANK = Object.fromEntries(PREFERENCE_FIELD_NAMES.map((f) => [f, null]));

describe('the rendered preference fields', () => {
  it('asks all three questions', () => {
    const html = render(BLANK);
    for (const q of PREFERENCE_QUESTIONS) expect(html).toContain(q.question);
  });

  it('offers five radios per question and nothing else to type into', () => {
    const html = render(BLANK);
    expect((html.match(/type="radio"/g) ?? []).length).toBe(15);
    expect(html).not.toContain('type="text"');
    expect(html).not.toContain('<textarea');
  });

  it('gives each question its own radio group', () => {
    const html = render(BLANK);
    const unique = new Set(names(html));
    expect(unique.size).toBe(3);
    for (const f of PREFERENCE_FIELD_NAMES) {
      expect([...unique].some((n) => n.startsWith(f)), f).toBe(true);
    }
  });

  /** The A7.9.3 bug, in its new home. */
  it('does not merge two instances of the component into one group', () => {
    const a = new Set(names(render(BLANK)));
    const b = new Set(names(render(BLANK)));
    const both = renderToStaticMarkup(React.createElement(
      React.Fragment, null,
      React.createElement(AthletePreferenceFields, { value: BLANK, onChange: () => {} }),
      React.createElement(AthletePreferenceFields, { value: BLANK, onChange: () => {} }),
    ));
    expect(new Set(names(both)).size).toBe(6);
    expect(a.size).toBe(3);
    expect(b.size).toBe(3);
  });

  it('checks nothing at all when nothing has been answered', () => {
    const html = render(BLANK);
    expect(checked(html)).toBe(0);
    expect(html).toContain('Not answered');
  });

  it('checks exactly the answers given, and no others', () => {
    const html = render({
      competitive_level_priority: 5,
      playing_opportunity_priority: 3,
      academic_strength_priority: null,
    });
    expect(checked(html)).toBe(2);
    expect((html.match(/Not answered/g) ?? []).length).toBe(1);
  });

  it('pairs every input with a label that points at it', () => {
    const html = render(BLANK);
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    const fors = [...html.matchAll(/for="([^"]+)"/g)].map((m) => m[1]);
    for (const f of fors) expect(ids, `label for="${f}" points at nothing`).toContain(f);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names the selected option in text, not only by colour', () => {
    const html = render({ ...BLANK, competitive_level_priority: 4 });
    expect(html).toContain('(selected)');
  });

  it('carries each question\'s helper text', () => {
    const html = render(BLANK);
    for (const q of PREFERENCE_QUESTIONS) expect(html).toContain(q.helper.split('.')[0]);
  });
});
