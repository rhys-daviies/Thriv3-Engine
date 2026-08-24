#!/usr/bin/env node
/**
 * One-off: place Bucket-B coaching contacts.
 *  - EXISTS: schools already in `colleges` under a different name -> place
 *    coaches directly onto the exact-name GraduatingSenior record (bypasses the
 *    fuzzy matcher, which strips parentheticals and mis-routes siblings).
 *  - CREATE: schools genuinely absent -> create a College row (placeholder
 *    ratings, flagged in identity_notes) + a GraduatingSenior record.
 * Dry run unless --apply.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseCsvToObjects } from '../lib/csv.js';
import { College } from '../db/entities/college.js';
import { GraduatingSenior } from '../db/entities/graduatingSenior.js';

const apply = process.argv.includes('--apply');
const DIR = '/Users/rhysdavies/Documents/Thriv3/2025 Coaches Emails';
const MEN = ['d1_mens', 'd2_mens', 'd3_mens', 'naia_mens'];
const WOM = ['d1_womens', 'd2_womens', 'd3_womens', 'naia_womens'];

function coachesBySchool(files) {
  const d = {};
  for (const f of files) {
    const rows = parseCsvToObjects(fs.readFileSync(path.join(DIR, `${f}_soccer_coaching_contacts.csv`), 'utf-8'));
    for (const r of rows) {
      const email = (r.email || '').trim();
      if (!email) continue;
      (d[r.school_name] ||= []).push({ name: r.coach_name, title: r.coach_title, email });
    }
  }
  return d;
}
const src = { 'mens-soccer': coachesBySchool(MEN), 'womens-soccer': coachesBySchool(WOM) };

const EXISTS = {
  'mens-soccer': { 'Cal State Northridge': 'CSUN', 'East Tennessee State University': 'ETSU', 'Florida Gulf Coast': 'FGCU', 'Incarnate Word': 'UIW', 'Long Island University': 'LIU', "Saint Mary's California": "Saint Mary's" },
  'womens-soccer': { 'AUM': 'Auburn Montgomery', 'CSU Pueblo': 'Colorado State-Pueblo', 'Cal State LA': 'Cal State Los Angeles', 'DBU': 'Dallas Baptist', 'Embry-Riddle': 'Embry–Riddle Aeronautical', 'Illinois Springfield': 'UIS', 'MSU Denver': 'Metro State Denver', 'MSU Moorhead': 'Minnesota State Moorhead', 'Missouri-St. Louis': 'UMSL', 'USC Aiken': 'South Carolina Aiken', 'USC Beaufort': 'South Carolina Beaufort', 'Caltech': 'California Institute of Technology', 'MIT': 'Massachusetts Institute of Technology', 'MUW': 'Mississippi University for Women', 'Maritime': 'SUNY Maritime College', 'NYU': 'New York University', 'Pitt-Bradford': 'University of Pittsburgh-Bradford', 'Pitt-Greensburg': 'University of Pittsburgh-Greensburg', 'RIT': 'Rochester Institute of Technology', 'RPI': 'Rensselaer Polytechnic Institute', 'TCNJ': 'The College of New Jersey', 'UW-Superior': 'University of Wisconsin-Superior', 'WPI': 'Worcester Polytechnic Institute', 'WashU': 'Washington University in St Louis' },
};
const CREATE = {
  'mens-soccer': { 'Hartford': 'NCAA D1', 'Montana State Billings': 'NCAA D2', 'Pace': 'NCAA D2', 'Inter American (PR)': 'NCAA D2', 'Andrew College': 'NAIA', 'Warner Pacific University': 'NAIA', 'Concordia Irvine': 'NCAA D2', 'Ottawa University Arizona': 'NAIA', 'Park University Gilbert': 'NAIA' },
  'womens-soccer': { 'Glenville State': 'NCAA D2', 'Mississippi College': 'NCAA D2', 'Albertus Magnus': 'NCAA D3', 'Cal Lutheran': 'NCAA D3', 'Claremont-Mudd-Scripps': 'NCAA D3', 'Colby-Sawyer': 'NCAA D3', 'Dean': 'NCAA D3', 'Eastern Connecticut': 'NCAA D3', 'Elms': 'NCAA D3', 'FDU-Florham': 'NCAA D3', 'Lasell': 'NCAA D3', 'Mitchell': 'NCAA D3', 'Norwich': 'NCAA D3', 'Penn State Behrend': 'NCAA D3', 'Penn State Brandywine': 'NCAA D3', 'Plymouth State': 'NCAA D3', 'Pomona-Pitzer': 'NCAA D3', 'Rivier': 'NCAA D3', 'Simmons': 'NCAA D3', 'UC Santa Cruz': 'NCAA D3', 'UMass Boston': 'NCAA D3', 'UMass Dartmouth': 'NCAA D3' },
};
const PLACE = { 'NCAA D1': 55.0, 'NCAA D2': 48.0, 'NCAA D3': 38.0, 'NAIA': 45.0 };

const yr = (s) => { const m = String(s || '').match(/\d{4}/); return m ? Number(m[0]) : -1; };
function gsPlace(sport, collegeName, coaches) {
  const recs = GraduatingSenior.filter({ sport, college_name: collegeName });
  if (recs.length) {
    const rec = [...recs].sort((a, b) => yr(a.season) - yr(b.season)).pop();
    const have = new Set((rec.coaching_staff || []).map((c) => (c.email || '').toLowerCase()));
    const add = coaches.filter((c) => !have.has(c.email.toLowerCase()));
    if (apply && add.length) GraduatingSenior.update(rec.id, { coaching_staff: [...(rec.coaching_staff || []), ...add] });
    return `update ${collegeName} +${add.length}`;
  }
  if (apply) GraduatingSenior.create({ college_name: collegeName, season: '2025-2026', coaching_staff: coaches, players: [], position_data: [], all_graduating_senior_names: [], total_graduating_seniors: null, sport });
  return `create-GS ${collegeName} (${coaches.length})`;
}

const log = [];
let aliasN = 0, collegesN = 0, coachesN = 0, noCoach = [];
for (const sport of ['mens-soccer', 'womens-soccer']) {
  for (const [csvName, college] of Object.entries(EXISTS[sport])) {
    const coaches = src[sport][csvName] || [];
    if (!coaches.length) { noCoach.push(`${sport}:${csvName}`); continue; }
    log.push('ALIAS ' + gsPlace(sport, college, coaches)); aliasN++; coachesN += coaches.length;
  }
  for (const [csvName, div] of Object.entries(CREATE[sport])) {
    const coaches = src[sport][csvName] || [];
    const existing = College.filter({ sport, name: csvName });
    if (!existing.length) {
      if (apply) College.create({ name: csvName, division: div, sport, soccer_score: PLACE[div], academic_rating: 6.0, identity_notes: 'Added for coaching-contact coverage; soccer_score/academic_rating are placeholders' });
      collegesN++;
      log.push(`CREATE-COLLEGE ${csvName} [${div}]`);
    }
    if (coaches.length) { log.push('  ' + gsPlace(sport, csvName, coaches)); coachesN += coaches.length; }
    else noCoach.push(`${sport}:${csvName}`);
  }
}
console.log(`${apply ? 'APPLIED' : 'DRY RUN'}`);
for (const l of log) console.log(' ', l);
console.log(`\naliases placed: ${aliasN} | colleges created: ${collegesN} | coaches placed: ${coachesN}`);
if (noCoach.length) console.log(`schools with NO emailable coaches (no GS placed): ${noCoach.join(', ')}`);
if (!apply) console.log('\nRe-run with --apply to write.');
