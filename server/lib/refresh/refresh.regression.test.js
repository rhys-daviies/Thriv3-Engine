import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildRegressionWorld, W, PEOPLE, staffPage, rosterPage, published } from './regressionWorld.js';
import { loadRefreshContext } from './context.js';
import { classifyPage, classifyDomainObservation, classifyProgrammeObservation } from './changeClassifier.js';
import { stageRefresh } from './staging.js';

/**
 * PHASE 7E — permanent regression fixtures. Each case is a defect found in the real corpus
 * (Phases 1-7), rebuilt in miniature. If any of these fails, the refresh architecture can
 * reproduce that defect again.
 */
let dir; let db; let ctx;
const opts = { season: 2027, now: new Date('2027-08-20T00:00:00Z'), frozen: new Set([2025]) };
const withHeld = (c) => ({ ...c, coaches: db.prepare('SELECT * FROM coaches').all(), roster: db.prepare('SELECT * FROM roster_players').all() });
const resolve = (o) => ctx.resolver.resolve(o);
const coach = (over, people) => classifyPage(staffPage({ ...over, people }), ctx, opts);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7e-reg-'));
  const p = path.join(dir, 'w.sqlite'); buildRegressionWorld(p);
  db = new Database(p, { readonly: true });
  ctx = withHeld(loadRefreshContext(db));
});
afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('identity: same-name institution collisions', () => {
  it('Concordia Texas vs Texas: the host decides, and a "Texas" label on Concordia TX\'s host is a CONTRADICTION', () => {
    expect(resolve({ source_url: 'https://concordiatx.example/staff', raw_name: 'Concordia University Texas', sport: 'mens-soccer' }).entity_id).toBe('AE-U900101');
    const r = resolve({ source_url: 'https://concordiatx.example/staff', raw_name: 'Texas', sport: 'mens-soccer' });
    expect(r.method).toBe('CONTRADICTION'); expect(r.decision).toBe('REVIEW');
    const bare = resolve({ raw_name: 'Concordia', sport: 'mens-soccer' });
    expect(bare.decision).not.toBe('RESOLVED'); // Concordia TX vs Concordia NE: never picked by name
  });
  it("Saint Mary's CA/MN/TX: a bare name is a fuzzy CANDIDATE only, never an identity", () => {
    const r = resolve({ raw_name: "Saint Mary's", sport: 'mens-soccer' });
    expect(r.decision).not.toBe('RESOLVED'); expect(r.entity_id).toBeNull();
    expect(resolve({ source_url: 'https://rattlers.example/x', raw_name: "Saint Mary's", sport: 'mens-soccer' }).entity_id).toBe('AE-U900203');
  });
  it('Trinity TX vs Trinity Christian: bare "Trinity" does not resolve; the host does', () => {
    expect(resolve({ raw_name: 'Trinity', sport: 'mens-soccer' }).decision).not.toBe('RESOLVED');
    expect(resolve({ source_url: 'https://trinitytigers.example/x', raw_name: 'Trinity', sport: 'mens-soccer' }).entity_id).toBe('AE-U900301');
  });
  it('USF Indiana vs Illinois: the IN label on the IL host is a CONTRADICTION; the IL host alone resolves IL', () => {
    expect(resolve({ source_url: 'https://fightingsaints.example/c', raw_name: 'University of Saint Francis (IN)', sport: 'mens-soccer' }).method).toBe('CONTRADICTION');
    expect(resolve({ source_url: 'https://fightingsaints.example/c', raw_name: 'University of Saint Francis', sport: 'mens-soccer' }).entity_id).toBe('AE-U900402');
  });
  it('Columbia MO vs SC: a WRONG_INSTITUTION host never resolves; bare "Columbia College" does not pick a state', () => {
    const r = resolve({ source_url: 'https://columbiacougars.example/c', raw_name: 'Columbia College', sport: 'mens-soccer' });
    expect(r.decision).not.toBe('RESOLVED');
    expect(resolve({ raw_name: 'Columbia College', sport: 'mens-soccer' }).decision).not.toBe('RESOLVED');
  });
  it('Johnson vs Johnson & Wales: self-identification takes the LONGEST name — JWU\'s page never proves Johnson University', () => {
    const [o] = classifyDomainObservation({ dataset: 'DOMAIN', host: 'jwu-new.example', institution_label: 'Johnson University', sport: 'mens-soccer', institution_link_url: 'https://johnsonroyals.example/athletics', self_identification: 'Johnson & Wales University Wildcats', http_status: 200 }, ctx);
    expect(o.classification).not.toBe('NEW_RECORD');
  });
});

