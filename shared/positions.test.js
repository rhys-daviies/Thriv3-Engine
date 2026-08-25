import { describe, it, expect } from 'vitest';
import {
  POSITIONS, POSITION_NOUN, POSITION_PLURAL,
  canonicalPosition, positionNoun, positionPlural, positionLabel,
} from './positions.js';

describe('the position vocabulary', () => {
  // The defect this module exists for: the stored keys are a mixed bag.
  // GOALKEEPER and FORWARD name a person; DEFENSE names an abstraction and
  // MIDFIELD names a region of grass. Printed straight, they read
  // "a talented Defense who is exploring collegiate opportunities".
  it('gives every position a person-noun, in one grammatical form', () => {
    expect(POSITIONS.map(positionNoun)).toEqual(['goalkeeper', 'defender', 'midfielder', 'forward']);
    expect(POSITIONS.map(positionPlural)).toEqual(['goalkeepers', 'defenders', 'midfielders', 'forwards']);
    expect(POSITIONS.map(positionLabel)).toEqual(['Goalkeeper', 'Defender', 'Midfielder', 'Forward']);
  });

  it('covers every stored key, so nothing falls through to the raw value', () => {
    for (const key of POSITIONS) {
      expect(POSITION_NOUN, key).toHaveProperty(key);
      expect(POSITION_PLURAL, key).toHaveProperty(key);
    }
  });

  it('plurals are the singular plus s, and never the singular', () => {
    for (const key of POSITIONS) {
      expect(POSITION_PLURAL[key]).not.toBe(POSITION_NOUN[key]);
      expect(POSITION_PLURAL[key]).toBe(`${POSITION_NOUN[key]}s`);
    }
  });
});

describe('canonicalPosition', () => {
  it('maps the stored key to itself', () => {
    for (const key of POSITIONS) expect(canonicalPosition(key)).toBe(key);
  });

  // The form now saves 'Defender' where it used to save 'Defense'. Both must
  // reach the same cohort key or the athlete matches nothing.
  it('maps the new form labels and the old ones to the same key', () => {
    expect(canonicalPosition('Defender')).toBe('DEFENSE');
    expect(canonicalPosition('Defense')).toBe('DEFENSE');
    expect(canonicalPosition('Midfielder')).toBe('MIDFIELD');
    expect(canonicalPosition('Midfield')).toBe('MIDFIELD');
    expect(canonicalPosition('Goalkeeper')).toBe('GOALKEEPER');
    expect(canonicalPosition('Forward')).toBe('FORWARD');
  });

  it('reads roster shorthand and spelling variants', () => {
    expect(canonicalPosition('CB')).toBe('DEFENSE');
    expect(canonicalPosition('defence')).toBe('DEFENSE');
    expect(canonicalPosition('GK')).toBe('GOALKEEPER');
    expect(canonicalPosition('striker')).toBe('FORWARD');
    expect(canonicalPosition('attacker')).toBe('FORWARD');
  });

  it('takes the left side of a dual label', () => {
    expect(canonicalPosition('M/F')).toBe('MIDFIELD');
    expect(canonicalPosition('D,M')).toBe('DEFENSE');
  });

  // A guess here moves an athlete into the wrong cohort and silently changes
  // their whole match list.
  it('refuses to guess', () => {
    expect(canonicalPosition('Sweeper')).toBe('UNKNOWN');
    expect(canonicalPosition('')).toBe('UNKNOWN');
    expect(canonicalPosition(null)).toBe('UNKNOWN');
  });

  it('shows an unrecognised position as written rather than as "unknown"', () => {
    expect(positionLabel('Sweeper')).toBe('Sweeper');
    expect(positionNoun('Sweeper')).toBe('sweeper');
    expect(positionPlural('Sweeper')).toBe('sweepers');
    expect(positionLabel('')).toBe('');
  });
});
