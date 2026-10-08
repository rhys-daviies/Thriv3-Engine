import { describe, it, expect } from 'vitest';
import {
  POSITIONS, POSITION_NOUN, POSITION_PLURAL,
  canonicalPosition, positionNoun, positionPlural, positionLabel,
  POSITION_MODELS, positionModelFor, positionOptionGroups, positionDetailLabel, isKnownPosition,
  NO_SECONDARY_POSITION, hasSecondaryPosition,
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

describe('detailed athlete positions', () => {
  it('every detailed key resolves to the group it declares, through the engine\'s own lookup', () => {
    for (const sport of Object.keys(POSITION_MODELS)) {
      for (const d of positionModelFor(sport)) expect(canonicalPosition(d.key), `${sport} ${d.key}`).toBe(d.group);
    }
  });

  it('adds exactly one label to the lookup, and it is one no roster row uses', () => {
    // The long names are printed, never looked up: "Center Back" stays UNKNOWN
    // so ~60 corpus roster rows do not move cohort.
    for (const raw of ['Center Back', 'Central Midfielder', 'Attacking Midfielder', 'Center back', 'Wingback', 'Fullback']) {
      expect(canonicalPosition(raw), raw).toBe('UNKNOWN');
    }
    expect(canonicalPosition('WM')).toBe('MIDFIELD');
  });

  it('labels a detailed key by its long name and a coarse value by its group', () => {
    expect(positionDetailLabel('CB')).toBe('Center back');
    expect(positionDetailLabel('cb')).toBe('Center back');
    expect(positionDetailLabel('Defender')).toBe('Defender');
    expect(positionDetailLabel('DEFENSE')).toBe('Defender');
    expect(positionDetailLabel('Sweeper-keeper')).toBe('Sweeper-keeper');
  });

  it('offers every group with a no-detail choice first, so legacy coarse values stay selectable', () => {
    const groups = positionOptionGroups('womens-soccer');
    expect(groups.map((g) => g.group)).toEqual(POSITIONS);
    expect(groups.map((g) => g.options[0].key)).toEqual(['Goalkeeper', 'Defender', 'Midfielder', 'Forward']);
    expect(groups.find((g) => g.group === 'MIDFIELD').options.map((o) => o.key)).toEqual(['Midfielder', 'DM', 'CM', 'AM', 'WM']);
  });

  it('a sport with no model offers the four groups and nothing borrowed from soccer', () => {
    const groups = positionOptionGroups('mens-volleyball');
    expect(groups.every((g) => g.options.length === 1)).toBe(true);
  });

  it('knows which values the engine can place', () => {
    expect(isKnownPosition('ST')).toBe(true);
    expect(isKnownPosition('Midfielder')).toBe(true);
    expect(isKnownPosition('Attacking Midfielder')).toBe(false);
    expect(isKnownPosition('')).toBe(false);
  });

  it('treats the secondary sentinel, null and blank as no secondary position', () => {
    expect([NO_SECONDARY_POSITION, null, '', '  ', undefined].map(hasSecondaryPosition)).toEqual([false, false, false, false, false]);
    expect(hasSecondaryPosition('DM')).toBe(true);
  });
});

describe('the goalkeeper group', () => {
  it('offers one goalkeeper choice, not "Goalkeeper (no detail)" beside "Goalkeeper"', () => {
    const gk = positionOptionGroups('mens-soccer').find((g) => g.group === 'GOALKEEPER');
    expect(gk.options.map((o) => o.label)).toEqual(['Goalkeeper']);
    // A stored GK still reads as the goalkeeper it is.
    expect(positionDetailLabel('GK')).toBe('Goalkeeper');
  });
});
