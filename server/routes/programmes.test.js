/**
 * THE PROGRAMME DATABASE — Phase 4 (docs/IMMEDIATE_CHANGES_ROADMAP.md).
 *
 *   - Server-side filters (sport, class, division, conference, school) and
 *     pagination, each refusing rather than widening a bad value.
 *   - School search is the registry's own predicate: name, plus GLOBAL aliases
 *     on UNITID; never fuzzy, never a conference-scoped alias.
 *   - Sport identity: one school is two programmes; the other sport is linked
 *     through the athletics-entity id only.
 *   - Openings are the engine's: equal to `positionEvidence` over a freshly
 *     built pool, and to the players the roster section marks EXPIRED.
 *   - Missing, unruled, insufficient, inactive and stale data say so.
 *   - Nothing is written: no change on this connection, and the matchmaking
 *     corpus digest and revision are unchanged after every endpoint.
 */
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.THRIV3_SCRYPT_COST = '14';
process.env.THRIV3_SESSION_SECRET = `p4prog-${'k'.repeat(40)}`;
process.env.THRIV3_APP_ORIGIN = 'http://localhost:5184';
process.env.THRIV3_REPORT_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-p4prog-'));

const ORIGIN = 'http://localhost:5184';
const { default: app } = await import('../index.js');
const { default: db } = await import('../db/client.js');
const { createOperator, resetLoginLimits } = await import('../lib/operatorAuth.js');
const { seedPool, SEASON } = await import('../lib/v2/seedTestPool.js');
const { clearContextCache } = await import('../lib/v2/matchmakingService.js');
const { buildPoolContext } = await import('../lib/v2/poolContext.js');
const { positionEvidence } = await import('../lib/v2/rosterEvidence.js');
const { corpusDigests, clearCorpusDigestCache } = await import('../lib/v2/corpusIdentity.js');
const { corpusRevisionToken } = await import('../db/corpusIdentity.js');
const {
  CLASS_YEARS, DEFAULT_CLASS_YEAR, listProgrammes,
} = await import('../lib/programmeDatabase.js');

const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];
let server; let base; let cookie;

const get = (url) => fetch(`${base}${url}`, { headers: { origin: ORIGIN, cookie } });
const json = async (url) => { const r = await get(url); return { status: r.status, body: await r.json() }; };

