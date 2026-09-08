import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/client.js';
import { evidenceFor } from '../lib/evidenceQueries.js';
import { loadAthlete } from './evidence.js';
import { permissionsFor, PERMISSION, EVIDENCE_KIND_NAMES } from '../../shared/evidence/kinds.js';

/**
 * The send path, and the fact that the preview is not the security boundary.
 *
 * A coach receives what `sendOutreach` derives, not what the browser was
 * shown. `sendOutreach` calls `evidenceFor` — the same function this suite
 * calls — which runs `selectEvidence` and therefore `selectFrom`, where the
 * OUTREACH permission is now enforced. So the guarantee worth testing is not
 * "the composer hides denied kinds" but "the server cannot be talked into
 * deriving one", including by a `prefer` list from a tampered tab.
 *
 * Seeded against real generation rather than synthetic objects: the kinds
 * being excluded here are ones this fixture genuinely produces, which is what
 * stops the assertions from passing against a programme that had nothing to
 * exclude.
 */

const athleteId = randomUUID();
const COLLEGE = 'Gate Test University';

function roster(o = {}) {
  db.prepare(`INSERT INTO roster_players
    (id, created_date, updated_date, college_name, sport, division, season, player_name,
     position, minutes_played, projected_minutes, estimated_graduation_year,
     eligibility_end_year, class_year_label, nationality, country, prior_programme)
    VALUES (@id, @stamp, @stamp, @college_name, 'mens-soccer', 'NCAA D1', @season,
     @player_name, @position, @minutes_played, @projected_minutes, @estimated_graduation_year,
     @eligibility_end_year, @class_year_label, @nationality, @country, @prior_programme)`)
    .run({
      stamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      id: randomUUID(), college_name: COLLEGE, season: '2026', player_name: 'A Player',
      position: 'MIDFIELD', minutes_played: null, projected_minutes: 600,
      estimated_graduation_year: 2029, eligibility_end_year: 2028, class_year_label: 'Jr.',
      nationality: 'USA', country: '', prior_programme: null, ...o,
    });
}

beforeAll(() => {
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport,
      nationality, recruiting_class_year)
    VALUES (?, '2026-01-01', '2026-01-01', 'Gate Athlete', 'Defender', 'mens-soccer',
      'New Zealand', 2027)`).run(athleteId);
  db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active)
    VALUES (?, '2026-01-01', '2026-01-01', ?, 'mens-soccer', 'NCAA D1', 1)`)
    .run(randomUUID(), COLLEGE);

  // A squad rich enough to generate several DENIED kinds alongside permitted
  // ones: transfers in (TRANSFER_BEHAVIOUR), a classified position group
  // (POSITION_GROUP_SIZE), five seasons of intakes (POSITION_INTAKE_HISTORY),
  // plus a graduating cohort and a compatriot, which are permitted.
  for (const season of ['2022', '2023', '2024', '2025', '2026']) {
    for (let i = 0; i < 8; i += 1) roster({ season, player_name: `Squad ${season}-${i}` });
    for (let i = 0; i < 6; i += 1) {
      roster({ season, player_name: `Def ${season}-${i}`, position: 'DEFENSE' });
    }
    roster({
      season, player_name: `Transfer ${season}`, position: 'DEFENSE',
      prior_programme: 'Some Other College',
    });
  }
  roster({ season: '2023', player_name: 'Kiwi One', country: 'New Zealand', nationality: 'International' });
  roster({ player_name: 'Leaver One', position: 'DEFENSE', estimated_graduation_year: 2027, projected_minutes: 1200 });
  roster({ player_name: 'Leaver Two', position: 'DEFENSE', estimated_graduation_year: 2027, projected_minutes: 1100 });
});

const DENIED = EVIDENCE_KIND_NAMES.filter((k) => permissionsFor(k).OUTREACH === PERMISSION.DENIED);

const derive = (opts = {}) => evidenceFor(loadAthlete(athleteId), COLLEGE, { sport: 'mens-soccer', ...opts });

// ---------------------------------------------------------------------------

