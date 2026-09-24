import { describe, it, expect } from 'vitest';
import {
  COMPONENT_LABEL, LAYER_LABEL, REFUSAL_PHRASE,
  componentLabel, layerLabel, refusalPhrase, REASON_CODE, LAYER, POLARITY, BAND,
} from './vocabulary.js';
import { renderReason } from './render.js';
import { REASON } from '../types.js';

/**
 * The regression this file exists for.
 *
 * A limited-data row printed "Recruitability could not be scored -
 * positionalOpportunity is missing" four lines from "opportunity MEASURED
 * (coverage 1.00)", about the same programme. Both statements were true and
 * about different quantities; nothing on the page said so. A reviewer read it
 * as the model contradicting itself, which is the most dangerous kind of
 * explanation defect: specific, technical and convincing.
 *
 * NAMING ONLY. No score, coverage rule or reason code changed.
 */
const unscoreable = (layer, missing, reason) => renderReason({
  code: REASON_CODE.LAYER_UNSCOREABLE, layer, polarity: POLARITY.UNKNOWN, band: BAND.UNKNOWN,
  evidence: { layer, missing, reason, coverage: 0 },
});

describe('the two opportunities are named apart', () => {
  it('never prints the internal identifiers', () => {
    const line = unscoreable(LAYER.RECRUITABILITY, ['positionalOpportunity'], REASON.BELOW_COVERAGE_FLOOR);
    expect(line).not.toContain('positionalOpportunity');
    expect(line).toContain('positional recruiting evidence');
  });

  it('gives the recruitability component and the opportunity component different words', () => {
    expect(componentLabel('positionalOpportunity')).toBe('positional recruiting evidence');
    expect(componentLabel('playingPathway')).toBe('the positional playing pathway');
    expect(componentLabel('positionalOpportunity')).not.toBe(componentLabel('playingPathway'));
  });

  it('names the layer rather than capitalising its key', () => {
    const line = unscoreable(LAYER.RECRUITABILITY, ['positionalOpportunity'], REASON.BELOW_COVERAGE_FLOOR);
    expect(line.startsWith('Coach recruitability')).toBe(true);
    expect(layerLabel('opportunity')).toBe('Athlete opportunity');
    expect(layerLabel('recruitability')).toBe('Coach recruitability');
  });

  it('does not describe a coverage refusal as a plain absence', () => {
    // "is missing (BELOW_COVERAGE_FLOOR)" bolted two different statements
    // together: which components are absent, and why the layer refused.
    const line = unscoreable(LAYER.RECRUITABILITY, ['positionalOpportunity'], REASON.BELOW_COVERAGE_FLOOR);
    expect(line).not.toContain('BELOW_COVERAGE_FLOOR');
    expect(line).toContain('does not cover enough of the question');
  });

  it('renders every refusal reason the layers can produce', () => {
    for (const reason of Object.values(REASON)) {
      expect(refusalPhrase(reason), `no phrase for ${reason}`).toBeTruthy();
    }
  });

  it('never leaks an enum into a rendered sentence', () => {
    for (const reason of Object.values(REASON)) {
      const line = unscoreable(LAYER.OPPORTUNITY, ['playingPathway'], reason);
      expect(line).not.toMatch(/[A-Z]{3,}_[A-Z]/);
    }
  });

  it('falls back to the identifier rather than inventing a name', () => {
    expect(componentLabel('somethingNew')).toBe('somethingNew');
    expect(layerLabel('somethingNew')).toBe('somethingNew');
    expect(refusalPhrase('SOMETHING_NEW')).toBeNull();
  });

  it('labels every component any layer can report as missing', () => {
    for (const key of ['athleticPlausibility', 'positionalOpportunity', 'internationalPropensity',
      'playingPathway', 'programmeTrajectory', 'majorFit', 'locationFit', 'athleticOutcome']) {
      expect(COMPONENT_LABEL[key], `no label for ${key}`).toBeTruthy();
    }
    for (const key of ['recruitability', 'financial', 'opportunity']) {
      expect(LAYER_LABEL[key], `no label for ${key}`).toBeTruthy();
    }
    expect(Object.keys(REFUSAL_PHRASE).length).toBeGreaterThan(10);
  });
});
