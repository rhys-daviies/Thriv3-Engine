#!/usr/bin/env node
/**
 * Loads `conference_members_official` from the NCAA's own member directory.
 *
 * WHAT IT IS FOR. Two things, and nothing else:
 *
 *   1. THE CONFERENCE UNIVERSE. 12D built its inventory from the conference
 *      strings in `colleges`, which made coverage circular — the Great
 *      Northeast Athletic Conference was never looked for because our data
 *      never names it, and the Mid-American was only looked for in women's
 *      soccer because that is the only sport our data attaches to it. The
 *      directory answers the question independently.
 *
 *   2. BREAKING A TIE BETWEEN INSTITUTIONS THAT SHARE A SPELLING. Three
 *      colleges are called Westminster and the Presidents' Athletic Conference
 *      publishing one of them is evidence about which. That is a statement
 *      about identity, not about a season.
 *
 * WHAT IT IS NOT FOR. Historical membership. The directory's `academicYear`
 * parameter is accepted and silently ignored — it returns the current year
 * whatever is asked — and the conference it lists is a school's primary
 * conference, which for soccer is sometimes a different one. Treating it as
 * history would be the current-division error wearing a different hat.
 *
 *   node server/scripts/importOfficialMembership.js            # dry run
 *   node server/scripts/importOfficialMembership.js --apply
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import db from '../db/client.js';
import { utcNow } from '../lib/time.js';
import { resolveConference } from '../../shared/conferenceIdentity.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DIR = arg('dir', path.join(os.homedir(), 'Documents/Thriv3/Competitive Collection'));
export const ARTEFACT = 'ncaa-conference-membership.json';

/** Fails closed: an empty directory looks exactly like an association with no members. */
export function readMembership(dir = DIR) {
  const f = path.join(dir, ARTEFACT);
  if (!fs.existsSync(f)) throw new Error(`official membership artefact not found: ${f}`);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!Array.isArray(j.members) || !j.members.length) throw new Error(`official membership artefact is empty: ${f}`);
  return j;
}

export function build({ artefact, now = utcNow() }) {
  const rows = [];
  const unresolved = new Map();
  for (const m of artefact.members) {
    const r = resolveConference(m.conferenceRaw, { division: m.division });
    if (!r.id) { unresolved.set(m.conferenceRaw, (unresolved.get(m.conferenceRaw) ?? 0) + 1); continue; }
    rows.push({
      unitid: m.unitid, conference_id: r.id, conference_raw: String(m.conferenceRaw).trim(),
      division: m.division ?? null, name_official: m.nameOfficial,
      athletics_host: m.athleticsHost ?? null, state: m.state ?? null,
      identity_method: m.identityMethod ?? null, source: artefact.source, imported_at: now,
    });
  }
  // One institution, one row per conference. The directory lists each once.
  const seen = new Set();
  const deduped = rows.filter((r) => { const k = `${r.unitid}|${r.conference_id}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { rows: deduped, unresolved: [...unresolved.entries()].sort((a, b) => b[1] - a[1]) };
}

export function run({ apply = false, dir = DIR, log = console.log } = {}) {
  const artefact = readMembership(dir);
  const { rows, unresolved } = build({ artefact });
  log(`official membership rows in the artefact : ${artefact.members.length}`);
  log(`resolved to a canonical conference       : ${rows.length}`);
  log(`conference spellings not resolved        : ${unresolved.length}`);
  for (const [name, n] of unresolved.slice(0, 12)) log(`  ${String(n).padStart(4)}  ${name}`);
  if (!apply) { log('\ndry run — pass --apply to write'); return { rows, unresolved, written: 0 }; }
  const cols = Object.keys(rows[0]);
  const ins = db.prepare(`INSERT INTO conference_members_official (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`);
  const write = db.transaction((all) => {
    db.prepare('DELETE FROM conference_members_official').run();
    for (const r of all) ins.run(r);
  });
  write(rows);
  const n = db.prepare('SELECT COUNT(*) n FROM conference_members_official').get().n;
  log(`  written: ${n} rows`);
  return { rows, unresolved, written: n };
}

if (import.meta.url === `file://${process.argv[1]}`) run({ apply: APPLY });
