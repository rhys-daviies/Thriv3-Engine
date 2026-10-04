/**
 * REGRESSION WORLD — Phase 7E permanent regression fixtures.
 *
 * A synthetic database (real schema.sql + migrate) that contains, in miniature, every
 * identity defect Phases 1-7 found in the real corpus, so that future code cannot reproduce
 * them without a test failing. RFC 2606 `.example` hosts, synthetic UNITIDs (9xxxxx), synthetic
 * people — no real person, address or institution record.
 *
 *   Concordia Texas vs Texas            same token, different institutions (+ Concordia NE)
 *   Saint Mary's CA / MN / TX           three institutions, one bare name
 *   Trinity TX vs Trinity Christian     bare "Trinity"
 *   USF Indiana vs Illinois             near-identical names, different states
 *   Columbia MO vs SC vs Columbia       "Columbia College" twice, plus Columbia University
 *   Johnson vs Johnson & Wales          one name is a prefix of the other
 *   IU Columbus vs IU Indianapolis      NAIA branch reported under an NCAA D1 parent's UNITID
 *   Benedictine Mesa vs Lisle           NAIA branch of an NCAA D3 parent (cross-division)
 *   Park Gilbert vs Park                campus athletics host is a SUBDOMAIN of the parent's
 *   Shawnee transition                  NAIA -> NCAA D2 provisional
 *   shared PrestoSports                 a platform root identifies nobody
 *   Stanton                             no UNITID at all (non-Title-IV)
 * plus coaches (current, stale, departing) and two seasons of roster for the refresh cases.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrate } from '../../db/migrate.js';
import { seasonFingerprint } from './temporal.js';
import { normaliseInstitution } from '../../../shared/institutionIdentity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.resolve(__dirname, '../../db/schema.sql'), 'utf8');
const T = '2026-09-29T00:00:00.000Z';

export const W = Object.freeze({
  CTX: 'c-ctx', TEXAS: 'c-texas', CUNE: 'c-cune', SMC: 'c-smc', SMUMN: 'c-smumn', STMTX: 'c-stmtx', TRIN: 'c-trin', TRINC: 'c-trinc',
  USFIN: 'c-usfin', USFIL: 'c-usfil', COLMO: 'c-colmo', COLSC: 'c-colsc', COLU: 'c-colu', JOHN: 'c-john', JWU: 'c-jwu',
  IUINDY: 'c-iuindy', IUC: 'c-iuc', BEN: 'c-ben', MESA: 'c-mesa', PARK: 'c-park', GILBERT: 'c-gilbert', SSU: 'c-ssu', STANTON: 'c-stanton', PRESTO: 'c-presto',
  CTX_W: 'c-ctx-w',
});

// [id, name, sport, division, conference, unitid, entity, kind, parent, host, hostRole]
const PROGRAMMES = [
  [W.CTX, 'Concordia University Texas', 'mens-soccer', 'NAIA', 'Red River', 900101, 'AE-U900101', 'SINGLE', null, 'concordiatx.example'],
  [W.CTX_W, 'Concordia University Texas', 'womens-soccer', 'NAIA', 'Red River', 900101, 'AE-U900101', 'SINGLE', null, null],
  [W.TEXAS, 'Texas', 'mens-soccer', 'NCAA D1', 'SEC', 900102, 'AE-U900102', 'SINGLE', null, 'texassports.example'],
  [W.CUNE, 'Concordia (NE)', 'mens-soccer', 'NAIA', 'GPAC', 900103, 'AE-U900103', 'SINGLE', null, 'cune.example'],
  [W.SMC, "Saint Mary's (CA)", 'mens-soccer', 'NCAA D1', 'WCC', 900201, 'AE-U900201', 'SINGLE', null, 'smcgaels.example'],
  [W.SMUMN, "Saint Mary's (MN)", 'mens-soccer', 'NCAA D3', 'MIAC', 900202, 'AE-U900202', 'SINGLE', null, 'smumn.example'],
  [W.STMTX, "St. Mary's (TX)", 'mens-soccer', 'NCAA D2', 'LSC', 900203, 'AE-U900203', 'SINGLE', null, 'rattlers.example'],
  [W.TRIN, 'Trinity (TX)', 'mens-soccer', 'NCAA D3', 'SAA', 900301, 'AE-U900301', 'SINGLE', null, 'trinitytigers.example'],
  [W.TRINC, 'Trinity Christian', 'mens-soccer', 'NAIA', 'CCAC', 900302, 'AE-U900302', 'SINGLE', null, 'trinitytrolls.example'],
  [W.USFIN, 'University of Saint Francis (IN)', 'mens-soccer', 'NAIA', 'CCAC', 900401, 'AE-U900401', 'SINGLE', null, 'usfcougars.example'],
  [W.USFIL, 'University of St. Francis (IL)', 'mens-soccer', 'NAIA', 'CCAC', 900402, 'AE-U900402', 'SINGLE', null, 'fightingsaints.example'],
  [W.COLMO, 'Columbia College (MO)', 'mens-soccer', 'NAIA', 'AMC', 900501, 'AE-U900501', 'SINGLE', null, 'cougars-mo.example'],
  [W.COLSC, 'Columbia College (SC)', 'mens-soccer', 'NAIA', 'AAC', 900502, 'AE-U900502', 'SINGLE', null, 'koalas.example'],
  [W.COLU, 'Columbia', 'mens-soccer', 'NCAA D1', 'Ivy', 900503, 'AE-U900503', 'SINGLE', null, 'gocolumbia.example'],
  [W.JOHN, 'Johnson University', 'mens-soccer', 'NAIA', 'AAC', 900601, 'AE-U900601', 'SINGLE', null, 'johnsonroyals.example'],
  [W.JWU, 'Johnson & Wales (RI)', 'mens-soccer', 'NCAA D3', 'GNAC', 900602, 'AE-U900602', 'SINGLE', null, 'jwuwildcats.example'],
  [W.IUINDY, 'IU Indy', 'mens-soccer', 'NCAA D1', 'Horizon', 900701, 'AE-U900701', 'SINGLE', null, 'iuindyjags.example'],
  [W.IUC, 'Indiana University Columbus', 'mens-soccer', 'NAIA', 'River States', 900701, 'AE-X-IU-COLUMBUS', 'BRANCH_CAMPUS', 900701, 'crimsonpride.example'],
  [W.BEN, 'Benedictine (IL)', 'mens-soccer', 'NCAA D3', 'NACC', 900801, 'AE-U900801', 'SINGLE', null, 'benedictineeagles.example'],
  [W.MESA, 'Benedictine Mesa', 'mens-soccer', 'NAIA', 'GSAC', null, 'AE-X-BEN-MESA', 'BRANCH_CAMPUS', 900801, 'redhawks.example'],
  [W.PARK, 'Park University', 'mens-soccer', 'NAIA', 'Heart', 900901, 'AE-U900901', 'SINGLE', null, 'parkathl.example'],
  [W.GILBERT, 'Park University Gilbert', 'mens-soccer', 'NAIA', 'GSAC', null, 'AE-X-PARK-GILBERT', 'BRANCH_CAMPUS', 900901, 'gilbert.parkathl.example'],
  [W.SSU, 'Shawnee State', 'mens-soccer', 'NAIA', 'River States Conference', 901001, 'AE-U901001', 'SINGLE', null, 'ssubears.example'],
  [W.STANTON, 'Stanton University', 'mens-soccer', 'NAIA', 'Cal Pac', null, 'AE-X-STANTON', 'NON_TITLE_IV', null, 'stantonelks.example'],
  [W.PRESTO, 'Presto College', 'mens-soccer', 'NAIA', 'Mid-South', 901101, 'AE-U901101', 'SINGLE', null, null],
];

export const PEOPLE = Object.freeze({
  HEAD: { id: 'k-head', full_name: 'Pat Headcoach', email: 'pat.headcoach@concordiatx.example', role: 'Head Coach' },
  ASSIST: { id: 'k-assist', full_name: 'Sam Assistant', email: 'sam.assistant@concordiatx.example', role: 'Assistant Coach' },
  OLDASSIST: { id: 'k-oldassist', full_name: 'Lee Leaving', email: 'lee.leaving@concordiatx.example', role: 'Assistant Coach' },
  PARKC: { id: 'k-park', full_name: 'Riley Parker', email: 'riley.parker@parkathl.example', role: 'Head Coach' },
  STALE: { id: 'k-stale', full_name: 'Morgan Stale', email: 'morgan.stale@trinitytrolls.example', role: 'Head Coach' },
  SSUHEAD: { id: 'k-ssu', full_name: 'Stan Bearcoach', email: 'stan.bearcoach@ssubears.example', role: 'Head Coach' },
});

/** Build the world into `dbPath` (a file). Returns the ids table. */
export function buildRegressionWorld(dbPath, { freeze = [2025] } = {}) {
  const db = new Database(dbPath);
  db.exec(SCHEMA); migrate(db);
  const insC = db.prepare('INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, unitid, active, athletics_entity_id) VALUES (?,?,?,?,?,?,?,?,1,?)');
  const insE = db.prepare('INSERT OR IGNORE INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, parent_unitid, campus_label, entity_kind, provenance, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const insD = db.prepare(`INSERT OR IGNORE INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, evidence_text, verification_method, confidence, checked_at, athletics_entity_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insA = db.prepare("INSERT OR IGNORE INTO institution_aliases (alias_key, alias_raw, unitid, conference_scope, alias_type, source, confidence, imported_at) VALUES (?,?,?,'*','CURRENT_NAME','colleges.name','CERTAIN',?)");
  const insP = db.prepare("INSERT INTO programme_membership_periods (athletics_entity_id, sport, first_season, last_season, governing_body, division, membership_status, conference, college_id, source_tier, provenance, recorded_at) VALUES (?,?,2026,NULL,?,?, 'ACTIVE', ?, ?, 'SEED', 'regression world seed', ?)");
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  db.transaction(() => {
    for (const [id, name, sport, division, conf, unitid, ent, kind, parent, host] of PROGRAMMES) {
      insC.run(id, T, T, name, sport, division, conf, unitid, ent);
      const campus = ['BRANCH_CAMPUS', 'SYSTEM_CAMPUS'].includes(kind);
      insE.run(ent, name, campus || kind === 'NON_TITLE_IV' ? null : unitid, parent, campus ? name : null, kind, 'regression world', null, T);
      // a campus/branch/non-Title-IV host is owned at HOST level; a single institution's by UNITID
      if (host) insD.run(host, campus || kind === 'NON_TITLE_IV' ? null : unitid, 'VERIFIED', 'ATHLETICS_SITE', JSON.stringify([name]), JSON.stringify(unitid ? [unitid] : []), `${name} Athletics`, 'REGRESSION_WORLD', 'CERTAIN', T, campus || kind === 'NON_TITLE_IV' ? ent : null);
      if (unitid) insA.run(normaliseInstitution(name), name, unitid, T);
      insP.run(ent, sport, /^NCAA/.test(division) ? 'NCAA' : division, division, conf, id, T);
    }
    // shared institutional domains: parent-only evidence
    insD.run('iu.example', 900701, 'VERIFIED', 'INSTITUTION_SITE', '["IU Indy"]', '[900701]', 'Indiana University', 'REGRESSION_WORLD', 'CERTAIN', T, null);
    insD.run('ben.example', 900801, 'VERIFIED', 'INSTITUTION_SITE', '["Benedictine (IL)"]', '[900801]', 'Benedictine University', 'REGRESSION_WORLD', 'CERTAIN', T, null);
    insD.run('concordiatx.edu.example', 900101, 'VERIFIED', 'INSTITUTION_SITE', '["Concordia University Texas"]', '[900101]', 'Concordia University Texas', 'REGRESSION_WORLD', 'CERTAIN', T, null);
    // a wrong alias the registry once held (the Columbia College -> Columbia University defect)
    insD.run('columbiacougars.example', 900503, 'WRONG_INSTITUTION', 'ATHLETICS_SITE', '["Columbia"]', '[900503]', 'Columbia College Cougars', 'REGRESSION_WORLD', 'CERTAIN', T, null);
    // conference host (tier-B authority) for the Shawnee transition
    db.prepare("INSERT INTO conference_seasons (conference_id, conference_name, sport, season, division, division_provenance, member_count, resolved_member_count, groups, source_url, source_platform, season_confirmed, sport_confirmed, status, imported_at) VALUES ('mec','Mountain East Conference','mens-soccer',2025,'NCAA D2','EXPLICIT_OFFICIAL',12,12,NULL,'https://mountaineast.example/standings','SIDEARM',1,1,'OK',?)").run(T);
    // Shawnee history: two NAIA conference seasons (must survive a transition untouched)
    const pcs = db.prepare("INSERT INTO programme_conference_seasons (college_id, sport, season, unitid, conference_id, conference_raw, historical_division, division_provenance, member_raw, identity_method, identity_evidence, source_url, source_platform, provenance, confidence, season_confirmed, imported_at, membership_provenance, record_status) VALUES (?, 'mens-soccer', ?, 901001, 'rsc', 'River States Conference', 'NAIA', 'DERIVED_FROM_OFFICIAL_MEMBERSHIP', 'Shawnee State', 'EXACT', 'test', 'https://rsc.example/standings', 'SIDEARM', 'test', 'HIGH', 1, ?, 'OFFICIAL_CONFERENCE_STANDINGS', 'RECORD_UNAVAILABLE')");
    pcs.run(W.SSU, 2024, T); pcs.run(W.SSU, 2025, T);
    // coaches
    const insK = db.prepare('INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, email_source_url, source, currentness_status, currentness_checked_at, currentness_source_url, email_seen_on_source_at, email_seen_on_source_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const staff = 'https://concordiatx.example/sports/mens-soccer/coaches';
    for (const p of [PEOPLE.HEAD, PEOPLE.ASSIST, PEOPLE.OLDASSIST]) insK.run(p.id, T, p.full_name, p.email, 'Concordia University Texas', 'NAIA', 'mens-soccer', p.role, 'verified', staff, 'world', 'CURRENT', '2025-09-01T00:00:00.000Z', staff, '2025-09-01T00:00:00.000Z', staff);
    insK.run(PEOPLE.PARKC.id, T, PEOPLE.PARKC.full_name, PEOPLE.PARKC.email, 'Park University', 'NAIA', 'mens-soccer', 'Head Coach', 'verified', 'https://parkathl.example/sports/mens-soccer/coaches', 'world', 'CURRENT', T, 'https://parkathl.example/sports/mens-soccer/coaches', T, 'https://parkathl.example/sports/mens-soccer/coaches');
    insK.run(PEOPLE.STALE.id, T, PEOPLE.STALE.full_name, PEOPLE.STALE.email, 'Trinity Christian', 'NAIA', 'mens-soccer', 'Head Coach', 'verified', 'https://trinitytrolls.example/sports/mens-soccer/coaches', 'world', 'PROVEN_STALE', T, 'https://trinitytrolls.example/sports/mens-soccer/coaches', null, null);
    insK.run(PEOPLE.SSUHEAD.id, T, PEOPLE.SSUHEAD.full_name, PEOPLE.SSUHEAD.email, 'Shawnee State', 'NAIA', 'mens-soccer', 'Head Coach', 'verified', 'https://ssubears.example/sports/mens-soccer/coaches', 'world', 'CURRENT', T, 'https://ssubears.example/sports/mens-soccer/coaches', T, 'https://ssubears.example/sports/mens-soccer/coaches');
    // rosters: Concordia TX 2025 (frozen) + 2026; a USF (IN) 2025 player who transfers
    const insR = db.prepare("INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division, season, conference, player_name, class_year_label, position, nationality, source_roster_url, data_confidence) VALUES (?,?,?,?, 'mens-soccer', 'NAIA', ?, 'Red River', ?, ?, ?, ?, ?, 'High')");
    const r25 = 'https://concordiatx.example/sports/mens-soccer/roster/2025'; const r26 = 'https://concordiatx.example/sports/mens-soccer/roster/2026';
    insR.run('r-a25', T, T, 'Concordia University Texas', '2025', 'Alex Keeper', 'Fr.', 'GK', 'USA', r25);
    insR.run('r-b25', T, T, 'Concordia University Texas', '2025', 'Blake Mid', 'So.', 'MF', null, r25);
    insR.run('r-c25', T, T, 'Concordia University Texas', '2025', 'Casey Senior', 'Sr.', 'DF', 'ENG', r25);
    insR.run('r-a26', T, T, 'Concordia University Texas', '2026', 'Alex Keeper', 'So.', 'GK', 'USA', r26);
    insR.run('r-b26', T, T, 'Concordia University Texas', '2026', 'Blake Mid', 'Jr.', 'MF', null, r26);
    insR.run('r-t25', T, T, 'University of Saint Francis (IN)', '2025', 'Drew Transfer', 'Fr.', 'FW', 'USA', 'https://usfcougars.example/sports/mens-soccer/roster/2025');
  })();
  for (const s of freeze) db.prepare('INSERT INTO season_freezes (season, scope, frozen_at, fingerprint_json, provenance) VALUES (?,?,?,?,?)').run(s, '*', T, JSON.stringify(seasonFingerprint(db, s)), 'regression world');
  db.close();
  return W;
}

/** Page helpers for tests and the historical simulation. */
export const staffPage = (over = {}) => ({ dataset: 'COACH', source_kind: 'OFFICIAL_STAFF_DIRECTORY', source_url: 'https://concordiatx.example/sports/mens-soccer/coaches', fetched_at: '2027-08-20T00:00:00.000Z', observed_season: 2027, parser_version: 'test-1', institution_label: 'Concordia University Texas', sport: 'mens-soccer', source_complete: true, people: [], ...over });
export const rosterPage = (over = {}) => ({ dataset: 'ROSTER', source_kind: 'OFFICIAL_ROSTER', source_url: 'https://concordiatx.example/sports/mens-soccer/roster/2027', fetched_at: '2027-08-25T00:00:00.000Z', page_season: 2027, observed_season: 2027, parser_version: 'test-1', institution_label: 'Concordia University Texas', sport: 'mens-soccer', source_complete: true, players: [], ...over });
export const published = (p, email = p.email) => ({ full_name: p.full_name, role: p.role, email, email_origin: 'PUBLISHED_ON_SOURCE' });