describe('identity: branch campuses and parents', () => {
  it('IU Columbus vs IU Indianapolis: the shared institutional domain is parent-only and cannot pick a campus', () => {
    const r = resolve({ source_url: 'https://iu.example/directory', raw_name: 'Indiana University', sport: 'mens-soccer' });
    expect(r.decision).not.toBe('RESOLVED');
    const own = resolve({ source_url: 'https://crimsonpride.example/staff', raw_name: 'IU Columbus', sport: 'mens-soccer' });
    expect(own.entity_id).toBe('AE-X-IU-COLUMBUS'); expect(own.college_id).toBe(W.IUC);
  });
  it('IU Columbus coach page on the parent domain is never promotable (tier D for the branch)', () => {
    const out = coach({ source_url: 'https://iu.example/sports/mens-soccer/coaches', institution_label: 'Indiana University Columbus' }, [published({ full_name: 'Casey Columbus', role: 'Head Coach', email: 'casey@iu.example' })]);
    expect(out.every((o) => ['SOURCE_UNTRUSTED', 'IDENTITY_AMBIGUOUS', 'CONTRADICTION'].includes(o.classification))).toBe(true);
  });
  it('Benedictine Mesa vs Lisle: ben.example (parent) evidence never moves a NAIA branch coach into the NCAA D3 parent', () => {
    const r = resolve({ source_url: 'https://ben.example/staff', raw_name: 'Benedictine', sport: 'mens-soccer' });
    expect(r.entity_id === 'AE-U900801' && r.decision === 'RESOLVED').toBe(false);
    expect(resolve({ source_url: 'https://redhawks.example/staff', raw_name: 'Benedictine Mesa', sport: 'mens-soccer' }).college_id).toBe(W.MESA);
  });
  it('Park Gilbert vs Park: the campus SUBDOMAIN belongs to Gilbert, never to the parent that owns the root', () => {
    expect(ctx.resolver.hostOwnedBy('gilbert.parkathl.example', 'AE-X-PARK-GILBERT')).toBe(true);
    expect(ctx.resolver.hostOwnedBy('gilbert.parkathl.example', 'AE-U900901')).toBe(false);
    expect(ctx.resolver.hostOwnedBy('parkathl.example', 'AE-U900901')).toBe(true);
    const out = coach({ source_url: 'https://gilbert.parkathl.example/sports/mens-soccer/coaches', institution_label: 'Park University' }, [published(PEOPLE.PARKC)]);
    expect(out[0].classification).toBe('CONTRADICTION'); // host says Gilbert, name says Park
  });
  it('no-UNITID institution (Stanton): resolves by its own host, never acquires a federal UNITID', () => {
    const r = resolve({ source_url: 'https://stantonelks.example/staff', raw_name: 'Stanton', sport: 'mens-soccer' });
    expect(r.entity_id).toBe('AE-X-STANTON');
    const out = coach({ source_url: 'https://stantonelks.example/sports/mens-soccer/coaches', institution_label: 'Stanton University' }, [published({ full_name: 'Jordan Elk', role: 'Head Coach', email: 'jordan.elk@stantonelks.example' })]);
    expect(out[0].classification).toBe('NEW_RECORD');
    expect(out[0].proposed_json.school).toBe('Stanton University');
  });
  it('shared PrestoSports: a platform host identifies nobody and a platform root is never owned', () => {
    const r = resolve({ source_url: 'https://prestocollege.prestosports.com/sports/msoc/coaches', raw_name: 'Presto', sport: 'mens-soccer' });
    expect(r.evidence.some((e) => e.method === 'SHARED_PLATFORM')).toBe(true);
    expect(r.method).not.toBe('AUTHORITATIVE_HOST');
    const [d] = classifyDomainObservation({ dataset: 'DOMAIN', host: 'prestosports.com', institution_label: 'Presto College', sport: 'mens-soccer', self_identification: 'Presto College', http_status: 200 }, ctx);
    expect(d.classification).toBe('SOURCE_UNTRUSTED'); expect(d.proposed_json.ownership_class).toBe('SHARED_PLATFORM');
  });
});

