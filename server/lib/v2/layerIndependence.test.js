import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Raw-input ownership, enforced by reading the source rather than by trusting
 * the review that wrote it.
 *
 * Each of the three layers is entitled to a set of raw inputs, and to no
 * others. The risk this guards is not a deliberate import - the import graph
 * test catches those - but a field quietly read from a row that happens to
 * carry it, which is how `net_price` would end up inside a recruitability
 * score without anybody deciding it should.
 */
const V2 = path.resolve(new URL('.', import.meta.url).pathname, '../../../shared/matching/v2');

/**
 * Source with comments removed.
 *
 * The guard scans CODE. These files explain at length why they do not use the
 * other layers' inputs - opportunityComponents.js names `soccer_score` three
 * times in a paragraph about refusing to score it - and matching that prose
 * would report the explanation as the violation.
 */
const read = (relative) => fs.readFileSync(path.join(V2, relative), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Fields that belong to exactly one layer, and the layers forbidden to name them. */
const OWNERSHIP = [
  { field: 'net_price', owner: 'financial', patterns: [/netPrice/, /net_price/] },
  { field: 'budgetRange', owner: 'financial', patterns: [/budgetRange/, /budget_range/] },
  { field: 'tuition', owner: 'financial', patterns: [/tuitionIn/, /tuitionOut/, /tuition_in/, /tuition_out/] },
  { field: 'aid policy', owner: 'financial', patterns: [/aidPolicy/, /AID_POLICY/, /aidAssumption/] },
  { field: 'soccer_score', owner: 'recruitability', patterns: [/soccerScore/, /soccer_score/] },
  { field: 'athlete rating', owner: 'recruitability', patterns: [/abilityToPercentile/, /athleteRating/] },
  { field: 'recruiting openings', owner: 'recruitability', patterns: [/vacatedStarters/, /fillPropensity/, /typicalStarters/] },
  { field: 'international propensity', owner: 'recruitability', patterns: [/internationalArrival/, /internationalPropensity/] },
  { field: 'location preference', owner: 'opportunity', patterns: [/preferredStates/, /maxDistanceMiles/, /preferredRegions/] },
  { field: 'intended major', owner: 'opportunity', patterns: [/intendedMajor/, /notableMajors/] },
  { field: 'playing share', owner: 'opportunity', patterns: [/playingShare/, /playingScale/] },
];

const LAYER_FILES = {
  financial: ['layers/financial.js', 'financialRules.js'],
  recruitability: ['layers/recruitability.js', 'layers/athleticPlausibility.js',
    'layers/positionalOpportunity.js', 'layers/recruitingBehaviour.js', 'recruitingRules.js'],
  opportunity: ['layers/opportunity.js', 'layers/opportunityComponents.js', 'opportunityRules.js'],
};

describe('raw-input ownership across the three layers', () => {
  it('finds the layer sources it is meant to be guarding', () => {
    for (const files of Object.values(LAYER_FILES)) {
      for (const f of files) expect(read(f).length).toBeGreaterThan(500);
    }
  });

  it.each(OWNERSHIP)('$field belongs to $owner and appears in no other layer', ({ owner, patterns }) => {
    const offences = [];
    for (const [layer, files] of Object.entries(LAYER_FILES)) {
      if (layer === owner) continue;
      for (const file of files) {
        const src = read(file);
        for (const pattern of patterns) {
          if (pattern.test(src)) offences.push(`${layer}/${file} names ${pattern}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it('the owning layer really does name its own inputs, so the test can fail', () => {
    // A guard that passes because nothing matches anywhere is no guard.
    for (const { owner, patterns } of OWNERSHIP) {
      const src = LAYER_FILES[owner].map(read).join('\n');
      expect(patterns.some((p) => p.test(src)), `${owner} names none of ${patterns}`).toBe(true);
    }
  });

  it('no layer imports another layer', () => {
    for (const [layer, files] of Object.entries(LAYER_FILES)) {
      for (const file of files) {
        const src = read(file);
        for (const other of Object.keys(LAYER_FILES)) {
          if (other === layer) continue;
          const pattern = new RegExp(`from '[^']*${other}\\.js'`);
          expect(pattern.test(src), `${file} imports ${other}.js`).toBe(false);
        }
      }
    }
  });
});
