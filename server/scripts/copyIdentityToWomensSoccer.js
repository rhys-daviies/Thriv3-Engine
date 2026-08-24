#!/usr/bin/env node
/**
 * Phase 5a of the women's-soccer buildout: a school's nickname/mascot/
 * colors/logo are facts about the INSTITUTION, not the sport -- so any
 * women's-soccer college row that shares an exact name with an existing
 * mens-soccer row (already identified earlier this project) can just copy
 * that data directly, no Wikipedia lookup needed. Only genuinely new
 * lookups (women's-only programs, or names whose men's row is itself
 * still blank) need the full populateSchoolIdentity.js pipeline -- see
 * populateWomensSoccerIdentity.js for that remainder.
 *
 * Usage:
 *   node server/scripts/copyIdentityToWomensSoccer.js [--apply]
 */
import { College } from '../db/entities/college.js';

const APPLY = process.argv.includes('--apply');

const FIELDS = ['nickname', 'nickname_plural', 'mascot', 'primary_color', 'secondary_color', 'logo_url', 'identity_source', 'identity_notes'];

function main() {
  const mensByName = new Map();
  for (const row of College.filter({ sport: 'mens-soccer' })) {
    if (row.nickname) mensByName.set(row.name, row);
  }

  const womensRows = College.filter({ sport: 'womens-soccer' });
  console.log(`${womensRows.length} womens-soccer rows, ${mensByName.size} mens-soccer rows have identity data to copy from${APPLY ? '' : ' (dry run)'}.`);

  let copied = 0;
  let alreadyHad = 0;
  let noMensMatch = 0;

  for (const row of womensRows) {
    if (row.nickname) { alreadyHad++; continue; }
    const source = mensByName.get(row.name);
    if (!source) { noMensMatch++; continue; }

    copied++;
    if (APPLY) {
      const patch = {};
      for (const f of FIELDS) patch[f] = source[f] ?? null;
      College.update(row.id, patch);
    }
  }

  console.log(`\nDone. ${copied} copied from a matching men's row, ${alreadyHad} already had data, ${noMensMatch} have no identified men's counterpart (need a fresh lookup).`);
  if (!APPLY) console.log('Dry run only -- re-run with --apply to write these to the database.');
}

main();
