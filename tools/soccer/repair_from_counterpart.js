#!/usr/bin/env node
/**
 * Repair rows whose WRONG identity was exposed by the same school's other-sport row.
 *
 * The two source files spell schools differently ("Franklin" / "Franklin College"), so each
 * institution often has two rows resolved independently. When they disagree, one of them
 * matched a different school -- and that is a witness the domain check cannot provide,
 * because these schools publish no nickname-bearing athletics host. It caught seven:
 *
 *   Franklin College   held Franklin & MARSHALL's Diplomats
 *   Bethel (IN)        held Bethel University TENNESSEE's Wildcats
 *   Grace              held GRACE UNIVERSITY (Omaha)'s Royals
 *   Hamilton           held MIAMI UNIVERSITY Hamilton's Harriers
 *   Saint Vincent      held MOUNT Saint Vincent's Dolphins
 *   Union (NY)         held ST. JOHN'S's Red Storm
 *   Williams           held ROGER Williams's Hawks
 *
 * The fix copies from the row that is right, which also makes the pair consistent. Each
 * entry names the row to FIX and the row to copy FROM explicitly -- no fuzzy pairing at
 * write time, because core-name pairing is safe for flagging and unsafe for writing
 * ("Pacific" and "Pacific University" share a core token and are different schools).
 *
 * Deliberately NOT touched: Centenary (LA) Gentlemen/Ladies, Oberlin Yeomen/Yeowomen and
 * Xavier (LA) Gold Rush/Gold Nuggets also differ across sports -- correctly, because those
 * schools really do name their women's teams separately.
 *
 * Usage: node repair_from_counterpart.js [--apply]
 */
import { College } from '../app/server/db/entities/college.js';
import { isPluralNickname } from '../app/server/lib/nicknameGrammar.js';

const APPLY = process.argv.includes('--apply');

// [ name to fix, its sport, name to copy from, its sport, nickname we expect to end up with ]
const FIXES = [
  ['Franklin College',      'womens-soccer', 'Franklin',              'mens-soccer',   'Grizzlies'],
  ['Bethel University (IN)', 'womens-soccer', 'Bethel (IN)',          'mens-soccer',   'Pilots'],
  ['Grace',                 'mens-soccer',   'Grace College',         'womens-soccer', 'Lancers'],
  ['Hamilton',              'mens-soccer',   'Hamilton College',      'womens-soccer', 'Continentals'],
  ['Saint Vincent',         'mens-soccer',   'Saint Vincent College', 'womens-soccer', 'Bearcats'],
  ['Union (NY)',            'mens-soccer',   'Union College (NY)',    'womens-soccer', 'Garnet Chargers'],
  ['Williams',              'mens-soccer',   'Williams College',      'womens-soccer', 'Ephs'],
  // "Army" resolved to Army University -- a real institution, not West Point. The core-name
  // pairing missed it because "Army" and "Army West Point" do not reduce to the same tokens,
  // so it needed naming by hand.
  ['Army',                  'womens-soccer', 'Army West Point',       'mens-soccer',   'Black Knights'],
];

const FIELDS = ['nickname', 'mascot', 'primary_color', 'secondary_color', 'logo_url'];
let fixed = 0, skipped = 0;

for (const [badName, badSport, goodName, goodSport, expect] of FIXES) {
  const bad = College.list().find((c) => c.name === badName && c.sport === badSport);
  const good = College.list().find((c) => c.name === goodName && c.sport === goodSport);
  if (!bad || !good) {
    console.log(`SKIP  ${badName}: row not found (${!bad ? 'target' : 'source'})`);
    skipped++; continue;
  }
  // assertion: the source row must carry the nickname we independently expect, or this is
  // not the repair we reasoned about and must not be written
  if ((good.nickname || '').toLowerCase() !== expect.toLowerCase()) {
    console.log(`SKIP  ${badName}: source "${goodName}" has ${JSON.stringify(good.nickname)}, ` +
      `expected ${JSON.stringify(expect)} -- not writing`);
    skipped++; continue;
  }
  fixed++;
  console.log(`FIX   ${badName.padEnd(24)} ${JSON.stringify(bad.nickname)} -> ${JSON.stringify(good.nickname)}   ` +
    `(from ${goodName}; was ${bad.identity_source})`);
  if (!APPLY) continue;
  const patch = { identity_source: good.identity_source,
    identity_notes: `corrected from this school's ${goodSport === 'mens-soccer' ? "men's" : "women's"} `
      + `row: had been matched to a different institution of a similar name `
      + `(${bad.identity_source})` };
  for (const f of FIELDS) patch[f] = good[f] ?? null;
  patch.nickname_plural = good.nickname ? (isPluralNickname(good.nickname) ? 1 : 0) : null;
  College.update(bad.id, patch);
}
console.log(`\n${fixed} fixed, ${skipped} skipped${APPLY ? ' (applied)' : ' (dry run)'}`);
