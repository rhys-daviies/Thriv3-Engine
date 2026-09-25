/**
 * Export the approved canonical product datasets to a reviewable artefact.
 *
 *   npm run canonical:export -- --out ~/thriv3-artefacts
 *
 * READ-ONLY. It opens the corpus, reads two tables and writes one JSON file
 * outside the repository. It cannot write the database, and it carries only
 * the datasets `canonicalProductArtefact.js` names — adding one is an edit to
 * that file, reviewed as code, not a flag someone passes here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { corpusIdentity, sharedCorpusNotice } from '../db/corpusIdentity.js';
import {
  buildArtefact, validateArtefact, DATASETS, ARTEFACT_VERSION, fileDigest,
} from '../lib/canonicalProductArtefact.js';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

function main() {
  const identity = corpusIdentity();
  const notice = sharedCorpusNotice(identity);
  if (notice) console.log(`\n${notice}\n`);

  const artefact = buildArtefact();
  const check = validateArtefact(artefact);
  if (!check.ok) {
    console.error('\nRefusing to write an artefact this build would not accept:');
    for (const e of check.errors) console.error(`  ${e}`);
    process.exit(2);
  }

  console.log('\nCANONICAL PRODUCT EXPORT\n');
  console.log(`  format                ${artefact.format} v${artefact.version}`);
  console.log(`  source corpus         ${artefact.source.manifestVersion} ${artefact.source.corpusDigest.slice(0, 16)}`);
  for (const [name] of Object.entries(DATASETS)) {
    const d = artefact.datasets[name];
    console.log(`  ${name.padEnd(30)} ${String(d.rows).padStart(5)} rows  ${d.digest.slice(0, 16)}  ${d.mode}`);
  }
  console.log(`  artefact digest       ${artefact.digest.slice(0, 16)}`);

  const out = arg('out');
  if (!out) {
    console.log('\n  --out <dir> not given; nothing written.\n');
    return;
  }
  fs.mkdirSync(out, { recursive: true });
  const stamp = artefact.createdAt.replace(/[:.]/g, '-');
  const file = path.join(out, `canonical-product-v${ARTEFACT_VERSION}-${stamp}.json`);
  const text = `${JSON.stringify(artefact, null, 2)}\n`;
  fs.writeFileSync(file, text);
  console.log(`\n  written               ${file}`);
  console.log(`  file sha256           ${fileDigest(text).slice(0, 16)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