describe('coaches: currentness, email, departures', () => {
  it('inferred email is DISCARDED — a new coach with only a pattern address is staged without one', () => {
    const [o] = coach({}, [{ full_name: 'Nova Newhire', role: 'Assistant Coach', email: 'nova.newhire@concordiatx.example', email_origin: 'INFERRED' }]).filter((x) => x.proposed_action === 'CREATE_COACH');
    expect(o.proposed_json.email).toBeNull(); expect(o.proposed_json.email_status).toBe('unknown');
    expect(JSON.stringify(o.evidence_json)).toMatch(/discarded/);
  });
  it('unchanged coach -> CONFIRMED_UNCHANGED with currentness + email_seen refreshed', () => {
    const [o] = coach({}, [published(PEOPLE.HEAD), published(PEOPLE.ASSIST), published(PEOPLE.OLDASSIST)]).filter((x) => x.target_key === PEOPLE.HEAD.id);
    expect(o.classification).toBe('CONFIRMED_UNCHANGED');
    expect(o.proposed_json.email_seen_on_source_url).toBe('https://concordiatx.example/sports/mens-soccer/coaches');
  });
  it('departed coach: head coach replaced by a NAMED successor -> STALE_CANDIDATE (review); assistant simply absent -> DISAPPEARED (no write)', () => {
    const out = coach({}, [published({ full_name: 'Quinn Successor', role: 'Head Coach', email: 'quinn.successor@concordiatx.example' }), published(PEOPLE.ASSIST)]);
    const head = out.find((o) => o.target_key === PEOPLE.HEAD.id);
    expect(head.classification).toBe('STALE_CANDIDATE'); expect(head.proposed_action).toBe('MARK_PROVEN_STALE'); expect(head.requires_review).toBe(1);
    const gone = out.find((o) => o.target_key === PEOPLE.OLDASSIST.id);
    expect(gone.classification).toBe('DISAPPEARED_FROM_SOURCE'); expect(gone.proposed_action).toBe('INVESTIGATE_CURRENTNESS');
    expect(out.find((o) => o.proposed_action === 'CREATE_COACH').proposed_json.email).toBe('quinn.successor@concordiatx.example');
  });
  it('changed email: same person, new published address, old one gone -> REPLACE_VERIFIED_EMAIL (review); old still on page -> POSSIBLE_CHANGE', () => {
    const changed = coach({}, [published(PEOPLE.HEAD, 'p.headcoach@concordiatx.example')]).find((o) => o.target_key === PEOPLE.HEAD.id);
    expect(changed.classification).toBe('VERIFIED_UPDATE'); expect(changed.proposed_action).toBe('REPLACE_VERIFIED_EMAIL'); expect(changed.requires_review).toBe(1);
    const both = coach({ emails_on_page: [PEOPLE.HEAD.email] }, [published(PEOPLE.HEAD, 'p.headcoach@concordiatx.example')]).find((o) => o.target_key === PEOPLE.HEAD.id);
    expect(both.classification).toBe('POSSIBLE_CHANGE');
  });
  it('stale coach observed again -> REINSTATE requires review (never silently CURRENT)', () => {
    const [o] = coach({ source_url: 'https://trinitytrolls.example/sports/mens-soccer/coaches', institution_label: 'Trinity Christian' }, [published(PEOPLE.STALE)]);
    expect(o.proposed_action).toBe('REINSTATE_COACH'); expect(o.requires_review).toBe(1);
  });
  it('historical evidence never marks CURRENT: an archived or prior-season staff page is SOURCE_UNTRUSTED', () => {
    const wb = coach({ source_url: 'https://web.archive.org/web/2026/https://concordiatx.example/sports/mens-soccer/coaches' }, [published(PEOPLE.HEAD)]);
    expect(wb[0].classification).toBe('SOURCE_UNTRUSTED');
    const old = coach({ observed_season: 2026 }, [published(PEOPLE.HEAD)]);
    expect(old[0].classification).toBe('SOURCE_UNTRUSTED');
  });
  it('wrong-sport source: a men\'s staff page staged for the women\'s programme is a CONTRADICTION', () => {
    const out = classifyPage(staffPage({ sport: 'womens-soccer', people: [published(PEOPLE.HEAD)] }), ctx, opts);
    expect(out[0].classification).toBe('CONTRADICTION');
  });
  it('an address already held at another institution is a CONTRADICTION (never a second owner)', () => {
    const [o] = coach({}, [published({ full_name: 'Twin Name', role: 'Assistant Coach', email: PEOPLE.PARKC.email })]);
    expect(o.classification).toBe('CONTRADICTION');
  });
  it('one person coaching both teams of the SAME institution (one address) is not a contradiction', () => {
    const w = classifyPage(staffPage({ sport: 'womens-soccer', source_url: 'https://concordiatx.example/sports/womens-soccer/coaches', people: [published(PEOPLE.HEAD)] }), ctx, opts);
    expect(w[0].classification).toBe('NEW_RECORD');
    expect(JSON.stringify(w[0].evidence_json)).toMatch(/one person coaching both/);
  });
  it('a search result / aggregator never promotes a coach', () => {
    const out = coach({ source_kind: 'SEARCH_RESULT' }, [published(PEOPLE.HEAD)]);
    expect(out[0].classification).toBe('SOURCE_UNTRUSTED');
  });
});

