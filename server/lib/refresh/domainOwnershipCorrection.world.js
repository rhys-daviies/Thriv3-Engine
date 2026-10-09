/**
 * Test world for domainOwnershipCorrection (DI-03B). Invented institutions in the DI-03 C1 shape;
 * the two UNITIDs of the one real held domain (stmarytx.edu: 123554 / 228149) are reused only because
 * a hold release must match the code-level hold record exactly. Every address uses a .test domain.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../../db/migrate.js';

const SCHEMA = fs.readFileSync(path.resolve(import.meta.dirname, '../../db/schema.sql'), 'utf8');
export const U = Object.freeze({ CA: 123554, TX: 228149, SC: 910003, WV: 910004, WI: 910005, CN: 910006, OTHER: 910099 });
export const E = Object.freeze({ CA: 'AE-U123554', TX: 'AE-U228149', SC: 'AE-T-SC', WV: 'AE-T-WV', WI: 'AE-T-WI', CN: 'AE-T-CN', OTHER: 'AE-T-OTHER' });
export const NAME = Object.freeze({ CA: 'Saint Example (CA)', TX: 'St. Example (TX)', SC: 'Example College (SC)', WV: 'Example University (WV)', WI: 'Concordia Example', CN: 'Twin College', OTHER: 'Other College' });
export const H = Object.freeze({ HELD: 'stmarytx.edu', RATTLER: 'rattler.test', UWV: 'uwv.test', CUW: 'cuw.test', TWIN: 'twin.test', SOLO: 'solo.test', CAATH: 'caathletics.test', SCATH: 'scathletics.test', WVATH: 'wvathletics.test' });

export function world() {
  const db = new Database(':memory:'); db.exec(SCHEMA); migrate(db);
  const ent = db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES (?,?,?,'SINGLE','t','t')");
  for (const k of Object.keys(U)) ent.run(E[k], NAME[k], U[k]);
  const col = db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES (?,'t','t',?,'mens-soccer',?,1,?,?)");
  for (const k of Object.keys(U)) col.run(`c-${k}`, NAME[k], k === 'TX' || k === 'WV' ? 'NCAA D2' : 'NCAA D1', U[k], E[k]);
  const base = { role: 'ATHLETICS_SITE', evidence_kind: 'OG_SITE_NAME', identity_method: 'VARIANT', identity_strength: 'WHOLE_NAME', platform: 'SIDEARM', http_status: 200, verification_method: 'PAGE_SELF_IDENTIFICATION', confidence: 'CERTAIN', notes: null, checked_at: '2026-09-01T09:28:40.920Z', athletics_entity_id: null, ownership_class: null, wrong_mappings: null, claimed_keys: '[]' };
  const dom = (r0) => { const r = { ...base, final_url: `https://${r0.domain}/`, evidence_text: 'page', ...r0 }; db.prepare(`INSERT INTO athletics_domains (${Object.keys(r).join(',')}) VALUES (${Object.keys(r).map((k) => `@${k}`).join(',')})`).run(r); };
  dom({ domain: H.HELD, role: 'INSTITUTION_SITE', status: 'VERIFIED_ALIAS', unitid: U.CA, claimed_unitids: JSON.stringify([U.CA, U.TX]), evidence_text: 'St. Example University' });
  dom({ domain: H.RATTLER, status: 'WRONG_INSTITUTION', unitid: U.CA, claimed_unitids: JSON.stringify([U.CA, U.TX]), wrong_mappings: JSON.stringify([{ key: NAME.TX, claimantUnitid: U.TX }]), evidence_text: 'St. Example University Athletics' });
  dom({ domain: H.UWV, role: 'INSTITUTION_SITE', status: 'VERIFIED_ALIAS', unitid: U.SC, claimed_unitids: JSON.stringify([U.SC, U.WV]), evidence_text: 'Example University' });
  dom({ domain: H.CUW, status: 'WRONG_INSTITUTION', unitid: U.WI, claimed_unitids: JSON.stringify([U.OTHER, U.WI]), wrong_mappings: JSON.stringify([{ key: NAME.OTHER, claimantUnitid: U.OTHER }]), evidence_text: 'Concordia Example' });
  dom({ domain: `www.${H.CUW}`, status: 'VERIFIED', unitid: U.WI, claimed_unitids: JSON.stringify([U.WI]), evidence_text: 'Concordia Example', identity_method: 'EXACT' });
  dom({ domain: H.TWIN, role: 'UNKNOWN', status: 'INSUFFICIENT_EVIDENCE', unitid: null, claimed_unitids: JSON.stringify([U.CN]), http_status: 202, confidence: 'NONE', evidence_kind: null, evidence_text: null, identity_method: null, identity_strength: null });
  dom({ domain: `www.${H.TWIN}`, status: 'VERIFIED', unitid: U.CN, claimed_unitids: JSON.stringify([U.CN]), evidence_text: 'Twin College', identity_method: 'EXACT' });
  dom({ domain: H.SOLO, role: 'INSTITUTION_SITE', status: 'INSUFFICIENT_EVIDENCE', unitid: null, claimed_unitids: JSON.stringify([U.CA]), confidence: 'NONE', evidence_kind: null, evidence_text: null, identity_method: null, identity_strength: null });
  for (const [h, k] of [[H.CAATH, 'CA'], [H.SCATH, 'SC'], [H.WVATH, 'WV']]) dom({ domain: h, status: 'VERIFIED', unitid: U[k], claimed_unitids: JSON.stringify([U[k]]), evidence_text: NAME[k], identity_method: 'EXACT' });
  const coach = db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, email_source_url, currentness_status, currentness_source_url, email_seen_on_source_at, email_seen_on_source_url) VALUES (?, 't', ?, ?, ?, ?, 'mens-soccer', ?, ?, ?, ?, ?, ?, ?)");
  const rat = `https://${H.RATTLER}/sports/mens-soccer/coaches`;
  // a St. Example (TX) assistant filed under Saint Example (CA): the DI-03 misfiling
  coach.run('k-tx-misfiled', 'Tex Misfiled', `tex@tx-example.test`, NAME.CA, 'NCAA D1', 'Assistant Coach', 'verified', rat, null, null, '2026-09-20T00:00:00Z', rat);
  // the TX head coach, correctly filed, ineligible today only because the TX hosts are mis-owned
  coach.run('k-tx-head', 'Tia Head', `tia@tx-example.test`, NAME.TX, 'NCAA D2', 'Head Coach', 'verified', rat, 'CURRENT', rat, '2026-09-20T00:00:00Z', rat);
  // a WV assistant with an inferred (unpublished) address filed under Example College (SC)
  coach.run('k-wv-misfiled', 'Will Guessed', `will@${H.UWV}`, NAME.SC, 'NCAA D1', 'Assistant Coach', 'inferred', null, null, null, null, null);
  // controls
  coach.run('k-ca', 'Cal Control', `cal@${H.CAATH}`, NAME.CA, 'NCAA D1', 'Head Coach', 'verified', `https://${H.CAATH}/sports/mens-soccer/coaches`, 'CURRENT', `https://${H.CAATH}/sports/mens-soccer/coaches`, '2026-09-20T00:00:00Z', `https://${H.CAATH}/sports/mens-soccer/coaches`);
  coach.run('k-sc', 'Sam Control', `sam@${H.SCATH}`, NAME.SC, 'NCAA D1', 'Head Coach', 'verified', `https://${H.SCATH}/sports/mens-soccer/coaches`, 'CURRENT', `https://${H.SCATH}/sports/mens-soccer/coaches`, '2026-09-20T00:00:00Z', `https://${H.SCATH}/sports/mens-soccer/coaches`);
  const cs = db.prepare("INSERT INTO coach_seasons (school, sport, season, coach_name, source_url, imported_at) VALUES (?, 'mens-soccer', 2025, ?, ?, 't')");
  cs.run(NAME.TX, 'Tia Head', rat); cs.run(NAME.CA, 'Cal Control', `https://${H.CAATH}/sports/mens-soccer/coaches`); cs.run(NAME.SC, 'Sam Control', `https://${H.SCATH}/sports/mens-soccer/coaches`);
  db.pragma('foreign_keys = OFF');
  db.prepare("INSERT INTO outreach (id, athlete_id, coach_id, token, created_at) VALUES ('o-1','p-1','k-sc','tok-1','2026-08-27')").run();
  db.pragma('foreign_keys = ON');
  return db;
}
