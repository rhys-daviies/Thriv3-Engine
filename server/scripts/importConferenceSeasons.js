#!/usr/bin/env node
/**
 * Builds `conference_seasons` and `programme_conference_seasons` — which
 * conference and which division every programme actually played in, season by
 * season.
 *
 * THE SOURCE is a collection artefact written outside this repository, at
 * ~/Documents/Thriv3/Competitive Collection/conference-standings.json. It holds
 * what each conference PUBLISHED: its member rows exactly as printed, the URL
 * they came from, the platform, and whether the page's own title confirmed the
 * season and the sport. It resolves nothing and decides nothing.
 *
 * EVERYTHING THAT IS A JUDGEMENT HAPPENS HERE. Identity resolution, record
 * parsing, division derivation and quarantine are production code with tests,
 * so adding one alias re-imports the whole layer in seconds with no refetch —
 * and so that every row in the table was written by something that can be read.
 *
 * WHY THE CONFERENCE SIDE. One fetch of a conference's standings page returns
 * every member of that conference for that season. Phase 12C spent 1,088
 * requests on 100 programmes and reached historical conference for 19.8% of
 * their seasons; the conference side covers the whole universe in about 1,300.
 *
 * A PROGRAMME IN TWO CONFERENCES IN ONE SEASON IS REFUSED, BOTH TIMES. The
 * primary key would let the second write win, and the second write winning is
 * how a programme's division changes depending on which conference was imported
 * last. Both claims are quarantined with each other named.
 *
 *   node server/scripts/importConferenceSeasons.js            # dry run
 *   node server/scripts/importConferenceSeasons.js --apply
 *   node server/scripts/importConferenceSeasons.js --dir /path/to/collection
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import db from '../db/client.js';
import { utcNow } from '../lib/time.js';
import { buildResolvers, PROGRAMME_UNRESOLVED } from '../lib/institutionQueries.js';
import {
  DIVISIONS, DIVISION_PROVENANCE, COLLECTION_STATUS, MEMBERSHIP_PROVENANCE, RECORD_STATUS,
  deriveConferenceDivision, parseConferenceRecord, reconcileMembership,
} from '../../shared/conferenceHistory.js';
import { conferenceById, resolveConference } from '../../shared/conferenceIdentity.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DIR = arg('dir', path.join(os.homedir(), 'Documents/Thriv3/Competitive Collection'));

export const ARTEFACT = 'conference-standings.json';
export const PROGRAMME_ARTEFACT = 'programme-season-conference.json';
export const SEASONS = [2022, 2023, 2024, 2025];

/** Fails closed. An absent or empty artefact looks exactly like a universe with no conferences. */
/**
 * The programme-side conference evidence, where it exists.
 *
 * OPTIONAL AND LOWER PRIORITY, and it is neither of those because of who
 * collected it. The Pac-12's own site no longer publishes its pre-collapse
 * standings, and `calbears.com` does publish California's 2022 season and the
 * conference it played in; that is an official statement by the institution
 * about its own season. It is consulted only where the conference side is
 * silent, and a disagreement between the two is a refusal, not a ranking.
 */
export function readProgrammeArtefact(dir = DIR) {
  const f = path.join(dir, PROGRAMME_ARTEFACT);
  if (!fs.existsSync(f)) return { seasons: [] };
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!Array.isArray(j.seasons)) throw new Error(`malformed programme-season conference artefact: ${f}`);
  return j;
}

export function readArtefact(dir = DIR) {
  const f = path.join(dir, ARTEFACT);
  if (!fs.existsSync(f)) throw new Error(`conference standings artefact not found: ${f}`);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!Array.isArray(j.conferences) || !j.conferences.length) throw new Error(`conference standings artefact is empty: ${f}`);
  for (const c of j.conferences) {
    if (!c.conferenceId || !c.sport || !c.seasons) throw new Error(`malformed conference entry: ${JSON.stringify(c).slice(0, 120)}`);
  }
  return j;
}

