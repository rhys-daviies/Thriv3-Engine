/**
 * The database half of structural history.
 *
 * `competitiveQueries` reads a programme's record and joins the division it was
 * played in; this reads the rest of what conference-side collection established
 * — which conference, its size, and the programme's record inside it — and
 * assembles the sequence across the window.
 *
 * A SEASON WHOSE SOURCE DID NOT NAME ITS OWN SEASON IS NOT READ. Every row
 * carries `season_confirmed`, set when the fetched standings page's own title
 * named the season we asked for. A standings URL that quietly serves the
 * current table is the one failure in this design that produces a confident
 * wrong answer instead of a gap — `themw.com` does exactly that — so an
 * unconfirmed row is stored as evidence and refused as a fact.
 *
 * IT READS NO CURRENT DIVISION AND NO CONFERENCE STRING FROM `colleges`. Both
 * are snapshots. `colleges.conference` is worse than a snapshot for men: seven
 * programmes that moved to Division II still carry the NAIA conference they
 * left, and Akron men's row says Big East for a programme that played the
 * Mid-American in 2022.
 */
import db from '../db/client.js';
import { structuralHistory, conferenceRecordRow } from '../../shared/conferenceHistory.js';
import { conferenceById } from '../../shared/conferenceIdentity.js';
import { competitivePackage } from '../../shared/report/competitivePackage.js';
import { competitiveHistoryFor } from './competitiveQueries.js';

const selectRows = db.prepare(
  `SELECT season, conference_id, conference_raw, historical_division, division_provenance,
          conference_wins, conference_draws, conference_losses, conference_matches,
          conference_size, conference_table_row, conference_group, seed, champion_marker,
          member_raw, identity_method, identity_evidence, membership_provenance, record_status,
          source_url, source_platform, provenance, confidence, season_confirmed
     FROM programme_conference_seasons
    WHERE college_id = ? AND season_confirmed = 1
    ORDER BY season`,
);

const nameOf = (id) => conferenceById(id)?.name ?? id;

/**
 * One programme's structural history.
 *
 * Returns `null` for a programme with nothing collected — an absence, not an
 * empty history, and the caller has to be able to tell those apart.
 */
export function structuralHistoryFor(collegeId) {
  const rows = selectRows.all(collegeId);
  if (!rows.length) return null;
  const shaped = rows.map((r) => ({
    season: r.season,
    conferenceId: r.conference_id,
    conferenceName: nameOf(r.conference_id),
    conferenceRaw: r.conference_raw,
    historicalDivision: r.historical_division,
    divisionProvenance: r.division_provenance,
    conferenceSize: r.conference_size,
    // As PRINTED. The PSAC lists East then West, so Mercyhurst — first in the
    // West — is eighth by row. This is not a finish and is not published as one.
    conferenceTableRow: r.conference_table_row,
    conferenceGroup: r.conference_group,
    seed: r.seed,
    championMarker: !!r.champion_marker,
    membershipProvenance: r.membership_provenance,
    recordStatus: r.record_status,
    source: { url: r.source_url, platform: r.source_platform, provenance: r.provenance, confidence: r.confidence },
  }));
  const conferenceRecords = rows.map((r) => conferenceRecordRow({
    season: r.season,
    record: r.conference_wins == null ? null : `${r.conference_wins}-${r.conference_losses}-${r.conference_draws}`,
    matchesPlayed: r.conference_matches,
    conferenceName: nameOf(r.conference_id),
    conferenceSize: r.conference_size,
  }));
  return { ...structuralHistory(shaped), rows: shaped, conferenceRecords };
}

