#!/usr/bin/env node
/**
 * Audits every colleges row that already has a Wikipedia identity_source
 * against the guards in populateSchoolIdentity.js, and re-resolves any
 * that fail. Built after discovering that the original (pre-guard)
 * population run had silently matched some schools to a same-named but
 * entirely unrelated institution -- Aquinas College (Michigan) attributed
 * a Philippine university's mascot, "Point (GA)" attributed Stanford's,
 * one row's identity_source was literally Kim Il Sung University. These
 * don't look corrupted (no stray wikitext, just a plausible-looking wrong
 * answer), so nothing but re-checking every one catches them.
 *
 * Two passes per row to keep ~1000 schools affordable:
 *   1. A cheap single-fetch validation of the row's EXISTING
 *      identity_source title, forced through the strictest tier ('search')
 *      since we don't know whether it was originally resolved via a
 *      trusted direct redirect or a search guess. Rows that still pass
 *      are left untouched.
 *   2. Rows that fail get a full, tier-aware lookupIdentity() re-run.
 *      That correctly re-confirms a real direct-redirect match (e.g. "NC
 *      State" fails the cheap check on "NC" vs "North Carolina" but is
 *      re-confirmed here) or corrects/clears a genuinely wrong one.
 *
 * Usage:
 *   node server/scripts/auditSchoolIdentity.js [--apply] [--limit N]
 *
 * Without --apply, runs as a dry run and prints what would change.
 */
import { College } from '../db/entities/college.js';
import { isPluralNickname } from '../lib/nicknameGrammar.js';
import { fetchSectionZero, parseInfobox, matchConfidence, lookupIdentity, mapWithConcurrency, CONCURRENCY } from './populateSchoolIdentity.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const limitArg = args.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg ? Number(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1]) : Infinity;

async function validateExisting(name, title) {
  const wikitext = await fetchSectionZero(title);
  const fields = wikitext && parseInfobox(wikitext);
  if (!fields) return false;
  return matchConfidence(name, title, fields, 'search') > 0;
}

function clearRow(row, reason) {
  College.update(row.id, {
    nickname: null,
    nickname_plural: null,
    mascot: null,
    primary_color: null,
    secondary_color: null,
    logo_url: null,
    identity_source: null,
    identity_notes: reason,
  });
}

function writeRow(row, identity) {
  College.update(row.id, {
    nickname: identity.nickname,
    nickname_plural: identity.nickname ? (isPluralNickname(identity.nickname) ? 1 : 0) : null,
    mascot: identity.mascot,
    primary_color: identity.primary_color,
    secondary_color: identity.secondary_color,
    logo_url: identity.logo_url,
    identity_source: `wikipedia:${identity.title}`,
    identity_notes: null,
  });
}

async function main() {
  const rows = College.list().filter((c) => c.identity_source && c.identity_source.startsWith('wikipedia:'));
  const byName = new Map();
  for (const c of rows) {
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  }
  const names = [...byName.keys()].slice(0, LIMIT);
  console.log(`${rows.length} rows with a Wikipedia identity_source, ${names.length} unique names to audit${APPLY ? '' : ' (dry run)'}.`);

  let ok = 0;
  let flagged = 0;
  let fixed = 0;
  let cleared = 0;
  let errors = 0;
  let done = 0;

  await mapWithConcurrency(names, CONCURRENCY, async (name) => {
    const title = byName.get(name)[0].identity_source.replace(/^wikipedia:/, '');

    let valid;
    try {
      valid = await validateExisting(name, title);
    } catch (err) {
      errors++;
      console.log(`ERROR  ${name}: ${err.message}`);
      return;
    }
    done++;
    if (done % 100 === 0) console.log(`... ${done}/${names.length} audited`);
    if (valid) { ok++; return; }

    flagged++;
    let identity;
    try {
      identity = await lookupIdentity(name);
    } catch (err) {
      errors++;
      console.log(`ERROR  ${name} (re-resolve): ${err.message}`);
      return;
    }

    if (identity && identity.title === title) {
      // Tier-aware re-check confirms the SAME title after all (e.g. "NC
      // State" -- the cheap check doesn't know "NC" means "North
      // Carolina", but lookupIdentity's direct-redirect tier does).
      ok++;
      return;
    }

    if (!identity) {
      cleared++;
      console.log(`CLEAR  ${name} (was -> ${title}): no plausible match on re-check`);
      if (APPLY) {
        for (const row of byName.get(name)) {
          clearRow(row, `Cleared on audit: previous match (${title}) failed re-verification`);
        }
      }
      return;
    }

    fixed++;
    console.log(`FIX    ${name}: ${title} -> ${identity.title} (nickname=${identity.nickname || '—'} mascot=${identity.mascot || '—'})`);
    if (APPLY) {
      for (const row of byName.get(name)) writeRow(row, identity);
    }
  });

  console.log(`\nDone. ${ok} confirmed fine, ${flagged} flagged, ${fixed} corrected, ${cleared} cleared (no valid match), ` +
    `${errors} errors, out of ${names.length}.`);
  if (!APPLY) console.log('Dry run only -- re-run with --apply to write these to the database.');
}

main();
