import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  decideLink, isFactual, linkNameKey, compareHometown, classStep, LINK_DECISION, RELATION, EXPLICIT, HOMETOWN, CLASS_STEP, EVIDENCE_CLASS,
} from '../../../shared/players/identity.js';
import { extractRosterSchoolFields, buildInstitutionIndex, resolvePriorSchools, readExplicitPrior, FIELD_TYPE, RESOLUTION } from './priorSchoolEvidence.js';
import { buildSeasonLinks, collectPageEvidence } from './linkBuilder.js';
import { playerHistoryChecks } from './historyMonitor.js';
import { assertFactualPriors } from '../../scripts/projectRosterMinutes.js';
import { arrivedFromElsewhere, namedArrivals } from '../../../shared/philosophy.js';

/**
 * PHASE 8B.1A — player-history identity. A NAME MATCH IS A CANDIDATE, NOT A PERSON.
 * Synthetic names only (privacy): nothing here is a real player.
 */
const D = LINK_DECISION;
const cross = (over = {}) => ({ relation: RELATION.CROSS_PROGRAMME_PRIOR, explicit: EXPLICIT.NONE, hometown: HOMETOWN.UNKNOWN, classStep: CLASS_STEP.UNKNOWN, position: 'UNKNOWN', height: 'UNKNOWN', priorCandidates: 1, priorContinues: false, commonName: false, ...over });