export const QUARANTINE = Object.freeze({
  IDENTITY_UNRESOLVED: 'IDENTITY_UNRESOLVED',
  STATE_CONFLICT: 'STATE_CONFLICT',
  OFFICIAL_ROSTER_CONTRADICTS: 'OFFICIAL_ROSTER_CONTRADICTS',
  MEMBERSHIP_AMBIGUOUS: 'MEMBERSHIP_AMBIGUOUS',
  NO_PROGRAMME_IN_SPORT: 'NO_PROGRAMME_IN_SPORT',
  RECORD_UNREADABLE: 'RECORD_UNREADABLE',
  TWO_CONFERENCES_ONE_SEASON: 'TWO_CONFERENCES_ONE_SEASON',
});

/**
 * Turns the artefact into rows.
 *
 * @param artefact  the collection artefact
 * @param resolvers `buildResolvers()`
 * @param collegeDivision `{ [collegeId]: 'NCAA D2' }` — CURRENT divisions, used
 *   ONLY to establish a CONFERENCE's division from its own membership. It never
 *   becomes a programme's historical division; that is the error this layer
 *   exists to prevent.
 */
/**
 * Which of a standings row's two records is the CONFERENCE one.
 *
 * The column order varies by site, and the header does not settle it reliably:
 * some tables print the group headings in one row and the column names in
 * another, and both survive the cell-flattening differently. Reading "the first
 * record in the row" put the OVERALL record into the conference column for the
 * GMAC and 22 other conference-seasons — a wrong number rather than a missing
 * one, and it was only visible because Phase 12C had collected the same figure
 * from the schools' own pages.
 *
 * So the tie is broken with something we already hold and trust: the
 * programme's own overall record from `programme_seasons`. If exactly one of
 * the two printed records IS that overall record, the other one is the
 * conference record. Where neither matches or both do, the site's header order
 * is used, and where that is silent the first record is taken.
 */
export function pickConferenceRecord({ confRecord, overallRecord, recordColumnOrder, matchesPlayed = null }, overall) {
  const same = (a) => {
    if (!a || !overall) return false;
    const p = String(a).split('-').map(Number);
    if (p.length === 2) p.push(0);
    return p[0] === overall.wins && p[1] === overall.losses && p[2] === overall.draws;
  };
  if (overall && confRecord && overallRecord) {
    if (same(confRecord) && !same(overallRecord)) return { record: overallRecord, method: 'OVERALL_RECORD_IDENTIFIED' };
    if (same(overallRecord) && !same(confRecord)) return { record: confRecord, method: 'OVERALL_RECORD_IDENTIFIED' };
  }
  // THE CHOSEN RECORD IS THE OVERALL ONE. The Mountain East publishes the
  // overall record where the conference record belongs, so elimination has
  // nothing to eliminate against and the number was being stored as a
  // conference record for 28 programme-seasons. A triple that equals the
  // programme's own overall record is that record appearing twice: no college
  // soccer programme plays a schedule with no non-conference match in it.
  if (overall && confRecord && same(confRecord)) {
    return { record: null, method: 'SOURCE_PUBLISHED_OVERALL_ONLY' };
  }
  return { record: confRecord, method: recordColumnOrder ?? 'FIRST_RECORD_COLUMN' };
}

