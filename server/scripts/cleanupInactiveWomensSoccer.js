#!/usr/bin/env node
/**
 * Deletes womens-soccer colleges rows for programs confirmed (during the
 * 36-school gap-fill research) to not belong in an NCAA-division dataset --
 * either no NCAA-tracked program exists (Puerto Rico schools whose actual
 * competition is the non-NCAA LAI league) or the school competes in USCAA,
 * not NCAA D3 (several Penn State branch campuses, Bay Path).
 *
 * Deliberately excludes Tuskegee and Wayne State (MI): both are real,
 * newly-approved NCAA D2 programs debuting in 2026 -- legitimate future
 * destinations with no history yet, not phantom entries.
 *
 * Without --apply, runs as a dry run and prints what would change.
 */
import { College } from '../db/entities/college.js';

const APPLY = process.argv.includes('--apply');

const CONFIRMED_NOT_APPLICABLE = [
  'Puerto Rico-Bayamón',
  'Puerto Rico-Río Piedras',
  'Pennsylvania State University-Penn State Brandywine',
  'Pennsylvania State University-Penn State Schuylkill',
  'Bay Path University',
];

function main() {
  let found = 0;
  for (const name of CONFIRMED_NOT_APPLICABLE) {
    const rows = College.filter({ sport: 'womens-soccer', name });
    for (const r of rows) {
      found++;
      console.log(`${APPLY ? 'deleting' : 'would delete'}: ${name} (${r.division}, score=${r.soccer_score})`);
      if (APPLY) College.delete(r.id);
    }
  }
  console.log(`\n${found} rows ${APPLY ? 'deleted' : 'would be deleted'}.`);
  if (!APPLY) console.log('Dry run only -- re-run with --apply to write these to the database.');
}

main();