function seedExtras() {
  const now = new Date().toISOString();
  const college = db.prepare(`INSERT INTO colleges
    (id, created_date, updated_date, name, sport, division, conference, active, soccer_score, unitid, athletics_entity_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const roster = db.prepare(`INSERT INTO roster_players
    (id, created_date, updated_date, college_name, sport, division, season, player_name, class_year_label, position,
     minutes_played, games_started)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  // An inactive programme.
  college.run('x-closed', now, now, 'Closed College', 'mens-soccer', 'NCAA D3', 'Conf 0', 0, 40, null, null);
  // A school found only through a GLOBAL alias, and one that must not be found through a scoped one.
  college.run('x-alias', now, now, 'Saint Aloysius', 'mens-soccer', 'NCAA D2', 'Conf 1', 1, 50, 123456, null);
  college.run('x-scoped', now, now, 'Rochester Christian', 'mens-soccer', 'NAIA', 'Conf 2', 1, 45, 234567, null);
  const alias = db.prepare(`INSERT INTO institution_aliases
    (alias_key, alias_raw, unitid, conference_scope, alias_type, source, confidence, imported_at)
    VALUES (?,?,?,?,'HISTORICAL_NAME','test','CURATED',?)`);
  alias.run('st al university', 'St. Al University', 123456, '*', now);
  alias.run('rochesterville', 'Rochesterville', 234567, 'WHAC', now);
  // One school, two sports, same name: two programmes.
  college.run('x-twin-m', now, now, 'Twin College', 'mens-soccer', 'NCAA D3', 'Conf 3', 1, 41, null, null);
  college.run('x-twin-w', now, now, 'Twin College', 'womens-soccer', 'NCAA D3', 'Conf 3', 1, 41, null, null);
  // The other sport linked through the entity id, not the (different) name.
  db.prepare("UPDATE colleges SET athletics_entity_id = 'ae-1' WHERE id IN ('c-mens-soccer-0', 'c-womens-soccer-0')").run();
  // No eligibility rule on file (NJCAA), with a roster.
  college.run('x-juco', now, now, 'Juco CC', 'mens-soccer', 'NJCAA', 'Conf 4', 1, 30, null, null);
  for (let j = 0; j < 4; j += 1) {
    roster.run(`rx-juco-${j}`, now, now, 'Juco CC', 'mens-soccer', 'NJCAA', SEASON, `Juco ${j}`, 'Fr.', POSITIONS[j], 900, 10);
  }
  // A roster nobody could read a class from: rows exist, departures cannot be counted.
  college.run('x-unread', now, now, 'Unread U', 'mens-soccer', 'NCAA D1', 'Conf 0', 1, 70, null, null);
  for (let j = 0; j < 4; j += 1) {
    roster.run(`rx-unread-${j}`, now, now, 'Unread U', 'mens-soccer', 'NCAA D1', SEASON, `Unread ${j}`, '??', POSITIONS[j], 900, 10);
  }
  // One conference stored under two spellings; a scoped alias in two divisions; a data-only division.
  college.run('x-soon-1', now, now, 'Sooner One', 'mens-soccer', 'NAIA', 'Sooner', 1, 30, null, null);
  college.run('x-soon-2', now, now, 'Sooner Two', 'mens-soccer', 'NAIA', 'Sooner Athletic Conference', 1, 31, null, null);
  college.run('x-mac-d1', now, now, 'Mac Dee One', 'mens-soccer', 'NCAA D1', 'MAC', 1, 80, null, null);
  college.run('x-mac-d3', now, now, 'Mac Dee Three', 'mens-soccer', 'NCAA D3', 'MAC', 1, 35, null, null);
  college.run('x-cccaa', now, now, 'Coast CC', 'mens-soccer', 'CCCAA', 'Conf 4', 1, 20, null, null);
  // Women's arrivals materialisation recorded against a different input: STALE.
  db.prepare(`INSERT INTO recruiting_arrivals_build (sport, input_digest, builder_version, built_at, generation)
              VALUES ('womens-soccer', 'not-the-current-input', 'test', ?, 1)`).run(now);
}

let before;
const snapshot = () => {
  clearCorpusDigestCache();
  return {
    changes: db.prepare('SELECT total_changes() n').get().n,
    digests: corpusDigests(db),
    revision: corpusRevisionToken(db),
  };
};

beforeAll(async () => {
  seedPool('mens-soccer', { unscoreable: 2 });
  seedPool('womens-soccer');
  seedExtras();
  clearContextCache();
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  resetLoginLimits();
  await createOperator({ email: 'p4@example.com', password: 'a-perfectly-fine-passphrase' });
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email: 'p4@example.com', password: 'a-perfectly-fine-passphrase' }),
  });
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  // Everything above is fixture. From here on, the database must not move.
  before = snapshot();
});
afterAll(() => new Promise((r) => server.close(r)));

const names = (body) => body.programmes.map((p) => p.name);

describe('recruiting classes', () => {
  it('runs from the season after the roster to the furthest season any current player could still be eligible', () => {
    expect(CLASS_YEARS).toEqual([2027, 2028, 2029, 2030]);
    expect(DEFAULT_CLASS_YEAR).toBe(2027);
  });

  it('refuses a class outside that window rather than inventing a rule for it', async () => {
    for (const y of [2026, 2031]) {
      const r = await json(`/api/programmes?sport=mens-soccer&classYear=${y}`);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('CLASS_YEAR_OUT_OF_RANGE');
    }
  });

  it('marks a class at or past a division\'s own eligibility ceiling as decided by the calendar', async () => {
    const r = await json('/api/programmes?sport=mens-soccer&classYear=2029&division=NCAA%20D3&pageSize=100');
    expect(r.body.programmes.every((p) => p.windowExhausted)).toBe(true);
    const d1 = await json('/api/programmes?sport=mens-soccer&classYear=2029&division=NCAA%20D1&pageSize=100');
    expect(d1.body.programmes.every((p) => !p.windowExhausted)).toBe(true);
  });
});

