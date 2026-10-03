/**
 * A7.12.1 — the three preference questions, as a form answers them.
 *
 * Every rule about what may be asked, what may be stored and what a save
 * sends lives in `preferenceIntake.js`, so all of it is testable without a
 * DOM. The last block reaches into the form's SOURCE rather than rendering
 * it: what matters there is that the form has not grown a second copy of the
 * vocabulary or quietly pre-selected an answer, and both are visible in the
 * text.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  PREFERENCE_QUESTIONS, PRIORITY_CHOICES, PREFERENCE_FIELD_NAMES, ANCHORS, SHORT_LABEL,
  preferencesFromPlayer, setPreference, preferenceError, preferencesValid,
  preferencePayload, preferenceProfile, preferenceSummary,
  answeredCount, preferencesComplete,
} from './preferenceIntake.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const blank = () => preferencesFromPlayer(null);

describe('the questions the form asks', () => {
  it('asks exactly three, in the model\'s own order', () => {
    expect(PREFERENCE_QUESTIONS.map((q) => q.field)).toEqual([
      'competitive_level_priority', 'playing_opportunity_priority', 'academic_strength_priority',
    ]);
  });

  it('asks the wording A7.12.1 locked', () => {
    const [level, playing, academic] = PREFERENCE_QUESTIONS;
    expect(level.question).toBe('How important is competing at the highest realistic college level to you?');
    expect(playing.question).toBe('How important is having a clearer path to playing time?');
    expect(academic.question).toBe('How important is attending a college with a strong academic profile?');
  });

  it('offers five choices, labelled, never a free-text field', () => {
    expect(PRIORITY_CHOICES.map((c) => c.value)).toEqual([1, 2, 3, 4, 5]);
    expect(PRIORITY_CHOICES.map((c) => c.label)).toEqual([
      'Not important', 'Slightly important', 'Moderately important', 'Very important', 'Extremely important',
    ]);
    for (const q of PREFERENCE_QUESTIONS) expect(q.choices).toBe(PRIORITY_CHOICES);
  });

  it('carries the help text that disclaims each misreading', () => {
    const [level, playing, academic] = PREFERENCE_QUESTIONS;
    expect(level.helper).toMatch(/does not mean a particular NCAA division/i);
    expect(playing.helper).toMatch(/does not predict or guarantee playing time/i);
    expect(academic.helper).toMatch(/grades and test scores are considered separately/i);
  });

  it('never names a division as the desired outcome', () => {
    for (const q of PREFERENCE_QUESTIONS) {
      expect(q.question, q.field).not.toMatch(/\bD1\b|Division I|NCAA/i);
    }
  });
});

describe('reading a stored athlete', () => {
  it('reads a record written before these columns as all unanswered', () => {
    expect(preferencesFromPlayer({ full_name: 'x', football_ability: 9, gpa: 4 })).toEqual({
      competitive_level_priority: null,
      playing_opportunity_priority: null,
      academic_strength_priority: null,
    });
  });

  it('never resolves an absence to the neutral point', () => {
    for (const v of Object.values(blank())) expect(v).not.toBe(3);
  });

  it('reads stored answers back', () => {
    const f = preferencesFromPlayer({
      competitive_level_priority: 5, playing_opportunity_priority: 3, academic_strength_priority: 4,
    });
    expect(f.competitive_level_priority).toBe(5);
    expect(f.playing_opportunity_priority).toBe(3);
    expect(f.academic_strength_priority).toBe(4);
  });

  it('reads a value outside the scale as unanswered rather than clamping it', () => {
    expect(preferencesFromPlayer({ competitive_level_priority: 7 }).competitive_level_priority).toBeNull();
  });
});

describe('answering', () => {
  it('records an answer', () => {
    expect(setPreference(blank(), 'competitive_level_priority', 4).competitive_level_priority).toBe(4);
  });

  it('clears an answer when the same value is chosen again', () => {
    const one = setPreference(blank(), 'academic_strength_priority', 2);
    expect(setPreference(one, 'academic_strength_priority', 2).academic_strength_priority).toBeNull();
  });

  it('touches only the field named', () => {
    const f = setPreference(setPreference(blank(), 'competitive_level_priority', 5), 'playing_opportunity_priority', 1);
    expect(f.competitive_level_priority).toBe(5);
    expect(f.playing_opportunity_priority).toBe(1);
    expect(f.academic_strength_priority).toBeNull();
  });

  it('ignores a field it does not own', () => {
    expect(setPreference(blank(), 'football_ability', 9)).toEqual(blank());
  });

  it('counts what has been answered', () => {
    expect(answeredCount(blank())).toBe(0);
    expect(answeredCount(setPreference(blank(), 'competitive_level_priority', 3))).toBe(1);
  });
});

describe('validation', () => {
  it('accepts an entirely unanswered form', () => {
    expect(preferenceError(blank())).toBeNull();
    expect(preferencesValid(blank())).toBe(true);
  });

  it('accepts every value on the scale', () => {
    for (const v of [1, 2, 3, 4, 5]) {
      expect(preferencesValid({ competitive_level_priority: v })).toBe(true);
    }
  });

  for (const [label, value] of [['0', 0], ['6', 6], ['-1', -1], ['2.5', 2.5], ['a word', 'lots'], ['an object', {}]]) {
    it(`rejects ${label}`, () => {
      expect(preferencesValid({ competitive_level_priority: value })).toBe(false);
      expect(preferenceError({ competitive_level_priority: value })).toMatch(/competitive_level_priority/);
    });
  }
});

describe('the payload a save sends', () => {
  /**
   * The trap the contribution pair already fell into once. An omitted key is
   * "leave this column alone", so an unanswered question has to travel as an
   * explicit null or clearing an answer would silently do nothing.
   */
  it('always sends all three, including the unanswered ones', () => {
    expect(preferencePayload(blank())).toEqual({
      competitive_level_priority: null,
      playing_opportunity_priority: null,
      academic_strength_priority: null,
    });
    expect(Object.keys(preferencePayload(blank()))).toHaveLength(3);
  });

  it('sends the answers given', () => {
    const f = { competitive_level_priority: 5, playing_opportunity_priority: 3, academic_strength_priority: 4 };
    expect(preferencePayload(f)).toEqual(f);
  });

  it('refuses to build a payload from an impossible form', () => {
    expect(() => preferencePayload({ competitive_level_priority: 6 })).toThrow(/competitive_level_priority/);
  });

  it('hands the V2 builder the same three values, camelCased', () => {
    expect(preferenceProfile({
      competitive_level_priority: 5, playing_opportunity_priority: 3, academic_strength_priority: 4,
    })).toEqual({
      competitiveLevelPriority: 5, playingOpportunityPriority: 3, academicStrengthPriority: 4,
    });
  });

  it('hands the V2 builder nulls for an athlete nobody asked', () => {
    expect(preferenceProfile({})).toEqual({
      competitiveLevelPriority: null, playingOpportunityPriority: null, academicStrengthPriority: null,
    });
  });
});

