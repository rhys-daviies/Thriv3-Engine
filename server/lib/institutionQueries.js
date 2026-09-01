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

/** Programme identity methods, which are not the same as institution ones. */
export const PROGRAMME_METHOD = Object.freeze({
  NAME_EXACT: 'PROGRAMME_NAME_EXACT',           // the sport's own row is spelled exactly this way
  NAME_VARIANT: 'PROGRAMME_NAME_VARIANT',       // a closed rewriting of it is
  UNITID: 'PROGRAMME_VIA_UNITID',               // the institution resolved and fields one team
  UNITID_THEN_NAME: 'PROGRAMME_VIA_UNITID_NAME', // it fields several, and the name chose
});

export const PROGRAMME_UNRESOLVED = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  AMBIGUOUS: 'AMBIGUOUS',
  NO_PROGRAMME_IN_SPORT: 'NO_PROGRAMME_IN_SPORT', // the institution is known and fields no team here
  STATE_CONFLICT: 'STATE_CONFLICT',               // the source wrote a state, and the match is in another
});

function loadAliases() {
  const rows = db.prepare('SELECT alias_raw, unitid, alias_type FROM institution_aliases').all();
  return rows.map((r) => ({ alias: r.alias_raw, unitid: r.unitid, aliasType: r.alias_type }));
}

function loadColleges() {
  return db.prepare('SELECT id, name, sport, division, unitid, state FROM colleges').all();
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

  function resolveProgramme(raw, sport, { divisions = null } = {}) {
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
        if (agrees(hit)) return { collegeId: hit.id, name: hit.name, unitid: hit.unitid, division: hit.division, method: PROGRAMME_METHOD.NAME_VARIANT, raw };
        vetoed = vetoed ?? hit;
      }
    }
    const inst = resolver.resolve(raw);
    if (!inst.unitid) {
      if (vetoed) return { collegeId: null, raw, reason: PROGRAMME_UNRESOLVED.STATE_CONFLICT, candidates: [vetoed.id] };
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