describe('filters and pagination', () => {
  it('requires a sport, and a sport never returns the other sport\'s rows', async () => {
    expect((await json('/api/programmes')).status).toBe(400);
    const m = await json('/api/programmes?sport=mens-soccer&pageSize=100');
    expect(m.body.programmes.every((p) => p.sport === 'mens-soccer')).toBe(true);
  });

  it('filters by division and by conference, server-side', async () => {
    const d = await json('/api/programmes?sport=mens-soccer&division=NAIA&pageSize=100');
    expect(d.body.total).toBeGreaterThan(0);
    expect(d.body.programmes.every((p) => p.division === 'NAIA')).toBe(true);
    const c = await json('/api/programmes?sport=mens-soccer&division=NCAA%20D1&conference=Conf%200&pageSize=100');
    expect(c.body.programmes.every((p) => p.division === 'NCAA D1' && p.conference === 'Conf 0')).toBe(true);
    expect(names(c.body)).toContain('Unread U');
    expect((await json('/api/programmes?sport=mens-soccer&division=Division%20Nine')).status).toBe(400);
  });

  it('a conference filters by identity: every stored spelling of it, and only it', async () => {
    const f = (await json('/api/programmes/facets?sport=mens-soccer')).body;
    const sooner = f.conferences.find((c) => c.value === 'id:sooner');
    expect(sooner).toMatchObject({ division: 'NAIA', label: 'Sooner Athletic Conference', n: 2, spellings: ['Sooner', 'Sooner Athletic Conference'] });
    const r = await json('/api/programmes?sport=mens-soccer&conference=id%3Asooner&sort=name');
    expect(names(r.body)).toEqual(['Sooner One', 'Sooner Two']);
    // A spelling the register does not hold is matched exactly, never by similarity.
    expect(f.conferences.find((c) => c.value === 'Conf 2')).toBeTruthy();
    const raw = await json('/api/programmes?sport=mens-soccer&conference=Conf%202&pageSize=100');
    expect(raw.body.programmes.every((p) => p.conference === 'Conf 2')).toBe(true);
  });

  it('a scoped alias is read in its own division: "MAC" in D1 is not "MAC" in D3', async () => {
    const f = (await json('/api/programmes/facets?sport=mens-soccer')).body;
    expect(f.conferences.find((c) => c.division === 'NCAA D1' && c.spellings.includes('MAC')).value).toBe('id:mac');
    expect(f.conferences.find((c) => c.division === 'NCAA D3' && c.spellings.includes('MAC')).value).not.toBe('id:mac');
    expect(names((await json('/api/programmes?sport=mens-soccer&conference=id%3Amac')).body)).toEqual(['Mac Dee One']);
  });

  it('accepts a division the registry stores for the sport even outside the canonical six', async () => {
    const r = await json('/api/programmes?sport=mens-soccer&division=CCCAA');
    expect(names(r.body)).toEqual(['Coast CC']);
    expect(r.body.programmes[0].departures.GOALKEEPER.state).toBe('NO_ROSTER');
  });

  it('pages without overlap and reports the total', async () => {
    const all = await json('/api/programmes?sport=mens-soccer&sort=name&pageSize=100');
    const p1 = await json('/api/programmes?sport=mens-soccer&sort=name&pageSize=10&page=1');
    const p2 = await json('/api/programmes?sport=mens-soccer&sort=name&pageSize=10&page=2');
    expect(p1.body.total).toBe(all.body.total);
    expect(p1.body.pages).toBe(Math.ceil(all.body.total / 10));
    expect([...names(p1.body), ...names(p2.body)]).toEqual(names(all.body).slice(0, 20));
    expect((await json('/api/programmes?sport=mens-soccer&pageSize=500')).body.pageSize).toBe(100);
    expect((await json('/api/programmes?sport=mens-soccer&page=0')).status).toBe(400);
    expect((await json('/api/programmes?sport=mens-soccer&sort=name;DROP')).status).toBe(400);
  });

  it('hides inactive programmes by default, and lists them unassessed when asked', async () => {
    expect(names((await json('/api/programmes?sport=mens-soccer&pageSize=100&school=Closed')).body)).toEqual([]);
    const r = await json('/api/programmes?sport=mens-soccer&school=Closed&includeInactive=1');
    expect(r.body.programmes).toHaveLength(1);
    expect(r.body.programmes[0]).toMatchObject({ active: 0, assessed: false, notAssessedReason: 'INACTIVE', departures: null });
  });

  it('offers the divisions and conferences that exist for the sport', async () => {
    const f = (await json('/api/programmes/facets?sport=mens-soccer')).body;
    expect(f.divisions.map((d) => d.division)).toEqual(['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA', 'CCCAA']);
    expect(f.conferences.some((c) => c.division === 'NAIA' && c.value === 'Conf 2')).toBe(true);
    expect(f.classYears).toEqual(CLASS_YEARS);
  });
});