describe('what a profile screen shows', () => {
  it('says "Not answered" rather than showing a midpoint', () => {
    const rows = preferenceSummary({});
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.text).toBe('Not answered');
      expect(r.answered).toBe(false);
      expect(r.text).not.toMatch(/3|Moderate/);
    }
  });

  it('shows the words and the number for an answer that was given', () => {
    const rows = preferenceSummary({ competitive_level_priority: 5 });
    const level = rows.find((r) => r.field === 'competitive_level_priority');
    expect(level.text).toBe('Extremely important (5 of 5)');
    expect(level.label).toBe('Competitive level');
    expect(level.answered).toBe(true);
  });

  it('labels all three for a definition list', () => {
    for (const f of PREFERENCE_FIELD_NAMES) expect(SHORT_LABEL[f], f).toBeTruthy();
  });

  it('reports completeness without treating it as validity', () => {
    expect(preferencesComplete({})).toBe(false);
    expect(preferencesComplete({ competitive_level_priority: 3 })).toBe(false);
    expect(preferencesComplete({
      competitive_level_priority: 3, playing_opportunity_priority: 3, academic_strength_priority: 3,
    })).toBe(true);
  });
});

describe('the form itself', () => {
  const formSource = fs.readFileSync(path.join(HERE, '../components/PlayerFormSteps.jsx'), 'utf8');
  const fieldSource = fs.readFileSync(path.join(HERE, '../components/AthletePreferenceFields.jsx'), 'utf8');
  /**
   * Comments stripped, because a comment EXPLAINING why the vocabulary is not
   * restated here would otherwise read as a restatement of it.
   */
  const fieldCode = fieldSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('renders the preference fields', () => {
    expect(formSource).toMatch(/<AthletePreferenceFields/);
  });

  it('sends the preference payload on submit', () => {
    expect(formSource).toMatch(/preferencePayload\(preferences\)/);
  });

  it('seeds the form from the stored record, not from a default', () => {
    expect(formSource).toMatch(/preferences: preferencesFromPlayer\(initialData\)/);
    expect(formSource).not.toMatch(/preferences:\s*\{[^}]*:\s*3/);
  });

  /**
   * The vocabulary is read from the model, never restated. A second copy is
   * how a form comes to offer a scale the scorer cannot read.
   */
  it('keeps no second copy of the questions or the ladder', () => {
    expect(fieldSource).toMatch(/from '@\/lib\/preferenceIntake'/);
    expect(fieldCode).not.toMatch(/Moderately important/);
    expect(fieldCode).not.toMatch(/How important is/);
    expect(fieldCode).not.toMatch(/Not important|Extremely important/);
  });

  it('pre-selects nothing', () => {
    expect(fieldSource).toMatch(/checked=\{isOn\}/);
    expect(fieldSource).not.toMatch(/defaultChecked/);
  });

  it('scopes each radio group per instance, so two forms cannot merge', () => {
    expect(fieldSource).toMatch(/useId\(\)/);
    expect(fieldSource).toMatch(/name=\{groupName\}/);
  });

  it('never reads an inference source', () => {
    for (const forbidden of ['football_ability', 'gpa', 'sat_score', 'act_score', 'criterion_ranking']) {
      expect(fieldCode, forbidden).not.toContain(forbidden);
    }
  });

  it('offers no free-text answer', () => {
    expect(fieldSource).not.toMatch(/<(Textarea|Input)\b/);
    expect(fieldSource).toMatch(/type="radio"/);
  });

  it('uses the shared anchor ladder rather than its own words', () => {
    expect(Object.values(ANCHORS)).toContain('Moderately important');
  });
});
