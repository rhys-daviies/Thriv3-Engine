/**
 * The institution and programme resolvers, built from the database.
 *
 * One place builds them, so the domain audit, the conference importer and any
 * future collector all ask the same question of the same table and get the same
 * answer. A second resolver built somewhere else would be a second opinion on
 * who a school is, which is the thing 12D exists to remove.
 */
import db from '../db/client.js';
import {
  buildInstitutionResolver, normaliseInstitution, institutionVariants, indexVariants,
  parseInstitutionName, IDENTITY_UNRESOLVED, IDENTITY_METHOD,
} from '../../shared/institutionIdentity.js';
import { resolveConference } from '../../shared/conferenceIdentity.js';

/** Programme identity methods, which are not the same as institution ones. */
export const PROGRAMME_METHOD = Object.freeze({
  NAME_EXACT: 'PROGRAMME_NAME_EXACT',           // the sport's own row is spelled exactly this way
  NAME_VARIANT: 'PROGRAMME_NAME_VARIANT',       // a closed rewriting of it is
  CONFERENCE_AGREEMENT: 'PROGRAMME_VIA_CONFERENCE_AGREEMENT', // two sources name the same conference
  OFFICIAL_MEMBERSHIP: 'PROGRAMME_VIA_OFFICIAL_MEMBERSHIP',   // the association's own record names it
  UNITID: 'PROGRAMME_VIA_UNITID',               // the institution resolved and fields one team
  UNITID_THEN_NAME: 'PROGRAMME_VIA_UNITID_NAME', // it fields several, and the name chose
});

export const PROGRAMME_UNRESOLVED = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  AMBIGUOUS: 'AMBIGUOUS',
  NO_PROGRAMME_IN_SPORT: 'NO_PROGRAMME_IN_SPORT', // the institution is known and fields no team here
  STATE_CONFLICT: 'STATE_CONFLICT',               // the source wrote a state, and the match is in another
  OFFICIAL_ROSTER_CONTRADICTS: 'OFFICIAL_ROSTER_CONTRADICTS', // the conference's own membership names a different institution by this name
});

function loadAliases() {
  const rows = db.prepare('SELECT alias_raw, unitid, alias_type FROM institution_aliases').all();
  return rows.map((r) => ({ alias: r.alias_raw, unitid: r.unitid, aliasType: r.alias_type }));
}

function loadColleges() {
  return db.prepare('SELECT id, name, sport, division, unitid, state, conference FROM colleges').all();
}

/**
 * @returns `{ resolve, resolveProgramme, collisions, counts }`
 *
 * `resolveProgramme` answers the question collection actually asks: a
 * conference printed "PennWest Edinboro" in its men's table — which of OUR rows
 * is that? It tries the sport's own names first, because `colleges` has a
 * unique index on (name, sport) and an exact hit there cannot be wrong. Only
 * then does it go through the institution, and where one institution fields
 * several programmes in one sport — the three PennWest campuses share a UNITID
 * — the name decides between them or nothing does.
 */