describe('identity rules (shared/players/identity.js)', () => {
  it('a name match alone is a CANDIDATE and never factual', () => {
    const d = decideLink(cross());
    expect(d.decision).toBe(D.CANDIDATE); expect(isFactual(d.decision)).toBe(false); expect(d.evidence_class).toBe(EVIDENCE_CLASS.NAME_ONLY);
  });
  it('name + same position alone is not enough (common or not)', () => {
    expect(decideLink(cross({ position: 'SAME' })).decision).toBe(D.CANDIDATE);
    expect(decideLink(cross({ position: 'SAME', commonName: true })).decision).toBe(D.CANDIDATE);
  });
  it('a structured previous school naming the prior programme verifies', () => {
    const d = decideLink(cross({ explicit: EXPLICIT.AGREES }));
    expect(d.decision).toBe(D.VERIFIED_SAME_PERSON); expect(d.evidence_class).toBe(EVIDENCE_CLASS.EXPLICIT_PRIOR_SCHOOL);
  });
  it('explicit agreement is not downgraded by hometown alone, but is by a class reset', () => {
    expect(decideLink(cross({ explicit: EXPLICIT.AGREES, hometown: HOMETOWN.DIFFERENT_REGION })).decision).toBe(D.VERIFIED_SAME_PERSON);
    expect(decideLink(cross({ explicit: EXPLICIT.AGREES, classStep: CLASS_STEP.RESET_TO_FRESHMAN })).decision).toBe(D.PROBABLE_SAME_PERSON);
  });
  it('hometown + class progression + uncommon name verifies (MULTI_SIGNAL); common names do not', () => {
    expect(decideLink(cross({ hometown: HOMETOWN.MATCH, classStep: CLASS_STEP.PROGRESSES })).evidence_class).toBe(EVIDENCE_CLASS.MULTI_SIGNAL);
    expect(decideLink(cross({ hometown: HOMETOWN.MATCH, classStep: CLASS_STEP.REPEATS })).decision).toBe(D.VERIFIED_SAME_PERSON);
    expect(decideLink(cross({ hometown: HOMETOWN.MATCH, classStep: CLASS_STEP.PROGRESSES, commonName: true })).decision).toBe(D.PROBABLE_SAME_PERSON);
  });
  it('hometown alone is never authoritative', () => {
    expect(decideLink(cross({ hometown: HOMETOWN.MATCH })).decision).toBe(D.PROBABLE_SAME_PERSON);
    expect(isFactual(decideLink(cross({ hometown: HOMETOWN.MATCH, classStep: CLASS_STEP.SKIPS })).decision)).toBe(false);
  });
  it('same name, different hometown state/country: CONTRADICTED, not linked', () => {
    expect(decideLink(cross({ hometown: HOMETOWN.DIFFERENT_REGION, classStep: CLASS_STEP.PROGRESSES })).decision).toBe(D.CONTRADICTED);
  });
  it('same name at two programmes in the prior season: AMBIGUOUS', () => {
    expect(decideLink(cross({ priorCandidates: 2, hometown: HOMETOWN.MATCH, classStep: CLASS_STEP.PROGRESSES })).decision).toBe(D.AMBIGUOUS);
  });
  it('simultaneous rostering: the prior player is still at the prior programme -> DIFFERENT_PERSON when that continuation matches', () => {
    expect(decideLink(cross({ priorContinues: true, continuationHometown: HOMETOWN.MATCH, hometown: HOMETOWN.MATCH, classStep: CLASS_STEP.PROGRESSES })).decision).toBe(D.DIFFERENT_PERSON);
    expect(decideLink(cross({ priorContinues: true, continuationHometown: HOMETOWN.UNKNOWN })).decision).toBe(D.CONTRADICTED);
  });
  it('an explicit OTHER college is a conflict to review, never proof by itself', () => {
    const d = decideLink(cross({ explicit: EXPLICIT.NAMES_OTHER_COLLEGE, hometown: HOMETOWN.MATCH, classStep: CLASS_STEP.PROGRESSES }));
    expect(d.decision).toBe(D.CONTRADICTED); expect(isFactual(d.decision)).toBe(false);
  });
  it('temporal heuristics reduce confidence rather than prove: backwards class / reset contradict; redshirt repeat is fine', () => {
    expect(decideLink(cross({ hometown: HOMETOWN.MATCH, classStep: CLASS_STEP.BACKWARDS })).decision).toBe(D.CONTRADICTED);
    expect(classStep('R-So.', 'R-Jr.')).toBe(CLASS_STEP.PROGRESSES);
    expect(classStep('So.', 'R-So.')).toBe(CLASS_STEP.REPEATS);
    expect(classStep('Jr.', 'Fr.')).toBe(CLASS_STEP.RESET_TO_FRESHMAN);
    expect(classStep('Fr.', 'R-Fr.')).toBe(CLASS_STEP.REPEATS);
  });
  it('returning player, same programme next season: VERIFIED continuation; a true-freshman reset is a second person', () => {
    expect(decideLink({ relation: RELATION.SAME_PROGRAMME_CONTINUATION, hometown: HOMETOWN.MATCH, classStep: CLASS_STEP.PROGRESSES }).evidence_class).toBe(EVIDENCE_CLASS.PROGRAMME_SCOPED);
    expect(decideLink({ relation: RELATION.SAME_PROGRAMME_CONTINUATION, hometown: HOMETOWN.DIFFERENT_REGION, classStep: CLASS_STEP.RESET_TO_FRESHMAN }).decision).toBe(D.CONTRADICTED);
  });
  it('an approved review outranks recomputation', () => {
    expect(decideLink({ ...cross(), reviewed: { decision: D.VERIFIED_SAME_PERSON } }).evidence_class).toBe(EVIDENCE_CLASS.REVIEWED);
  });
});

describe('name normalisation — what may and may not join (missing a link is acceptable; a false link is not)', () => {
  it('accents and punctuation fold; hyphenated surnames join their unhyphenated form', () => {
    expect(linkNameKey('José Núñez')).toBe(linkNameKey('Jose Nunez'));
    expect(linkNameKey("Aidan O'Quill")).toBe(linkNameKey('Aidan OQuill'));
    expect(linkNameKey('Kerr-Vale Testman')).toBe(linkNameKey('Kerr Vale Testman'));
  });
  it('suffixes, first/last reversal, shortened first names and middle initials do NOT auto-join', () => {
    expect(linkNameKey('Quill Testwood Jr.')).not.toBe(linkNameKey('Quill Testwood'));
    expect(linkNameKey('Quill Testwood III')).not.toBe(linkNameKey('Quill Testwood'));
    expect(linkNameKey('Testwood, Quill')).not.toBe(linkNameKey('Quill Testwood'));
    expect(linkNameKey('Mick Testwood')).not.toBe(linkNameKey('Michael Testwood'));
    expect(linkNameKey('Quill A. Testwood')).not.toBe(linkNameKey('Quill Testwood'));
  });
  it('hometown spellings agree by explicit tables only; international formats are handled', () => {
    expect(compareHometown('Phoenix, AZ', 'Phoenix, Ariz.')).toBe(HOMETOWN.MATCH);
    expect(compareHometown('Toronto, Ontario', 'Toronto, Canada')).toBe(HOMETOWN.FORMAT_VARIANT);
    expect(compareHometown('London, England', 'London, United Kingdom')).toBe(HOMETOWN.FORMAT_VARIANT);
    expect(compareHometown('Springfield, IL', 'Springfield, MO')).toBe(HOMETOWN.DIFFERENT_REGION);
    expect(compareHometown('Germany', 'Augsburg, Germany')).toBe(HOMETOWN.PARTIAL);
    expect(compareHometown('Uganda', 'Gulu, Uganda')).toBe(HOMETOWN.UNKNOWN); // a bare name outside the explicit tables is never guessed
    expect(compareHometown('Plano, Texas', 'Dallas, Texas')).toBe(HOMETOWN.SAME_REGION_OTHER_CITY);
  });
});

