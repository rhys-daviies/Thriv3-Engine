#!/usr/bin/env node
/**
 * Builds `institution_aliases` — every spelling that names one institution.
 *
 * TWO SOURCES, BOTH IN THE REPOSITORY. `colleges.name`, for both sports, gives
 * the bulk of it: 1,623 distinct names over 1,229 institutions, and the 378
 * institutions our two sports spell differently become two aliases of one
 * UNITID rather than two institutions. `shared/institutionAliasData.js` adds
 * what our own table does not say — the 2022 Pennsylvania mergers, a rename,
 * and the two spellings the domain audit proved were resolving to the wrong
 * school.
 *
 * A COLLISION IS REFUSED, NOT RESOLVED. `alias_key` is the primary key, so a
 * spelling cannot name two institutions. Where two would claim it, neither is
 * written and the collision is reported: letting the second write win is how a
 * spelling changes meaning between two runs of the same importer.
 *
 * A ROW WITHOUT A UNITID IS NOT AN INSTITUTION. Ten of the 2,155 rows in the
 * report universe have no UNITID on file. They contribute no alias and resolve
 * to nothing, which is the correct outcome: an institution we cannot identify
 * cannot be the answer to "which institution is this".
 *
 *   node server/scripts/importInstitutionAliases.js            # dry run
 *   node server/scripts/importInstitutionAliases.js --apply
 */
import db from '../db/client.js';
import { utcNow } from '../lib/time.js';
import { normaliseInstitution, ALIAS_TYPE, parseInstitutionName } from '../../shared/institutionIdentity.js';
import { CURATED_INSTITUTION_ALIASES } from '../../shared/institutionAliasData.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');

/**
 * The bare-base spelling generated beside a qualified name — "Anderson" beside
 * "Anderson (SC)" — is NOT stored.
 *
 * It is generated at resolve time instead, where it is allowed to collide and
 * the state the source wrote separates the two Andersons. Storing it would
 * force the collision through a PRIMARY KEY that has no way to represent
 * "either of these two, depending on what the source said".
 */
export function aliasRows({ colleges, curated = CURATED_INSTITUTION_ALIASES, now = utcNow() }) {
  const rows = new Map();      // alias_key -> row
  const collisions = [];
  const skippedNoUnitid = [];

  const add = (raw, unitid, aliasType, source, confidence, notes = null) => {
    const key = normaliseInstitution(raw);
    if (!key) return;
    const prev = rows.get(key);
    if (prev) {
      if (prev.unitid !== unitid) {
        collisions.push({ alias: raw, key, unitids: [prev.unitid, unitid], sources: [prev.source, source] });
        rows.delete(key);
        // Remember the refusal so a third claimant cannot quietly re-create it.
        rows.set(key, { refused: true, alias_key: key });
      }
      return;
    }
    rows.set(key, {
      alias_key: key, alias_raw: raw, unitid, alias_type: aliasType,
      source, confidence, notes, imported_at: now,
    });
  };

  for (const c of colleges) {
    if (c.unitid == null) { skippedNoUnitid.push({ name: c.name, sport: c.sport }); continue; }
    add(c.name, c.unitid, ALIAS_TYPE.CURRENT_NAME, 'colleges.name', 'CERTAIN');
  }
  for (const a of curated) {
    add(a.alias, a.unitid, a.aliasType, a.source, a.confidence, a.notes ?? null);
  }

  const usable = [...rows.values()].filter((r) => !r.refused);
  return { rows: usable, collisions, skippedNoUnitid };
}

export function run({ apply = false, log = console.log } = {}) {
  const colleges = db.prepare('SELECT name, sport, unitid FROM colleges').all();
  const { rows, collisions, skippedNoUnitid } = aliasRows({ colleges });

  log(`colleges rows          : ${colleges.length}`);
  log(`institutions (unitid)  : ${new Set(colleges.map((c) => c.unitid).filter((u) => u != null)).size}`);
  log(`rows with no unitid    : ${skippedNoUnitid.length}`);
  log(`curated aliases        : ${CURATED_INSTITUTION_ALIASES.length}`);
  log(`aliases to write       : ${rows.length}`);
  log(`collisions refused     : ${collisions.length}`);
  for (const c of collisions) log(`  REFUSED  "${c.alias}" claimed by ${c.unitids.join(' and ')}`);
  for (const s of skippedNoUnitid) log(`  NO UNITID  ${s.name} (${s.sport})`);

  if (!apply) { log('\ndry run — pass --apply to write'); return { rows, collisions, skippedNoUnitid, written: 0 }; }

  const ins = db.prepare(`INSERT INTO institution_aliases
    (alias_key, alias_raw, unitid, alias_type, source, confidence, notes, imported_at)
    VALUES (@alias_key, @alias_raw, @unitid, @alias_type, @source, @confidence, @notes, @imported_at)`);
  const write = db.transaction((all) => {
    db.prepare('DELETE FROM institution_aliases').run();
    for (const r of all) ins.run(r);
  });
  write(rows);
  const written = db.prepare('SELECT COUNT(*) n FROM institution_aliases').get().n;
  log(`  written: ${written} rows`);
  return { rows, collisions, skippedNoUnitid, written };
}

if (import.meta.url === `file://${process.argv[1]}`) run({ apply: APPLY });