export function build({ artefact, programmeArtefact = null, resolvers, collegeDivision, overallRecords = {}, now = utcNow() }) {
  const resolvedByConf = new Map();   // conf|sport|season -> [{member, hit}]
  const conferenceRows = [];
  const quarantine = [];

  // ONE URL IS ONE TABLE, whatever it was fetched under. `gomacsports.com`
  // serves the Middle Atlantic Conference's Commonwealth and Freedom divisions
  // from a single standings page, and `cnesports.org` serves both the
  // Commonwealth Coast Conference and the Conference of New England it became.
  // Collected under two conference ids each, the same table claimed every
  // member twice and 304 programme-seasons were refused as double-claimed. The
  // first id to reach a URL keeps it; the second is recorded as a duplicate.
  const urlOwner = new Map();
  const duplicateSources = [];

  // ── pass 1: resolve every member the conferences printed ──────────────────
  for (const c of artefact.conferences) {
    for (const [seasonStr, s] of Object.entries(c.seasons ?? {})) {
      const season = Number(seasonStr);
      if (!SEASONS.includes(season) || s.status !== 'OK') continue;
      // THE CONFERENCE IS WHAT THE TABLE SAYS IT IS. Every collected page names
      // its own conference after the sport — "2022 Men's Soccer Standings -
      // Middle Atlantic Conference" — and that beats the id the crawl filed it
      // under, which came from our own `colleges.conference` spellings. It is
      // how the two MAC divisions resolve to the one conference that publishes
      // the table, and how the Conference of New England's own 2022 page is
      // read as the CNE rather than as the conference we guessed.
      const titled = /\s[-–—]\s(.+?)\s*$/.exec(s.title ?? '')?.[1] ?? null;
      const fromTitle = titled ? resolveConference(titled, { sport: c.sport }) : { id: null };
      const conferenceId = fromTitle.id ?? c.conferenceId;
      const conferenceRaw = titled ?? c.conferenceName;
      const urlKey = `${s.url}|${c.sport}`;
      if (urlOwner.has(urlKey)) {
        duplicateSources.push({ url: s.url, sport: c.sport, season, keptAs: urlOwner.get(urlKey), alsoClaimedBy: conferenceId });
        continue;
      }
      urlOwner.set(urlKey, conferenceId);
      const hits = [];
      for (const m of s.members ?? []) {
        // `membersOnly`: a standings table is a membership table, and only NCAA
        // and NAIA institutions can be in one.
        const hit = resolvers.resolveProgramme(m.raw, c.sport, { conferenceId, membersOnly: true });
        if (!hit.collegeId) {
          quarantine.push({
            conference_id: conferenceId, sport: c.sport, season, member_raw: m.raw,
            reason: hit.reason === PROGRAMME_UNRESOLVED.AMBIGUOUS ? QUARANTINE.MEMBERSHIP_AMBIGUOUS
              : hit.reason === PROGRAMME_UNRESOLVED.NO_PROGRAMME_IN_SPORT ? QUARANTINE.NO_PROGRAMME_IN_SPORT
                : hit.reason === PROGRAMME_UNRESOLVED.STATE_CONFLICT ? QUARANTINE.STATE_CONFLICT
                  : hit.reason === PROGRAMME_UNRESOLVED.OFFICIAL_ROSTER_CONTRADICTS ? QUARANTINE.OFFICIAL_ROSTER_CONTRADICTS
                    : QUARANTINE.IDENTITY_UNRESOLVED,
            candidates: hit.candidates ? JSON.stringify(hit.candidates) : null,
            conference_record: m.conferenceRecord ?? null,
            source_url: s.url, imported_at: now,
          });
          continue;
        }
        hits.push({ member: m, hit });
      }
      resolvedByConf.set(`${conferenceId}|${c.sport}|${season}`, { conference: c, conferenceId, conferenceRaw, season: s, hits });
    }
  }

  // ── pass 2: each conference-season's division, from its own membership ────
  const divisionOf = new Map();
  for (const [key, { conference, hits }] of resolvedByConf) {
    const memberDivisions = {};
    for (const h of hits) {
      const d = collegeDivision[h.hit.collegeId];
      if (d) memberDivisions[d] = (memberDivisions[d] ?? 0) + 1;
    }
    divisionOf.set(key, deriveConferenceDivision({ statements: conference.divisionStatements ?? [], memberDivisions }));
  }

  // Divisions by conference-season, so a source other than that conference's own
  // table can still place a member in the division the conference was in.
  const divisionForConference = new Map();
  for (const [key, div] of divisionOf) {
    const [id, , season] = key.split('|');
    divisionForConference.set(`${id}|${season}`, div);
    if (!divisionForConference.has(`${id}|any`)) divisionForConference.set(`${id}|any`, div);
  }

  // ── pass 3: one row per programme-season, refusing every double claim ─────
  const claims = new Map();   // collegeId|season -> [candidate]
  for (const [key, { conference, conferenceId, conferenceRaw, season: s, hits }] of resolvedByConf) {
    const [, , seasonStr] = key.split('|');
    const season = Number(seasonStr);
    const div = divisionOf.get(key);
    for (const { member, hit } of hits) {
      const chosen = pickConferenceRecord(
        {
          confRecord: member.conferenceRecord, overallRecord: member.overallRecord,
          recordColumnOrder: member.recordColumnOrder, matchesPlayed: member.conferenceMatches,
        },
        overallRecords[`${hit.collegeId}|${season}`] ?? null,
      );
      const rec = parseConferenceRecord(chosen.record, { matchesPlayed: member.conferenceMatches });
      if (chosen.record && !rec.ok) {
        quarantine.push({
          conference_id: conferenceId, sport: conference.sport, season, member_raw: member.raw,
          reason: QUARANTINE.RECORD_UNREADABLE, candidates: null,
          conference_record: chosen.record, source_url: s.url, imported_at: now,
        });
      }
      const k = `${hit.collegeId}|${season}`;
      if (!claims.has(k)) claims.set(k, []);
      claims.get(k).push({
        college_id: hit.collegeId,
        sport: conference.sport,
        season,
        unitid: hit.unitid ?? null,
        conference_id: conferenceId,
        conference_raw: conferenceRaw,
        historical_division: div.division ?? null,
        division_provenance: div.provenance,
        conference_wins: rec.ok ? rec.wins : null,
        conference_draws: rec.ok ? rec.draws : null,
        conference_losses: rec.ok ? rec.losses : null,
        conference_matches: rec.ok ? rec.matches : null,
        // The size of the conference AS IT PUBLISHED IT, not the number of its
        // members we managed to resolve. Storing the resolved count would make
        // a conference look smaller every time an alias was missing.
        conference_size: (s.members ?? []).length,
        conference_table_row: member.row ?? null,
        conference_group: member.group ?? null,
        seed: member.seed ?? null,
        champion_marker: member.champion ? 1 : 0,
        member_raw: member.printed ?? member.raw,
        identity_method: hit.method,
        identity_evidence: 'CONFERENCE_MEMBERSHIP_CORROBORATION',
        membership_provenance: MEMBERSHIP_PROVENANCE.OFFICIAL_CONFERENCE_STANDINGS,
        record_status: rec.ok ? RECORD_STATUS.RECORD_KNOWN : RECORD_STATUS.RECORD_UNAVAILABLE,
        source_url: s.url,
        source_platform: s.platform,
        provenance: `${s.platform}:${s.seasonConfirmed ? 'SEASON_CONFIRMED' : 'SEASON_UNCONFIRMED'}:${chosen.method}`,
        confidence: s.seasonConfirmed && s.sportConfirmed ? 'CERTAIN' : 'CORROBORATED',
        season_confirmed: s.seasonConfirmed ? 1 : 0,
        imported_at: now,
      });
    }
  }

  // ── the programme side, consulted only where the conference side is silent ──
  const programmeClaims = [];
  for (const p of (programmeArtefact?.seasons ?? [])) {
    const season = Number(p.season);
    if (!SEASONS.includes(season)) continue;
    const hit = resolvers.resolveProgramme(p.collegeName, p.sport, { membersOnly: true });
    if (!hit.collegeId) continue;
    const conf = resolveConference(p.conferenceRaw, { sport: p.sport });
    if (!conf.id) continue;
    programmeClaims.push({ collegeId: hit.collegeId, hit, season, conferenceId: conf.id, raw: p });
  }
  const conflicts = [];
  for (const pc of programmeClaims) {
    const k = `${pc.collegeId}|${pc.season}`;
    const existing = claims.get(k) ?? [];
    // Where the conference side already carries this programme-season, the two
    // are reconciled: agreement raises confidence, disagreement refuses both.
    if (existing.length) {
      const verdict = reconcileMembership([
        ...existing.map((e) => ({ conferenceId: e.conference_id, membershipProvenance: e.membership_provenance })),
        { conferenceId: pc.conferenceId, membershipProvenance: MEMBERSHIP_PROVENANCE.OFFICIAL_PROGRAMME_SOURCE },
      ]);
      if (verdict.status === COLLECTION_STATUS.CONFLICTING_OFFICIAL_SOURCES) {
        conflicts.push({
          collegeId: pc.collegeId, season: pc.season, reason: verdict.reason,
          claims: verdict.claims, programmeSource: pc.raw.sourceUrl,
        });
        claims.delete(k);
        continue;
      }
      // The programme's own page settled a dispute between two conference
      // tables: keep only the claim it agrees with.
      if (verdict.resolvedBy === 'OFFICIAL_PROGRAMME_SOURCE_AGREEMENT' && existing.length > 1) {
        claims.set(k, existing.filter((e) => e.conference_id === verdict.conferenceId)
          .map((e) => ({ ...e, provenance: `${e.provenance}:CORROBORATED_BY_PROGRAMME_SOURCE` })));
      }
      continue;
    }
    const rec = parseConferenceRecord(pc.raw.officialConferenceRecord);
    const div = divisionForConference.get(`${pc.conferenceId}|${pc.season}`)
      ?? divisionForConference.get(`${pc.conferenceId}|any`) ?? null;
    claims.set(k, [{
      college_id: pc.collegeId, sport: pc.raw.sport, season: pc.season, unitid: pc.hit.unitid ?? null,
      conference_id: pc.conferenceId, conference_raw: pc.raw.conferenceRaw,
      historical_division: div?.division ?? null,
      division_provenance: div?.provenance ?? DIVISION_PROVENANCE.UNKNOWN,
      conference_wins: rec.ok ? rec.wins : null,
      conference_draws: rec.ok ? rec.draws : null,
      conference_losses: rec.ok ? rec.losses : null,
      conference_matches: rec.ok ? rec.matches : null,
      conference_size: null, conference_table_row: null, conference_group: null,
      seed: null, champion_marker: 0,
      member_raw: pc.raw.collegeName, identity_method: pc.hit.method,
      identity_evidence: 'EXPLICIT_PAGE_INSTITUTION',
      membership_provenance: MEMBERSHIP_PROVENANCE.OFFICIAL_PROGRAMME_SOURCE,
      record_status: rec.ok ? RECORD_STATUS.RECORD_KNOWN : RECORD_STATUS.RECORD_UNAVAILABLE,
      source_url: pc.raw.sourceUrl, source_platform: pc.raw.sourcePlatform,
      provenance: `${pc.raw.sourcePlatform}:${pc.raw.conferenceProvenance ?? 'EXPLICIT_OFFICIAL'}`,
      confidence: 'CERTAIN', season_confirmed: 1, imported_at: now,
    }]);
  }

  const programmeRows = [];
  for (const [, candidates] of claims) {
    if (candidates.length === 1) { programmeRows.push(candidates[0]); continue; }
    // Two conferences printed the same programme in the same season. A
    // confirmed season beats an unconfirmed one, because one of them read its
    // own year off the page and the other did not. Otherwise both are refused.
    const confirmed = candidates.filter((c) => c.season_confirmed === 1);
    if (confirmed.length === 1) { programmeRows.push(confirmed[0]); continue; }
    // An exact name beats a rewritten one. Two conferences printed "Xavier" —
    // the Big East means Xavier University in Ohio and the Red River Athletic
    // Conference means Xavier University of Louisiana — and only one of those
    // is spelled the way our own table spells it. Where nothing separates them,
    // both are still refused.
    const pool = confirmed.length ? confirmed : candidates;
    // A LADDER, NOT A SINGLE TEST. Two conferences printing a name that resolves
    // to one programme means at least one of them was resolved by something
    // weaker than its own spelling: the Big Ten's "Northwestern" is exact and
    // the UMAC's is a conference tie-break, and the exact one is the claim to
    // keep. Where the strongest rung holds two claims, both are still refused.
    // A CONFERENCE-SCOPED ALIAS SITS AT THE TOP because it is the conference
    // itself saying who it means, which no rewriting of its spelling can beat.
    const RANK = ['PROGRAMME_VIA_CONFERENCE_SCOPED_ALIAS',
      'PROGRAMME_NAME_EXACT', 'PROGRAMME_NAME_VARIANT',
      'PROGRAMME_VIA_OFFICIAL_MEMBERSHIP', 'PROGRAMME_VIA_CONFERENCE_AGREEMENT',
      'PROGRAMME_VIA_UNITID_NAME', 'PROGRAMME_VIA_UNITID'];
    let picked = null;
    for (const rung of RANK) {
      const at = pool.filter((c) => c.identity_method === rung);
      if (at.length === 1) { picked = at[0]; break; }
      if (at.length > 1) break;
    }
    if (picked) { programmeRows.push(picked); continue; }
    for (const c of candidates) {
      quarantine.push({
        conference_id: c.conference_id, sport: c.sport, season: c.season, member_raw: c.member_raw,
        reason: QUARANTINE.TWO_CONFERENCES_ONE_SEASON,
        candidates: JSON.stringify(candidates.map((x) => x.conference_id)),
        conference_record: null, source_url: c.source_url, imported_at: now,
      });
    }
  }

  // ── the conference-level rows ─────────────────────────────────────────────
  for (const [key, { conference, conferenceId, conferenceRaw, season: s, hits }] of resolvedByConf) {
    const season = Number(key.split('|')[2]);
    const div = divisionOf.get(key);
    conferenceRows.push({
      conference_id: conferenceId,
      conference_name: conferenceById(conferenceId)?.name ?? conferenceRaw,
      sport: conference.sport,
      season,
      division: div.division ?? null,
      division_provenance: div.provenance,
      member_count: (s.members ?? []).length,
      resolved_member_count: hits.length,
      groups: JSON.stringify(s.groups ?? []),
      source_url: s.url,
      source_platform: s.platform,
      season_confirmed: s.seasonConfirmed ? 1 : 0,
      sport_confirmed: s.sportConfirmed ? 1 : 0,
      status: COLLECTION_STATUS.OK,
      imported_at: now,
    });
  }
  // Everything attempted and not collected, kept as a status rather than a gap.
  for (const c of artefact.conferences) {
    for (const [seasonStr, s] of Object.entries(c.seasons ?? {})) {
      const season = Number(seasonStr);
      if (!SEASONS.includes(season) || s.status === 'OK') continue;
      conferenceRows.push({
        conference_id: c.conferenceId,
        conference_name: conferenceById(c.conferenceId)?.name ?? c.conferenceName,
        sport: c.sport, season,
        division: null, division_provenance: DIVISION_PROVENANCE.UNKNOWN,
        member_count: null, resolved_member_count: null, groups: null,
        source_url: s.url ?? null, source_platform: s.platform ?? null,
        season_confirmed: 0, sport_confirmed: 0,
        status: s.status, imported_at: now,
      });
    }
  }

  return { conferenceRows, programmeRows, quarantine, divisionOf, duplicateSources, conflicts };
}