describe('rosters: history is preserved', () => {
  it('additions, continuations, transfers, non-players, duplicates and frozen seasons', () => {
    const out = classifyPage(rosterPage({ players: [
      { player_name: 'Alex Keeper', class_year_label: 'Jr.', position: 'GK' },
      { player_name: 'Pat Headcoach', position: 'Head Coach' },
      { player_name: 'Dup Name', class_year_label: 'Fr.' }, { player_name: 'Dup Name', class_year_label: 'Fr.' },
    ] }), ctx, opts);
    const by = (n) => out.filter((o) => o.target_key?.endsWith(`|${n}`));
    expect(by('alex keeper')[0].classification).toBe('NEW_RECORD');
    const t26 = classifyPage(rosterPage({ source_url: 'https://concordiatx.example/sports/mens-soccer/roster/2026', page_season: 2026, observed_season: 2026, source_complete: false, players: [{ player_name: 'Drew Transfer', class_year_label: 'So.', position: 'FW' }] }), ctx, { ...opts, season: 2026 });
    expect(t26[0].classification).toBe('NEW_RECORD');
    expect(JSON.stringify(t26[0].evidence_json)).toMatch(/TRANSFER CANDIDATE/); // flagged, never linked automatically
    expect(by('pat headcoach')[0].classification).toBe('SOURCE_UNTRUSTED');
    expect(by('dup name').every((o) => o.classification === 'IDENTITY_AMBIGUOUS')).toBe(true);
    const frozen = classifyPage(rosterPage({ source_url: 'https://concordiatx.example/sports/mens-soccer/roster/2025', page_season: 2025, observed_season: 2025, players: [{ player_name: 'Casey Senior', class_year_label: 'Sr.' }] }), ctx, opts);
    expect(frozen[0].classification).toBe('SOURCE_UNTRUSTED');
  });
  it('an old roster page is never the current one', () => {
    const out = classifyPage(rosterPage({ page_season: 2026, players: [{ player_name: 'Alex Keeper' }] }), ctx, opts);
    expect(out[0].classification).toBe('CONTRADICTION');
  });
  it('a held class year / position / nationality is never overwritten (POSSIBLE_CHANGE); an empty field is filled', () => {
    const o2026 = { ...opts, season: 2026, frozen: new Set([2025]) };
    const out = classifyPage(rosterPage({ source_url: 'https://concordiatx.example/sports/mens-soccer/roster/2026', page_season: 2026, observed_season: 2026, source_complete: true, players: [
      { player_name: 'Alex Keeper', class_year_label: 'Jr.', position: 'GK', nationality: 'USA' },
      { player_name: 'Blake Mid', class_year_label: 'Jr.', position: 'MF', nationality: 'CAN' },
    ] }), ctx, o2026);
    expect(out.find((o) => o.target_key?.endsWith('|alex keeper')).classification).toBe('POSSIBLE_CHANGE');
    expect(out.find((o) => o.target_key?.endsWith('|blake mid')).proposed_action).toBe('FILL_ROSTER_FIELDS');
  });
  it('a player missing from the next roster is not removed; a same-season re-scrape absence is DISAPPEARED (kept)', () => {
    const out = classifyPage(rosterPage({ source_url: 'https://concordiatx.example/sports/mens-soccer/roster/2026', page_season: 2026, observed_season: 2026, players: [{ player_name: 'Alex Keeper', class_year_label: 'So.', position: 'GK', nationality: 'USA' }] }), ctx, { ...opts, season: 2026 });
    const gone = out.find((o) => o.target_key === 'r-b26');
    expect(gone.classification).toBe('DISAPPEARED_FROM_SOURCE'); expect(gone.proposed_action).toBeNull();
    expect(out.some((o) => o.target_key === 'r-c25')).toBe(false); // prior season untouched
  });
  it('class going backwards on a same-name continuation is IDENTITY_AMBIGUOUS', () => {
    const out = classifyPage(rosterPage({ players: [{ player_name: 'Blake Mid', class_year_label: 'Fr.' }] }), ctx, { ...opts, season: 2027 });
    // 2026 had Blake Mid as Jr.
    expect(out[0].classification).toBe('IDENTITY_AMBIGUOUS');
  });
});