export function buildResolvers({ aliases = null, colleges = null } = {}) {
  const collegeRows = colleges ?? loadColleges();
  const states = {};
  for (const c of collegeRows) if (c.unitid != null && c.state) states[c.unitid] = c.state;
  const resolver = buildInstitutionResolver(aliases ?? loadAliases(), states);

  const bySportName = new Map();     // sport -> written-down name -> college row
  const bySportVariant = new Map();  // sport -> generated rewriting -> college row (or null if two claim it)
  const bySportUnitid = new Map();   // sport -> unitid -> [rows]
  for (const c of collegeRows) {
    if (!bySportName.has(c.sport)) { bySportName.set(c.sport, new Map()); bySportVariant.set(c.sport, new Map()); bySportUnitid.set(c.sport, new Map()); }
    bySportName.get(c.sport).set(normaliseInstitution(c.name), c);
    if (c.unitid != null) {
      const m = bySportUnitid.get(c.sport);
      if (!m.has(c.unitid)) m.set(c.unitid, []);
      m.get(c.unitid).push(c);
    }
  }
  for (const c of collegeRows) {
    const v = bySportVariant.get(c.sport);
    const names = bySportName.get(c.sport);
    for (const k of indexVariants(c.name)) {
      if (names.has(k)) continue;                 // a written-down name wins outright
      v.set(k, v.has(k) && v.get(k)?.id !== c.id ? null : c);   // two claimants -> neither
    }
  }

  /**
   * Programmes whose own conference string resolves to `conferenceId`.
   *
   * Built once per resolver. `colleges.conference` is a CURRENT snapshot and is
   * stale for the seven men's programmes that changed division, so it is used
   * only as CORROBORATION: a match is evidence, and staleness produces a miss
   * rather than a wrong answer.
   */
  const byConference = new Map();
  for (const c of collegeRows) {
    if (!c.conference) continue;
    const r = resolveConference(c.conference, { sport: c.sport, division: c.division });
    if (!r.id) continue;
    const k = `${r.id}|${c.sport}`;
    if (!byConference.has(k)) byConference.set(k, new Set());
    byConference.get(k).add(c.id);
  }

  /**
   * The associations' own membership record, by conference.
   *
   * Stronger evidence than `colleges.conference` for the same job — it is
   * published by the NCAA rather than maintained here — and used the same way:
   * only to decide which of several institutions sharing a spelling is the one
   * a conference published. It is a current, all-sports snapshot and says
   * nothing about a season.
   */
  const officialMembers = new Map();
  const officialRoster = new Map();   // conference_id -> [{ unitid, nameOfficial }]
  try {
    for (const m of db.prepare('SELECT conference_id, unitid, name_official FROM conference_members_official').all()) {
      if (!officialMembers.has(m.conference_id)) { officialMembers.set(m.conference_id, new Set()); officialRoster.set(m.conference_id, []); }
      if (m.unitid != null) officialMembers.get(m.conference_id).add(m.unitid);
      officialRoster.get(m.conference_id).push({ unitid: m.unitid, nameOfficial: m.name_official });
    }
  } catch { /* the table is created by migrate; an absent one simply offers nothing */ }

  /**
   * A BETTER CANDIDATE IN THE CONFERENCE'S OWN MEMBERSHIP BEATS A REWRITING.
   *
   * The Centennial Conference prints "Washington College #1 seed". Strip the
   * notation and the institution type and what is left is "Washington", which is
   * a whole written-down name belonging to the University of Washington — and a
   * Division I programme acquired a Division III season in the Centennial. The
   * conference's own membership names Washington College, the printed name IS
   * that name, and that is enough to refuse the rewriting.
   *
   * It fires only where a contradicting official member exists, and only against
   * a rewriting. A programme that left a conference before the directory's
   * snapshot is simply absent from it — silence rather than contradiction — so
   * genuine movers are unaffected, and an exact name is never questioned by it.
   */
  const contradictedByOfficialRoster = (raw, matchedUnitid, conferenceId) => {
    const roster = officialRoster.get(conferenceId);
    if (!roster) return null;
    const printed = normaliseInstitution(parseInstitutionName(raw).base);
    if (!printed) return null;
    let found = null;
    for (const m of roster) {
      if (m.unitid != null && m.unitid === matchedUnitid) return null;
      if (!found && normaliseInstitution(parseInstitutionName(m.nameOfficial).base) === printed) found = m;
    }
    return found;
  };

  /**
   * One raw name to one programme.
   *
   * @param conferenceId the conference whose own table published this name. It
   *   is used ONLY to break a tie between institutions that share a spelling —
   *   "Westminster" is three different colleges, and the Presidents' Athletic
   *   Conference publishing it is a statement about which one. It never
   *   overrides an unambiguous match and never invents one: where two
   *   candidates or none belong to that conference, the row stays refused.
   */
  function resolveProgramme(raw, sport, { divisions = null, conferenceId = null } = {}) {
    const names = bySportName.get(sport);
    if (!names) return { collegeId: null, raw, reason: PROGRAMME_UNRESOLVED.NO_PROGRAMME_IN_SPORT };
    // A STATE THE SOURCE WROTE IS A VETO, not a hint. The PSAC prints
    // "California (Pa.)" and the rewriting that strips the qualifier leaves
    // "California", which is the University of California's row in our own
    // table — a Division I programme 2,500 miles away. Without this, PennWest
    // California's Division II seasons were filed under Berkeley, which is the
    // Columbia-College-Missouri failure exactly, produced by our own normaliser.
    const { state } = parseInstitutionName(raw);
    const agrees = (row) => !state || !row.state || row.state === state;

    // A veto is recorded and the search CONTINUES. "California (Pa.)" hits our
    // "California" first — the wrong state, so refused — and the row it means
    // is only reachable through the alias table further down.
    let vetoed = null;
    const exact = names.get(normaliseInstitution(raw));
    if (exact && agrees(exact)) return { collegeId: exact.id, name: exact.name, unitid: exact.unitid, division: exact.division, method: PROGRAMME_METHOD.NAME_EXACT, raw };
    if (exact) vetoed = exact;
    for (const map of [names, bySportVariant.get(sport) ?? new Map()]) {
      for (const v of institutionVariants(raw)) {
        const hit = map.get(v);
        if (!hit) continue;
        if (agrees(hit)) {
          const better = conferenceId ? contradictedByOfficialRoster(raw, hit.unitid, conferenceId) : null;
          if (better) {
            return {
              collegeId: null, raw, reason: PROGRAMME_UNRESOLVED.OFFICIAL_ROSTER_CONTRADICTS,
              candidates: [hit.id], officialMember: better.nameOfficial,
            };
          }
          return { collegeId: hit.id, name: hit.name, unitid: hit.unitid, division: hit.division, method: PROGRAMME_METHOD.NAME_VARIANT, raw };
        }
        vetoed = vetoed ?? hit;
      }
    }
    const inst = resolver.resolve(raw);
    if (!inst.unitid) {
      if (vetoed) return { collegeId: null, raw, reason: PROGRAMME_UNRESOLVED.STATE_CONFLICT, candidates: [vetoed.id] };
      // A spelling several institutions share, and a conference that published
      // it. Exactly one of the candidates whose OWN conference string names
      // this conference is the member; two or none leaves it refused.
      if (inst.reason === IDENTITY_UNRESOLVED.AMBIGUOUS && conferenceId && inst.candidates) {
        const inConf = byConference.get(`${conferenceId}|${sport}`) ?? new Set();
        const hits = collegeRows.filter((c) => c.sport === sport && inst.candidates.includes(c.unitid) && inConf.has(c.id));
        if (hits.length === 1) {
          return { collegeId: hits[0].id, name: hits[0].name, unitid: hits[0].unitid, division: hits[0].division, method: PROGRAMME_METHOD.CONFERENCE_AGREEMENT, raw };
        }
        // Then the association's own record, which reaches the cases our own
        // conference string does not — it is stale for the seven programmes
        // that changed division and absent for some women's rows.
        const official = officialMembers.get(conferenceId) ?? new Set();
        const off = collegeRows.filter((c) => c.sport === sport && inst.candidates.includes(c.unitid) && official.has(c.unitid));
        if (off.length === 1) {
          return { collegeId: off[0].id, name: off[0].name, unitid: off[0].unitid, division: off[0].division, method: PROGRAMME_METHOD.OFFICIAL_MEMBERSHIP, raw };
        }
      }
      return { collegeId: null, raw, reason: inst.reason, candidates: inst.candidates ?? null };
    }
    const rows = (bySportUnitid.get(sport)?.get(inst.unitid) ?? [])
      .filter((r) => (!divisions || divisions.includes(r.division)) && agrees(r));
    if (rows.length === 1) {
      return { collegeId: rows[0].id, name: rows[0].name, unitid: rows[0].unitid, division: rows[0].division, method: PROGRAMME_METHOD.UNITID, raw };
    }
    if (!rows.length) {
      return { collegeId: null, raw, unitid: inst.unitid,
        reason: vetoed ? PROGRAMME_UNRESOLVED.STATE_CONFLICT : PROGRAMME_UNRESOLVED.NO_PROGRAMME_IN_SPORT };
    }
    // One institution, several programmes — the PennWest and Commonwealth
    // campuses. The printed name has to choose, and if it does not, nothing does.
    const wanted = new Set([normaliseInstitution(raw), ...institutionVariants(raw)]);
    const picked = rows.filter((r) => wanted.has(normaliseInstitution(r.name)));
    if (picked.length === 1) {
      return { collegeId: picked[0].id, name: picked[0].name, unitid: picked[0].unitid, division: picked[0].division, method: PROGRAMME_METHOD.UNITID_THEN_NAME, raw };
    }
    return { collegeId: null, raw, unitid: inst.unitid, reason: PROGRAMME_UNRESOLVED.AMBIGUOUS, candidates: rows.map((r) => r.id) };
  }

  return {
    resolve: resolver.resolve,
    collisions: resolver.collisions,
    resolveProgramme,
    counts: { aliasKeys: resolver.size, colleges: collegeRows.length },
  };
}

export { IDENTITY_UNRESOLVED, IDENTITY_METHOD };