/** How much of the window this layer covers, for a whole sport and division. */
export function structuralCoverage() {
  return db.prepare(
    `SELECT c.sport, c.division,
            COUNT(*) programmes,
            SUM(CASE WHEN k.conf = 4 THEN 1 ELSE 0 END) conference4,
            SUM(CASE WHEN k.conf >= 1 THEN 1 ELSE 0 END) conferenceAny,
            SUM(CASE WHEN k.div = 4 THEN 1 ELSE 0 END) division4,
            SUM(CASE WHEN k.div >= 1 THEN 1 ELSE 0 END) divisionAny
       FROM colleges c
       LEFT JOIN (
         SELECT college_id, COUNT(*) conf,
                SUM(CASE WHEN historical_division IS NOT NULL THEN 1 ELSE 0 END) div
           FROM programme_conference_seasons WHERE season_confirmed = 1 GROUP BY college_id
       ) k ON k.college_id = c.id
      WHERE c.division IN ('NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA')
      GROUP BY 1, 2 ORDER BY 1, 2`).all();
}

/** Every conference change and division change collection can see. */
export function structuralMovements() {
  const rows = db.prepare(
    `SELECT x.college_id, c.name, c.sport, c.division current_division,
            x.season, x.conference_id, x.historical_division
       FROM programme_conference_seasons x
       JOIN colleges c ON c.id = x.college_id
      WHERE x.season_confirmed = 1
      ORDER BY x.college_id, x.season`).all();
  const byProgramme = new Map();
  for (const r of rows) {
    if (!byProgramme.has(r.college_id)) byProgramme.set(r.college_id, []);
    byProgramme.get(r.college_id).push(r);
  }
  const out = [];
  for (const [collegeId, list] of byProgramme) {
    const h = structuralHistory(list.map((r) => ({
      season: r.season, conferenceId: r.conference_id,
      conferenceName: nameOf(r.conference_id), historicalDivision: r.historical_division,
    })));
    if (!h.changes.length) continue;
    out.push({
      collegeId, name: list[0].name, sport: list[0].sport,
      currentDivision: list[0].current_division,
      seasons: h.seasons, changes: h.changes,
    });
  }
  return out;
}

/**
 * THE PHASE 12F DATA PACKAGE for one programme, and the only thing 12F consumes.
 *
 * It is assembled here because this is where both halves live: the record and
 * its benchmark from `competitiveQueries`, the conference and division from this
 * module. Nothing about presentation is decided — the package carries the field
 * contract with it, so a page can be checked against what it is allowed to draw
 * rather than against what happens to be in the object.
 */
export function competitivePackageFor(collegeId, { coachAttribution = null } = {}) {
  const history = competitiveHistoryFor(collegeId, { coachAttribution });
  if (!history) return null;
  const structural = structuralHistoryFor(collegeId);
  return {
    college: history.college,
    ...competitivePackage({ history, structural, coach: coachAttribution }),
  };
}

/** Coverage of membership and of the conference record, kept apart (12E / T). */
export function conferenceRecordCoverage() {
  return db.prepare(
    `SELECT c.sport, c.division,
            COUNT(*) readable_seasons,
            SUM(CASE WHEN x.college_id IS NOT NULL AND x.season_confirmed = 1 THEN 1 ELSE 0 END) membership_known,
            SUM(CASE WHEN x.season_confirmed = 1 AND x.record_status = 'RECORD_KNOWN' THEN 1 ELSE 0 END) record_known,
            SUM(CASE WHEN x.season_confirmed = 1 AND x.record_status = 'RECORD_UNAVAILABLE' THEN 1 ELSE 0 END) record_unavailable
       FROM programme_seasons p
       JOIN colleges c ON c.id = p.college_id
       LEFT JOIN programme_conference_seasons x
         ON x.college_id = p.college_id AND x.season = p.season
      WHERE c.division IN ('NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA')
      GROUP BY 1, 2 ORDER BY 1, 2`).all();
}

/** Which official source established each membership row (12E / G). */
export function membershipProvenanceCounts() {
  return db.prepare(
    `SELECT membership_provenance, record_status, COUNT(*) n
       FROM programme_conference_seasons WHERE season_confirmed = 1
      GROUP BY 1, 2 ORDER BY 3 DESC`).all();
}