export function run({ apply = false, dir = DIR, log = console.log } = {}) {
  const artefact = readArtefact(dir);
  const resolvers = buildResolvers();
  const collegeDivision = Object.fromEntries(db.prepare('SELECT id, division FROM colleges').all().map((c) => [c.id, c.division]));
  const overallRecords = Object.fromEntries(db.prepare('SELECT college_id, season, wins, losses, draws FROM programme_seasons').all()
    .map((r) => [`${r.college_id}|${r.season}`, { wins: r.wins, losses: r.losses, draws: r.draws }]));
  const programmeArtefact = readProgrammeArtefact(dir);
  const { conferenceRows, programmeRows, quarantine, duplicateSources, conflicts } = build({ artefact, programmeArtefact, resolvers, collegeDivision, overallRecords });

  const okConf = conferenceRows.filter((r) => r.status === COLLECTION_STATUS.OK);
  const withDivision = programmeRows.filter((r) => r.historical_division).length;
  log(`artefact collected at   : ${artefact.collectedAt}`);
  log(`conference-sport-seasons: ${conferenceRows.length}  collected ${okConf.length}`);
  log(`  division established  : ${okConf.filter((r) => r.division).length}`);
  log(`  division conflicting  : ${okConf.filter((r) => r.division_provenance === DIVISION_PROVENANCE.CONFLICTING).length}`);
  log(`programme-seasons       : ${programmeRows.length}  with a division ${withDivision}`);
  log(`duplicate source tables : ${duplicateSources.length}`);
  log(`programme-side seasons  : ${programmeArtefact.seasons.length} offered`);
  log(`  from the programme side only: ${programmeRows.filter((r) => r.membership_provenance === MEMBERSHIP_PROVENANCE.OFFICIAL_PROGRAMME_SOURCE).length}`);
  log(`  refused as CONFLICTING_OFFICIAL_SOURCES: ${conflicts.length}`);
  for (const c of conflicts.slice(0, 8)) log(`    ${c.collegeId} ${c.season}: ${c.reason}`);
  log(`quarantined member rows : ${quarantine.length}`);
  const byReason = {}; quarantine.forEach((q) => { byReason[q.reason] = (byReason[q.reason] ?? 0) + 1; });
  for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) log(`  ${k.padEnd(30)}${String(v).padStart(5)}`);

  if (!apply) { log('\ndry run — pass --apply to write'); return { conferenceRows, programmeRows, quarantine, written: 0 }; }
  const insert = (table, rows) => {
    if (!rows.length) return 0;
    const cols = Object.keys(rows[0]);
    const ins = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`);
    for (const r of rows) ins.run(r);
    return rows.length;
  };
  const write = db.transaction(() => {
    db.prepare('DELETE FROM conference_seasons').run();
    db.prepare('DELETE FROM programme_conference_seasons').run();
    db.prepare('DELETE FROM conference_membership_quarantine').run();
    insert('conference_seasons', conferenceRows);
    insert('programme_conference_seasons', programmeRows);
    // The quarantine key is (conference, sport, season, member) and a member can
    // be quarantined for two reasons at once; the first is kept.
    const seen = new Set();
    insert('conference_membership_quarantine', quarantine.filter((q) => {
      const k = `${q.conference_id}|${q.sport}|${q.season}|${q.member_raw}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    }));
  });
  write();
  log(`  written: ${db.prepare('SELECT COUNT(*) n FROM programme_conference_seasons').get().n} programme-seasons, `
    + `${db.prepare('SELECT COUNT(*) n FROM conference_seasons').get().n} conference-seasons, `
    + `${db.prepare('SELECT COUNT(*) n FROM conference_membership_quarantine').get().n} quarantined`);
  return { conferenceRows, programmeRows, quarantine, written: programmeRows.length };
}

if (import.meta.url === `file://${process.argv[1]}`) run({ apply: APPLY });