// ------------------------------------------------------------------ explicit prior-school evidence
function world() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE colleges (id TEXT, name TEXT, sport TEXT, unitid INTEGER, athletics_entity_id TEXT);
    CREATE TABLE athletics_entities (athletics_entity_id TEXT, display_name TEXT, federal_unitid INTEGER, parent_unitid INTEGER);`);
  const c = db.prepare('INSERT INTO colleges VALUES (?,?,?,?,?)'); const e = db.prepare('INSERT INTO athletics_entities VALUES (?,?,?,?)');
  for (const [id, name, unit, ent, disp, fu, pu] of [
    ['c1', 'Northvale State', 100001, 'AE-1', 'Northvale State University', 100001, null],
    ['c2', 'Eastbrook', 100002, 'AE-2', 'Eastbrook College', 100002, null],
    ['c3', 'Maryvale (MO)', 100003, 'AE-3', 'Maryvale (MO)', 100003, null],
    ['c4', 'Maryvale (TN)', 100004, 'AE-4', 'Maryvale (TN)', 100004, null],
    ['c5', 'Westlake', 100005, 'AE-5', 'Westlake University', 100005, null],
    ['c6', 'Westlake Gilbert', null, 'AE-6', 'Westlake University Gilbert', null, 100005],
  ]) { c.run(id, name, 'mens-soccer', unit, ent); e.run(ent, disp, fu, pu); }
  return db;
}
const sidearm = (players) => `<ul>${players.map((p) => `<li class="sidearm-roster-player"><div class="sidearm-roster-player-name"><h3><a href="#">${p.n}</a></h3></div>${p.prev ? `<span class="sidearm-roster-player-previous-school">${p.prev}</span>` : ''}${p.hs ? `<span class="sidearm-roster-player-highschool">${p.hs}</span>` : ''}<span class="sidearm-roster-player-hometown">${p.home || ''}</span></li>`).join('')}</ul>`;

describe('explicit prior-school fields (server/lib/players/priorSchoolEvidence.js)', () => {
  it('reads Sidearm list, Nuxt card and Vue list fields by element CLASS, not label', () => {
    expect(extractRosterSchoolFields(sidearm([{ n: 'Quill Testwood', prev: 'Northvale State' }])).records[0]).toMatchObject({ field_type: FIELD_TYPE.PREVIOUS_SCHOOL, raw_value: 'Northvale State' });
    const nuxt = '<div class="s-person-card"><h3>Quill Testwood</h3><span class="s-person-card__content__person__high-school-item"><span class="sr-only">Last School</span> Lakeside HS</span></div>';
    const r = extractRosterSchoolFields(nuxt).records[0];
    expect(r.high_school).toBe('Lakeside HS'); expect(r.field_type).toBeNull(); // "Last School" on the HIGH-SCHOOL item is not a previous school
    const vue = '<ul><li class="roster-list-item"><a class="roster-list-item__title">Quill Testwood</a><span class="roster-player-list-profile-field roster-player-list-profile-field--previous-school"><!--[-->Eastbrook<!--]--></span></li></ul>';
    expect(extractRosterSchoolFields(vue).records[0].raw_value).toBe('Eastbrook');
  });
  it('a table "Previous School" column is its own field (never folded into hometown)', () => {
    const t = '<table><thead><tr><th>Name</th><th>Pos</th><th>Previous School</th></tr></thead><tbody><tr><td>Quill Testwood</td><td>MF</td><td>Eastbrook</td></tr></tbody></table>';
    expect(extractRosterSchoolFields(t).records[0]).toMatchObject({ field_type: FIELD_TYPE.PREVIOUS_SCHOOL, raw_value: 'Eastbrook', hometown: null });
  });
  it('resolution is family-level and refuses shared bare names', () => {
    const idx = buildInstitutionIndex(world(), 'mens-soccer');
    expect(resolvePriorSchools('Northvale State University', idx)[0].kind).toBe(RESOLUTION.COLLEGE);
    expect(resolvePriorSchools('Maryvale University', idx)[0].kind).not.toBe(RESOLUTION.COLLEGE); // MO or TN?
    expect(resolvePriorSchools('Maryvale (Mo.)', idx)[0]).toMatchObject({ kind: RESOLUTION.COLLEGE, programmes: ['Maryvale (MO)'] });
    expect(resolvePriorSchools('Lakeside High School', idx)[0].kind).toBe(RESOLUTION.HIGH_SCHOOL);
    const fam = resolvePriorSchools('Westlake University', idx)[0];
    expect(readExplicitPrior({ record: { raw_value: 'Westlake University', field_type: FIELD_TYPE.PREVIOUS_SCHOOL }, pageRecords: [], priorProgramme: 'Westlake Gilbert', destinationProgramme: 'Eastbrook', index: idx }).explicit).toBe('AGREES');
    expect(fam.kind).toBe(RESOLUTION.COLLEGE);
  });
  it('a multi-school value agrees if any part is the prior; names another only when every part is a college', () => {
    const idx = buildInstitutionIndex(world(), 'mens-soccer');
    const read = (raw, prior) => readExplicitPrior({ record: { raw_value: raw, field_type: FIELD_TYPE.PREVIOUS_SCHOOL }, pageRecords: [], priorProgramme: prior, destinationProgramme: 'Westlake', index: idx }).explicit;
    expect(read('Eastbrook / Northvale State', 'Northvale State')).toBe('AGREES');
    expect(read('NVSU / Eastbrook', 'Northvale State')).toBe('UNINFORMATIVE'); // an unresolved abbreviation could be the prior
    expect(read('Eastbrook', 'Northvale State')).toBe('NAMES_OTHER_COLLEGE');
  });
  it('a high school in a previous-school field is evidence only on a college-aware page', () => {
    const idx = buildInstitutionIndex(world(), 'mens-soccer');
    const hsOnly = collectPageEvidence({ html: sidearm([{ n: 'Quill Testwood', prev: 'Lakeside HS' }, { n: 'Rowan Placeholder', prev: 'Hillcrest HS' }]), url: 'u', rows: [{ id: 'r1', player_name: 'Quill Testwood' }], index: idx });
    expect(hsOnly.evidence).toHaveLength(0);
    const aware = collectPageEvidence({ html: sidearm([{ n: 'Quill Testwood', prev: 'Lakeside HS' }, { n: 'Rowan Placeholder', prev: 'Eastbrook' }]), url: 'u', rows: [{ id: 'r1', player_name: 'Quill Testwood' }], index: idx });
    expect(aware.evidence[0].evidence_strength).toBe('STRUCTURED_HIGH_SCHOOL');
  });
});

// ------------------------------------------------------------------ link builder: observation vs identity
const R = (id, college, season, name, cls, home, pos = 'MF') => ({ id, college_name: college, sport: 'mens-soccer', season: String(season), player_name: name, class_year_label: cls, hometown: home, position: pos });
function build(rows, evidence = []) {
  const idx = buildInstitutionIndex(world(), 'mens-soccer');
  return buildSeasonLinks({ rows, evidence, indexFor: () => idx, season: '2026', source: '2025', recordedAt: 'T' });
}

describe('link builder — only VERIFIED_SAME_PERSON reaches prior_programme', () => {
  it('John-Smith style collision: the same common name at two schools the same season is never merged', () => {
    const rows = [R('a', 'Eastbrook', 2025, 'Quill Testwood', 'So.', 'Austin, TX'), R('b', 'Westlake', 2025, 'Quill Testwood', 'So.', 'Austin, TX'), R('c', 'Northvale State', 2026, 'Quill Testwood', 'Jr.', 'Austin, TX')];
    const b = build(rows);
    expect(b.prior.get('c')).toBeNull();
    expect(b.links.filter((l) => l.to_observation_id === 'c').every((l) => l.decision === D.AMBIGUOUS)).toBe(true);
  });
  it('an uncommon identical name at two schools in the SAME season: both observations stand, nothing links them', () => {
    const rows = [R('a', 'Eastbrook', 2026, 'Zephyr Quillmoss', 'Jr.', 'Reno, NV'), R('b', 'Westlake', 2026, 'Zephyr Quillmoss', 'Fr.', 'Lima, Peru')];
    const b = build(rows);
    expect(b.links).toHaveLength(0); expect(b.prior.get('a')).toBeNull(); expect(b.prior.get('b')).toBeNull();
  });
  it('siblings/twins (shared surname) never join; same name + same hometown at another school is a transfer only with class progression', () => {
    const rows = [R('a', 'Eastbrook', 2025, 'Ash Quillmoss', 'So.', 'Reno, NV'), R('b', 'Westlake', 2026, 'Bay Quillmoss', 'Jr.', 'Reno, NV'), R('c', 'Westlake', 2026, 'Ash Quillmoss', 'Jr.', 'Reno, Nev.')];
    const b = build(rows);
    expect(b.prior.get('b')).toBeNull();
    expect(b.prior.get('c')).toBe('Eastbrook');
    expect(b.links.find((l) => l.to_observation_id === 'c').evidence_class).toBe(EVIDENCE_CLASS.MULTI_SIGNAL);
  });
  it('same name, different hometown: not linked; the candidate is kept, labelled', () => {
    const b = build([R('a', 'Eastbrook', 2025, 'Ash Quillmoss', 'So.', 'Reno, NV'), R('c', 'Westlake', 2026, 'Ash Quillmoss', 'Jr.', 'Lima, Peru')]);
    expect(b.prior.get('c')).toBeNull(); expect(b.links[0].decision).toBe(D.CONTRADICTED);
  });
  it('transfer with an explicit prior-school field verifies even with a different hometown', () => {
    const rows = [R('a', 'Eastbrook', 2025, 'Ash Quillmoss', 'So.', 'Reno, NV'), R('c', 'Westlake', 2026, 'Ash Quillmoss', 'Jr.', 'Lima, Peru')];
    const ev = [{ evidence_id: 'PE-1', observation_id: 'c', raw_value: 'Eastbrook College', evidence_strength: 'STRUCTURED_COLLEGE', resolved_programmes: '["Eastbrook"]' }];
    const b = build(rows, ev);
    expect(b.prior.get('c')).toBe('Eastbrook'); expect(b.links[0].evidence_class).toBe(EVIDENCE_CLASS.EXPLICIT_PRIOR_SCHOOL); expect(b.links[0].evidence_id).toBe('PE-1');
  });
  it('an explicit previous college with no prior roster on file is an EXPLICIT_PRIOR_INSTITUTION link', () => {
    const b = build([R('c', 'Westlake', 2026, 'Ash Quillmoss', 'So.', 'Reno, NV')], [{ evidence_id: 'PE-2', observation_id: 'c', raw_value: 'Northvale State', evidence_strength: 'STRUCTURED_COLLEGE', resolved_programmes: '["Northvale State"]' }]);
    expect(b.links[0]).toMatchObject({ relation: RELATION.EXPLICIT_PRIOR_INSTITUTION, decision: D.VERIFIED_SAME_PERSON, from_observation_id: null });
    expect(b.prior.get('c')).toBe('Northvale State');
  });
  it('returning player: same programme next season is a scoped continuation, never a transfer', () => {
    const b = build([R('a', 'Eastbrook', 2025, 'Ash Quillmoss', 'So.', 'Reno, NV'), R('c', 'Eastbrook', 2026, 'Ash Quillmoss', 'Jr.', 'Reno, NV')]);
    expect(b.prior.get('c')).toBe('Eastbrook'); expect(arrivedFromElsewhere(b.prior.get('c'), 'Eastbrook')).toBe(false);
  });
  it('the factual guard refuses a name-only prior_programme', () => {
    expect(() => assertFactualPriors({ links: [{ to_observation_id: 'c', from_programme: 'Eastbrook', decision: D.CANDIDATE, evidence_class: 'NAME_ONLY', evidence_json: '{}' }], prior: new Map([['c', 'Eastbrook']]) })).toThrow(/name-only identity is never factual/);
    expect(() => assertFactualPriors({ links: [{ to_observation_id: 'c', from_programme: 'Eastbrook', decision: D.VERIFIED_SAME_PERSON, evidence_class: 'MULTI_SIGNAL', evidence_json: '{}' }], prior: new Map([['c', 'Eastbrook']]) })).not.toThrow();
  });
  it('historical preservation: links never edit an observation; prior seasons get no prior_programme', () => {
    const rows = [R('a', 'Eastbrook', 2025, 'Ash Quillmoss', 'So.', 'Reno, NV'), R('c', 'Westlake', 2026, 'Ash Quillmoss', 'Jr.', 'Reno, NV')];
    const snap = JSON.stringify(rows.map(({ _k, ...r }) => r));
    const b = build(rows);
    expect(JSON.stringify(rows.map(({ _k, ...r }) => r))).toBe(snap);
    expect(b.prior.has('a')).toBe(false);
  });
});

describe('analytics consume VERIFIED origins only', () => {
  it('a row whose origin is only a candidate is not a named arrival', () => {
    const squad = [{ player_name: 'Ash Quillmoss', prior_programme: null, college_name: 'Westlake', position: 'MF' }, { player_name: 'Bay Quillmoss', prior_programme: 'Eastbrook', college_name: 'Westlake', position: 'MF' }];
    expect(namedArrivals(squad, { school: 'Westlake' }).map((a) => a.name)).toEqual(['Bay Quillmoss']);
  });
});

// ------------------------------------------------------------------ monitor recurrence
function monitorDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE roster_players (id TEXT, college_name TEXT, sport TEXT, season TEXT, prior_programme TEXT);
    CREATE TABLE recruiting_arrivals (prior_confidence TEXT);
    CREATE TABLE player_observation_links (link_id TEXT, relation TEXT, to_observation_id TEXT, from_observation_id TEXT, sport TEXT, to_programme TEXT, to_season TEXT, from_programme TEXT, from_season TEXT, decision TEXT, evidence_class TEXT, evidence_json TEXT, evidence_id TEXT, reviewed_at TEXT);`);
  return db;
}
const hard = (db) => Object.fromEntries(playerHistoryChecks(db).filter((c) => c.list.length).map((c) => [c.id, c.list.length]));
describe('player-history monitor detects recurrence', () => {
  it('a name-only factual prior is HARD', () => {
    const db = monitorDb();
    db.prepare("INSERT INTO roster_players VALUES ('a','Eastbrook','mens-soccer','2025',NULL),('c','Westlake','mens-soccer','2026','Eastbrook')").run();
    db.prepare("INSERT INTO player_observation_links VALUES ('L','CROSS_PROGRAMME_PRIOR','c','a','mens-soccer','Westlake','2026','Eastbrook','2025','CANDIDATE','NAME_ONLY','{}',NULL,NULL)").run();
    expect(hard(db)).toMatchObject({ factual_prior_from_name_only: 1, ambiguous_link_consumed_as_verified: 1 });
  });
  it('clean verified state passes; simultaneous rostering and vanished observations are caught', () => {
    const db = monitorDb();
    db.prepare("INSERT INTO roster_players VALUES ('a','Eastbrook','mens-soccer','2025',NULL),('c','Westlake','mens-soccer','2026','Eastbrook')").run();
    db.prepare(`INSERT INTO player_observation_links VALUES ('L','CROSS_PROGRAMME_PRIOR','c','a','mens-soccer','Westlake','2026','Eastbrook','2025','VERIFIED_SAME_PERSON','MULTI_SIGNAL','{"signals":{"hometown":"MATCH","classStep":"PROGRESSES"}}',NULL,NULL)`).run();
    expect(hard(db)).toEqual({});
    db.prepare(`UPDATE player_observation_links SET evidence_json='{"signals":{"hometown":"MATCH","priorContinues":true}}'`).run();
    expect(hard(db).simultaneous_conflicting_programmes).toBe(1);
    db.prepare("DELETE FROM roster_players WHERE id='a'").run();
    expect(hard(db).observation_overwritten_by_identity_merge).toBe(1);
  });
});