describe('school search is the registry\'s, with aliases and never fuzzy', () => {
  it('finds by name substring', async () => {
    expect(names((await json('/api/programmes?sport=mens-soccer&school=aloys')).body)).toEqual(['Saint Aloysius']);
  });
  it('finds through a global alias joined on UNITID, returning the canonical row', async () => {
    expect(names((await json('/api/programmes?sport=mens-soccer&school=St.%20Al%20Univ')).body)).toEqual(['Saint Aloysius']);
  });
  it('does not use a conference-scoped alias, and does not guess at a near spelling', async () => {
    expect(names((await json('/api/programmes?sport=mens-soccer&school=Rochesterville')).body)).toEqual([]);
    expect(names((await json('/api/programmes?sport=mens-soccer&school=Aloyisus')).body)).toEqual([]);
  });
  it('refuses a one-character search', async () => {
    expect((await json('/api/programmes?sport=mens-soccer&school=S')).body.code).toBe('SEARCH_QUERY_TOO_SHORT');
  });
});

describe('sport identity', () => {
  it('the same name in two sports is two programmes with two ids', async () => {
    const m = (await json('/api/programmes?sport=mens-soccer&school=Twin')).body.programmes;
    const w = (await json('/api/programmes?sport=womens-soccer&school=Twin')).body.programmes;
    expect(m.map((p) => p.id)).toEqual(['x-twin-m']);
    expect(w.map((p) => p.id)).toEqual(['x-twin-w']);
    expect((await json('/api/programmes/x-twin-w')).body.overview.sport).toBe('womens-soccer');
  });
  it('links the other sport through the athletics entity, and never by name', async () => {
    const d = (await json('/api/programmes/c-mens-soccer-0')).body;
    expect(d.overview.siblings.map((s) => s.id)).toEqual(['c-womens-soccer-0']);
    // Same name, no entity id: no link.
    expect((await json('/api/programmes/x-twin-m')).body.overview.siblings).toEqual([]);
  });
  it('an unknown id is a 404', async () => {
    expect((await json('/api/programmes/nope')).status).toBe(404);
    expect((await json('/api/programmes/nope/recruiting')).status).toBe(404);
    expect((await json('/api/programmes/nope/intelligence')).status).toBe(404);
  });
});