describe('programmes: transitions never rewrite history', () => {
  const ssu = (over) => classifyProgrammeObservation({ dataset: 'PROGRAMME', institution_label: 'Shawnee State', sport: 'mens-soccer', season: 2027, division: 'NCAA D2', conference: 'Mountain East Conference', membership_status: 'PROVISIONAL', postseason_eligible: 0, review_due_season: 2029,
    sources: [{ url: 'https://mountaineast.example/news/ssu', kind: 'CONFERENCE_SITE' }, { url: 'https://ssubears.example/sports/mens-soccer/schedule/2027', kind: 'OFFICIAL_SCHEDULE' }], ...over }, ctx, { season: 2027 })[0];
  it('Shawnee transition: two independent tier-B sources -> VERIFIED_UPDATE CHANGE_DIVISION, reviewed, closing NAIA at 2026', () => {
    const o = ssu();
    expect(o.classification).toBe('VERIFIED_UPDATE'); expect(o.proposed_action).toBe('CHANGE_DIVISION'); expect(o.requires_review).toBe(1);
    const ops = o.proposed_json.period_ops;
    expect(ops[0]).toMatchObject({ op: 'CLOSE_PERIOD', last_season: 2026 });
    expect(ops[1].row).toMatchObject({ division: 'NCAA D2', membership_status: 'PROVISIONAL', first_season: 2027, postseason_eligible: 0 });
  });
  it('one tier-B source alone cannot change a division', () => {
    expect(ssu({ sources: [{ url: 'https://mountaineast.example/news/ssu', kind: 'CONFERENCE_SITE' }] }).classification).toBe('POSSIBLE_CHANGE');
  });
  it('a change dated into the current open period is a CONTRADICTION (history rewrite)', () => {
    expect(ssu({ season: 2026 }).classification).toBe('CONTRADICTION');
  });
  it('an aggregator never changes membership', () => {
    expect(ssu({ sources: [{ url: 'https://rankings.example/ssu', kind: 'AGGREGATOR' }] }).classification).toBe('POSSIBLE_CHANGE');
  });
});

describe('staging is deterministic', () => {
  it('same database + same input -> same batch id, observation ids and batch hash', () => {
    const input = { season: 2027, scope: 'NAIA', parser_version: 'test-1', gathered_at: '2027-08-20T00:00:00Z', pages: [staffPage({ people: [published(PEOPLE.HEAD)] })] };
    const a = stageRefresh(db, input); const b = stageRefresh(db, input);
    expect(a.batch.batch_id).toBe(b.batch.batch_id); expect(a.batch.batch_hash).toBe(b.batch.batch_hash);
    expect(a.observations.map((o) => o.observation_id)).toEqual(b.observations.map((o) => o.observation_id));
  });
});
