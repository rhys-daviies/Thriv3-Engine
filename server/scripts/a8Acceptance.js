/**
 * A8.3 — THE CANDIDATE V2 ACCEPTANCE INSTRUMENT.
 *
 * One self-contained, deterministic, PII-safe artifact built from the CURRENT
 * repaired engine, holding everything the A8.1 tournament needs to be
 * reproduced: the eight frozen reference athletes, the two A8.0 validation
 * athletes, the declared-major fixture and every controlled arm.
 *
 *   node server/scripts/a8Acceptance.js --out=docs/validation/A8.3-acceptance.json
 *
 * -- WHY SELF-CONTAINED -----------------------------------------------------
 *
 * The A-H half of this is byte-identical to `A8.0-baseline.json`, because no
 * reference athlete declares a major and A8.2 could not reach them. Carrying
 * it anyway costs 3.5MB and buys the property that matters in an acceptance
 * record: a single file that can be re-read years later without having to
 * reassemble it from three predecessors, each of which is immutable for a
 * different reason.
 *
 * A8.0, A8.0B and A8.1 are NOT superseded. They are the historical record of
 * how the defect was found, and this does not replace them.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildBaseline } from './a8Baseline.js';
import { FIXTURES } from './v2Fixtures.js';
import { VALIDATION_FIXTURES } from './v2ValidationFixtures.js';
import { buildArms } from './a8Extension.js';
import { CAPTURED_COMPONENTS } from './a8Extension.js';

/**
 * What the reference athletes carry.
 *
 * `majorFit` only. Every one of them leaves the major null, so the acceptance
 * record should be able to SHOW NOT_APPLICABLE rather than have it taken on
 * trust - but capturing Playing Pathway and trajectory for all 12,484 of their
 * cells as well cost 4MB to restate what the layer totals already carry.
 * The controlled arms keep the components their own question needs.
 */
const ACCEPTANCE_COMPONENTS = Object.freeze(['majorFit']);

export async function buildAcceptance() {
  const arms = buildArms();
  /**
   * The reference athletes carry majorFit too, even though every one of them
   * leaves the major null. The acceptance record should be able to SHOW that
   * it is NOT_APPLICABLE rather than require the reader to take it on trust.
   */
  const fixtures = [
    ...FIXTURES.map((f) => ({ id: f.id, player: f.player, frozen: true })),
    ...VALIDATION_FIXTURES.map((f) => ({ id: f.id, player: f.player, frozen: false })),
    ...arms.map((a) => ({ id: a.id, player: a.player, frozen: false })),
  ];
  const components = Object.fromEntries(fixtures.map((f) => {
    const arm = arms.find((a) => a.id === f.id);
    return [f.id, arm ? CAPTURED_COMPONENTS[arm.family] : ACCEPTANCE_COMPONENTS];
  }));

  const art = await buildBaseline({ profileName: 'UNDECLARED', fixtures, components });
  return {
    ...art,
    phase: 'A8.3',
    engineHead: null,
    supersedes: null,
    historicalInstruments: {
      'A8.0-baseline': '78db6413ead4baf82b6e86b49aebaf9cef8bd59befa8185fb7a5388f798a41f8',
      'A8.0B-extension': '77f9b5c27fc3323671b94c4e0eb5edcb25addea71cc73fd818a253535d125b07',
    },
    arms: arms.map(({ player, ...rest }) => rest),
    cellDigest: crypto.createHash('sha256').update(JSON.stringify(art.cells)).digest('hex'),
  };
}

async function main() {
  const out = process.argv.slice(2).find((a) => a.startsWith('--out='))?.split('=')[1] ?? null;
  const art = await buildAcceptance();
  console.log(`A8.3 acceptance  athletes=${art.athletes.length}  cells=${art.cells.length}`);
  console.log(`digest ${art.cellDigest}`);
  if (out) {
    const file = path.resolve(out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(art)}\n`);
    console.log(`wrote ${file}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('a8Acceptance.js')) await main();