describe('openings are the engine\'s', () => {
  it('every listed count equals positionEvidence over a freshly built pool, for every class', async () => {
    const ctx = buildPoolContext({ db, sport: 'mens-soccer', season: SEASON });
    let compared = 0;
    for (const classYear of CLASS_YEARS) {
      const page = listProgrammes({ sport: 'mens-soccer', classYear, pageSize: 100 });
      for (const p of page.programmes.filter((x) => x.assessed)) {
        for (const pos of POSITIONS) {
          const ev = positionEvidence({
            programme: p.name, position: pos, sport: 'mens-soccer', division: p.division, entryYear: classYear,
            rosterIndex: ctx.rosterIndex, arrivalIndex: ctx.arrivalIndex, arrivalsHorizon: ctx.arrivalsHorizon,
          });
          expect(p.departures[pos].openings).toBe(ev.openings);
          expect(p.departures[pos].vacatedStarters).toBe(ev.vacatedStarters);
          expect(p.departures[pos].eligibleToRemain).toBe(ev.eligibleToRemain);
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(400);
  });

  it('the roster section marks exactly as many players EXPIRED as the count says opened', async () => {
    for (const classYear of CLASS_YEARS) {
      const d = (await json(`/api/programmes/c-mens-soccer-5?classYear=${classYear}`)).body;
      for (const pos of POSITIONS) {
        const expired = d.roster.players.filter((p) => p.position === pos && p.availability === 'EXPIRED').length;
        expect(expired).toBe(d.roster.departures[pos].openings);
        expect(d.roster.departingPlayers[pos]).toHaveLength(d.roster.departures[pos].openings);
      }
    }
  });

  it('is relative to the class: a later class sees at least as many places open', async () => {
    const at = async (y) => (await json(`/api/programmes/c-mens-soccer-3?classYear=${y}`)).body.roster.departures;
    const a = await at(2027); const b = await at(2028);
    for (const pos of POSITIONS) expect(b[pos].openings).toBeGreaterThanOrEqual(a[pos].openings);
  });
});

describe('missing, unruled, insufficient, inactive and stale data say so', () => {
  it('no roster on file', async () => {
    const d = (await json('/api/programmes/c-mens-soccer-nodata-0')).body;
    expect(d.roster.rosterOnFile).toBe(false);
    expect(Object.values(d.roster.departures).every((x) => x.state === 'NO_ROSTER')).toBe(true);
  });
  it('an association with no eligibility rule', async () => {
    const d = (await json('/api/programmes/x-juco')).body;
    expect(d.roster.eligibility.ruled).toBe(false);
    expect(Object.values(d.roster.departures).every((x) => x.state === 'NO_ELIGIBILITY_RULE')).toBe(true);
    expect(d.roster.players.every((p) => p.availability === 'UNREADABLE')).toBe(true);
  });
  it('rows we cannot read a class from', async () => {
    const d = (await json('/api/programmes/x-unread')).body;
    expect(Object.values(d.roster.departures).every((x) => x.state === 'INSUFFICIENT_EVIDENCE')).toBe(true);
    expect(d.roster.evidence.classUnreadable).toBe(4);
  });
  it('an inactive programme is shown but not assessed', async () => {
    const d = (await json('/api/programmes/x-closed')).body;
    expect(d.overview.active).toBe(0);
    expect(d.roster).toMatchObject({ assessed: false, notAssessedReason: 'INACTIVE', departures: null });
  });
  it('recruiting history: a stale materialisation is STALE, never an empty history', async () => {
    const r = (await json('/api/programmes/c-womens-soccer-1/recruiting')).body;
    expect(r.state).toBe('STALE');
    expect(r.positions).toBeUndefined();
  });
  it('recruiting history: served with its coverage where the build may be read', async () => {
    const r = (await json('/api/programmes/c-mens-soccer-1/recruiting')).body;
    expect(['AVAILABLE', 'NO_HISTORY']).toContain(r.state);
    if (r.state === 'AVAILABLE') expect(r.coverage).toHaveProperty('status');
  });
  it('programme intelligence returns each half with its own state and the report link', async () => {
    const r = (await json('/api/programmes/c-mens-soccer-1/intelligence')).body;
    expect(['AVAILABLE', 'UNAVAILABLE']).toContain(r.philosophy.state);
    expect(['AVAILABLE', 'UNAVAILABLE']).toContain(r.competitive.state);
    expect(r.reportUrl).toBe('/api/philosophy/c-mens-soccer-1/report.pdf');
  });
});

describe('existing routes and access are unchanged', () => {
  it('/api/programmes/intelligence still answers by programme name', async () => {
    const r = await json('/api/programmes/intelligence?collegeName=Seed%20M1&sport=mens-soccer');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ collegeName: 'Seed M1', sport: 'mens-soccer' });
  });
  it('requires a signed-in operator', async () => {
    const r = await fetch(`${base}/api/programmes?sport=mens-soccer`, { headers: { origin: ORIGIN } });
    expect(r.status).toBe(401);
  });
});

describe('read-only', () => {
  it('nothing was written, and the matchmaking corpus digest and revision are unchanged', async () => {
    for (const url of [
      '/api/programmes?sport=mens-soccer&classYear=2028&includeInactive=1&pageSize=100',
      '/api/programmes/facets?sport=womens-soccer',
      '/api/programmes/c-mens-soccer-2?classYear=2030',
      '/api/programmes/c-mens-soccer-2/recruiting',
      '/api/programmes/c-mens-soccer-2/intelligence',
      '/api/colleges/c-mens-soccer-2/coaches',
      '/api/colleges/c-mens-soccer-2/programme-contacts',
    ]) expect((await get(url)).status).toBe(200);
    const after = snapshot();
    expect(after.changes).toBe(before.changes);
    expect(after.revision).toBe(before.revision);
    expect(after.digests).toEqual(before.digests);
  });
});
