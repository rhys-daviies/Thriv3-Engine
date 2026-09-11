import db from '../db/client.js';

/**
 * FINDING A PROGRAMME AN OPERATOR CAN THEN CHOOSE. Discovery, never resolution.
 *
 * This returns candidates. It does not decide which one is meant, and there is
 * no code path here that turns a typed string into a programme identity on its
 * own. That distinction is the whole design, and it is not caution for its own
 * sake: the matcher in server/lib/schoolMatch.js has corrupted three separate
 * columns by resolving names it was not certain about — it published Belmont
 * Abbey's domain for Belmont, gave Kansas the academic rating of Central
 * Arkansas and USC the rating of USC Upstate. Every one of those was a
 * confident wrong answer where a visible gap would have been harmless.
 *
 * So: the operator sees rows, the operator picks a row, and what is stored is
 * that row's own `id` and `name`. A query matching nothing returns nothing.
 *
 * WHAT IS DELIBERATELY ABSENT, and stays absent until somebody argues
 * otherwise in writing: no fuzzy or edit-distance ranking, no LLM resolver, no
 * web lookup, no "create this school" escape hatch. An institution the
 * registry does not hold as an active programme in this sport is not
 * selectable, and the honest answer to a search for one is an empty list.
 */

/**
 * Two characters, because one returns most of the registry.
 *
 * A refusal rather than a silent empty list: a picker that shows nothing for
 * "D" looks identical to a picker that shows nothing for a school we do not
 * have, and those are different things for the operator to know.
 */
const MIN_QUERY_LENGTH = 2;

/** A page of candidates, not a dump. The UI is a picker, not a browser. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Substring containment via `instr`, NOT `LIKE`.
 *
 * `LIKE` would make the operator's own text a pattern language: a search for
 * "St. Mary's 100%" would have its `%` read as a wildcard, and every `_` in a
 * typed name silently matches any character. `instr` has no metacharacters, so
 * the query is only ever itself and no escaping scheme has to be maintained.
 *
 * Case folding is SQLite's `lower()`, which is ASCII-only. Every name in
 * `colleges` is ASCII, so this is exact for the data that exists rather than a
 * general Unicode guarantee — said plainly here rather than assumed.
 */
const NAME_MATCH = "instr(lower(c.name), lower(@q)) > 0";

/**
 * Aliases contribute DISCOVERY TERMS ONLY. A row found through an alias is
 * still the canonical `colleges` row, returned with the canonical name.
 *
 * GLOBAL ALIASES ONLY (`conference_scope = '*'`). The scoped ones are scoped
 * precisely because they are ambiguous outside their own conference — the
 * schema's own example is the Wolverine-Hoosier printing "Rochester" for
 * Rochester Christian while the UAA prints it for the University of Rochester,
 * in the same seasons. A search has no conference context to disambiguate
 * with, so it must not use aliases that need one.
 *
 * The join is on `unitid`, an exact integer identity, not on a name. Colleges
 * without a unitid simply do not gain alias terms.
 */
const ALIAS_MATCH = `
  EXISTS (
    SELECT 1 FROM institution_aliases a
     WHERE a.unitid = c.unitid
       AND a.conference_scope = '*'
       AND instr(lower(a.alias_raw), lower(@q)) > 0
  )
`;

/**
 * @param {object} params
 * @param {string} params.sport      required; the same name is two programmes in two sports
 * @param {string} params.query      what the operator typed
 * @param {number} [params.limit]
 * @param {boolean} [params.includeInactive]  default false — see below
 * @returns {Array<object>} canonical candidates, best-first
 */
export function searchColleges({ sport, query, limit, includeInactive = false } = {}) {
  const sportValue = typeof sport === 'string' ? sport.trim() : '';
  if (!sportValue) {
    throw fail('SPORT_REQUIRED',
      'A programme search must name a sport. The same college name is a different programme in each sport.');
  }

  const q = typeof query === 'string' ? query.trim() : '';
  if (q.length < MIN_QUERY_LENGTH) {
    throw fail('SEARCH_QUERY_TOO_SHORT',
      `Type at least ${MIN_QUERY_LENGTH} characters to search for a programme.`);
  }

  let cap = Number.isInteger(limit) ? limit : DEFAULT_LIMIT;
  if (cap < 1) cap = 1;
  if (cap > MAX_LIMIT) cap = MAX_LIMIT;

  /**
   * INACTIVE PROGRAMMES ARE OUT BY DEFAULT, and `active` defaults to 1 so a
   * row that predates the column is kept — the same `active !== 0` reading
   * src/pages/Colleges.jsx uses. A closed programme, or one that does not
   * field this sport, is not something an operator should be able to select
   * into a live relationship by accident.
   */
  const activeClause = includeInactive ? '' : 'AND (c.active IS NULL OR c.active != 0)';

  return db.prepare(`
    SELECT
      c.id, c.name, c.sport, c.division, c.conference, c.city, c.state, c.active,
      CASE WHEN ${NAME_MATCH} THEN 'name' ELSE 'alias' END AS matched_on
    FROM colleges c
    WHERE c.sport = @sport
      ${activeClause}
      AND (${NAME_MATCH} OR ${ALIAS_MATCH})
    ORDER BY
      -- A name match before an alias match, and a prefix before a match
      -- buried mid-string, so "Duke" does not arrive under "Duke Kunshan"
      -- because of alphabetical order. Ordering only; nothing is discarded.
      CASE WHEN ${NAME_MATCH} THEN 0 ELSE 1 END,
      CASE WHEN instr(lower(c.name), lower(@q)) = 1 THEN 0 ELSE 1 END,
      length(c.name),
      c.name
    LIMIT @limit
  `).all({ sport: sportValue, q, limit: cap });
}

/**
 * The one row an operator selected, re-read from the registry.
 *
 * A CALLER'S COPY OF A ROW IS NOT AN IDENTITY. The picker's result may be
 * minutes old and came back over HTTP, so the id is looked up again here and
 * the NAME STORED IS THE ONE THIS QUERY RETURNS — never one the client sent.
 * That is what stops a request naming a real college id and an invented name
 * from writing the invented name into athlete_programmes.
 *
 * Sport is part of the lookup, not checked afterwards, because (name, sport)
 * is the identity: selecting a men's-soccer row for a women's-soccer athlete
 * is a miss, not a mismatch to be repaired.
 */
export function findCanonicalCollege({ collegeId, sport, includeInactive = false } = {}) {
  const id = typeof collegeId === 'string' ? collegeId.trim() : '';
  const sportValue = typeof sport === 'string' ? sport.trim() : '';
  if (!id || !sportValue) return null;

  const row = db.prepare(`
    SELECT c.id, c.name, c.sport, c.division, c.conference, c.city, c.state, c.active
      FROM colleges c
     WHERE c.id = @id AND c.sport = @sport
  `).get({ id, sport: sportValue });

  if (!row) return null;
  if (!includeInactive && row.active === 0) return null;
  return row;
}

export const SEARCH_LIMITS = Object.freeze({
  MIN_QUERY_LENGTH,
  DEFAULT_LIMIT,
  MAX_LIMIT,
});