describe('the server derives through the permission gate', () => {
  it('generates denied kinds, so the exclusions below mean something', () => {
    const generated = derive().all.map((e) => e.kind);
    const deniedGenerated = generated.filter((k) => DENIED.includes(k));
    expect(deniedGenerated.length).toBeGreaterThan(0);
  });

  it('selects none of the seventeen denied kinds', () => {
    const selected = derive().selected.map((e) => e.kind);
    expect(selected.length).toBeGreaterThan(0);
    for (const kind of DENIED) expect(selected, kind).not.toContain(kind);
    expect(DENIED).toHaveLength(17);
  });

  it('files them as not permitted rather than losing them', () => {
    // The operator sees what we know and why it is not offerable. Dropping
    // them silently would make the panel's "we knew this" section a lie.
    const result = derive();
    const internal = result.internal.map((e) => e.kind);
    const deniedGenerated = result.all.map((e) => e.kind).filter((k) => DENIED.includes(k));
    for (const kind of deniedGenerated) expect(internal, kind).toContain(kind);
  });

  it('renders no sentence for any of them', () => {
    // Nothing denied may appear in the paragraph the send path composes.
    const { paragraph, sentences } = derive();
    const text = [paragraph ?? '', ...(sentences ?? []).map((s) => s.text ?? '')].join(' ');
    for (const kind of DENIED) expect(text, kind).not.toContain(kind);
    expect(sentences.every((s) => !DENIED.includes(s.kind))).toBe(true);
  });
});

describe('a tampered client cannot restore a denied kind', () => {
  it('refuses a prefer list naming denied kinds', () => {
    // `prefer` is what the composer posts back. It carries kind NAMES and is
    // matched against what survived the gate, so naming a denied kind names
    // something that is not in the map.
    const result = derive({ prefer: DENIED });
    for (const kind of DENIED) expect(result.selected.map((e) => e.kind), kind).not.toContain(kind);
    expect(result.operatorSelected).toBe(false);
    for (const kind of DENIED) expect(result.unavailableRequests, kind).toContain(kind);
  });

  it('falls back to the engine rather than sending nothing', () => {
    const engine = derive().selected.map((e) => e.kind);
    const tampered = derive({ prefer: DENIED }).selected.map((e) => e.kind);
    expect(tampered).toEqual(engine);
  });

  it('still honours a preference among permitted kinds', () => {
    const permitted = derive().selected.map((e) => e.kind);
    expect(permitted.length).toBeGreaterThan(1);
    const chosen = derive({ prefer: [permitted[1]] }).selected.map((e) => e.kind);
    expect(chosen).toEqual([permitted[1]]);
  });

  it('drops the denied names out of a mixed preference and keeps the rest', () => {
    const permitted = derive().selected.map((e) => e.kind);
    const result = derive({ prefer: [DENIED[0], permitted[0]] });
    expect(result.selected.map((e) => e.kind)).toEqual([permitted[0]]);
    expect(result.unavailableRequests).toEqual([DENIED[0]]);
  });
});

describe('there is one gate, not two', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  it('the send path derives evidence rather than accepting it', () => {
    const src = strip(read('server/routes/sendOutreach.js'));
    expect(src).toContain('evidenceFor(');
    // No second filter of its own — the gate is in selection, once.
    expect(src).not.toContain('emailEligible');
    expect(src).not.toContain('permissions.OUTREACH');
  });

  it('no production file outside the registry decides email reach by the legacy flag', () => {
    // Reports may still DESCRIBE it; nothing may GATE on it. `select.js` was
    // the last gate and is now permission-based.
    for (const rel of ['shared/evidence/select.js', 'shared/evidence/index.js',
      'shared/email/compose.js', 'server/routes/sendOutreach.js']) {
      expect(strip(read(rel)), rel).not.toContain('emailEligible');
    }
  });

  it('the composer wire offers only what the send path would permit', () => {
    // An operator offered a sentence the server would then refuse is a worse
    // failure than not being offered it.
    const src = strip(read('server/routes/evidence.js'));
    expect(src).toContain('outreachPermitted(ev)');
    expect(src).not.toContain('(ev.permissions.OUTREACH !== PERMISSION.DENIED)');
  });
});
