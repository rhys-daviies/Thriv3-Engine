import crypto from 'node:crypto';
import db from '../db/client.js';
import { trustedRosterPredicate } from '../../shared/roster/seasonTrust.js';

/**
 * L7ZL — whether `recruiting_arrivals` still describes the roster it was built
 * from.
 *
 * `recruiting_arrivals` is MATERIALISED. `buildRecruitingHistory.js` reads
 * `roster_players` for a sport, computes every arrival, deletes that sport's
 * rows and writes them back. Nothing has ever recorded WHICH roster it read,
 * so nothing could tell whether the answer it serves is still the answer the
 * data supports.
 *
 * ---------------------------------------------------------------------------
 * THE INVARIANT THIS EXISTS FOR. Once a programme-season is
 * EXCLUDE_FROM_EVIDENCE, no roster-derived intelligence may keep consuming a
 * materialised representation derived from that season. Raw roster reads honour
 * an exclusion immediately — `philosophyQueries` appends the trust predicate —
 * so without this the product would hold two different truths at once: a season
 * removed from the ladder and still present in the arrivals behind
 * ARRIVAL_SAME_COUNTRY_POSITION, which is outreach-licensed and reaches email.
 *
 * ---------------------------------------------------------------------------
 * THREE STATES, AND THE THIRD IS THE HONEST ONE.
 *
 *   FRESH               the digest of the effective input matches what the
 *                       build recorded. Reads proceed.
 *   STALE               it does not. Reads REFUSE — see `recruitingPatterns`.
 *   LEGACY_UNVERIFIED   no build metadata exists at all, because the build
 *                       predates this mechanism. Reads proceed, exactly as they
 *                       did before; the state is reported rather than hidden,
 *                       and an exclusion is REFUSED while it holds.
 *
 * The third state is deliberate and follows L7ZK's `LEGACY_UNATTRIBUTED`
 * precedent: absence means "predates the rule", is named, and is never silently
 * treated as compliance. Stamping the existing table as FRESH would have been a
 * lie — L7ZL measured the live materialisation as 1,430 arrivals behind the
 * roster — and refusing every read on a state that has been the status quo for
 * months would take working product down to make a point.
 *
 * What it buys is the invariant: an exclusion cannot be written while the
 * derived data is unverifiable, so the only route to an exclusion is a rebuild,
 * and after a rebuild every subsequent divergence fails closed.
 */

export const FRESH = 'FRESH';
export const STALE = 'STALE';
export const LEGACY_UNVERIFIED = 'LEGACY_UNVERIFIED';

/**
 * Bumped when the TRANSFORMATION changes, not when the data does.
 *
 * A digest over inputs cannot see a change to `arrivalsFor`. Two builds of the
 * same roster by different code are different answers, and the stamp has to say
 * which code produced it.
 */
export const BUILDER_VERSION = 'L7ZL/arrivals/v1';

/**
 * The EFFECTIVE input, which is the semantic one.
 *
 * Not `roster_players` and `roster_season_trust` fingerprinted separately: what
 * decides the arrivals is the roster the builder can actually read, and that is
 * the roster with excluded programme-seasons removed. Fingerprinting the
 * effective set is what makes the other two properties fall out for free —
 *
 *   a DIAGNOSIS changes no row of it, so it cannot stale anything
 *   a RETAIN changes no row of it either, because RETAIN and absence are the
 *     same instruction to Evidence, and a rebuild for an audit note would be
 *     work with no product meaning
 *   an EXCLUSION removes rows from it, so it stales immediately
 *
 * Columns are the ones `arrivalsFor` actually consumes. `updated_date` is
 * excluded on purpose, for the reason L7D established: a re-scrape that only
 * moves timestamps is not a change to what the data says, and a fingerprint
 * that flapped on it would train people to rebuild without reading.
 *
 * `coach_seasons` is included because coach attribution is a real input —
 * `COACH_ARRIVAL_SAME_COUNTRY` is built from it, and a coach correction changes
 * the answer without touching a roster row.
 */
const ROSTER_INPUT = `college_name, sport, season, player_name, class_year_label,
  position, nationality, country, hometown, prior_programme`;

/**
 * A cheap CHANGE TEST over the database, used only to decide whether the
 * expensive digest needs recomputing in this process.
 *
 * `loadProgrammePatterns` is called once per programme on the Evidence path, and
 * the full digest hashes ~130,000 roster rows. Recomputing it per call took a
 * report past a two-minute timeout — caught by `operations.test.js`, which runs
 * the real CLI.
 *
 * The first cache key here counted rows and took MAX(updated_date). It was
 * WRONG TWICE, and both ways are worth keeping written down. `updated_date`
 * carries no index, so MAX() full-scans the table — 76ms a call, ~91 seconds
 * across a sweep, which meant the cache key WAS the timeout it existed to
 * avoid. And counters are not a change test: an UPDATE correcting a player's
 * position moves no count and no timestamp, so the cache would have gone on
 * certifying a digest for a roster that had changed underneath it.
 *
 * SQLite answers both questions properly, in O(1):
 *
 *   data_version     moves when ANOTHER connection commits. The importers and
 *                    the builder are separate processes, so this is how a
 *                    long-running reader learns its input moved.
 *   total_changes()  rows THIS connection has changed. data_version is
 *                    documented not to move for one's own writes, and an
 *                    exclusion written in-process has to stale immediately.
 *
 * Both over-invalidate — any commit anywhere drops the cache — which is the
 * right direction to be wrong in, and needs no writer to remember to call an
 * invalidator. A cache correct only while everybody remembers is the same
 * shape of promise L7ZK refused.
 */
const localChanges = db.prepare('SELECT total_changes() AS n').pluck();

function changeToken() {
  return `${db.pragma('data_version', { simple: true })}:${localChanges.get()}`;
}

const digestCache = new Map();   // sport -> { token, digest }

export function effectiveInputDigest(sport) {
  const token = changeToken();
  const hit = digestCache.get(sport);
  if (hit && hit.token === token) return hit.digest;
  const digest = computeEffectiveInputDigest(sport);
  digestCache.set(sport, { token, digest });
  return digest;
}

function computeEffectiveInputDigest(sport) {
  const roster = db.prepare(
    `SELECT ${ROSTER_INPUT} FROM roster_players
      WHERE sport = ? AND ${trustedRosterPredicate('roster_players')}`,
  ).all(sport);
  const coaches = db.prepare(
    'SELECT school, season, coach_name, reason FROM coach_seasons WHERE sport = ?').all(sport);

  const h = crypto.createHash('sha256');
  h.update(`${BUILDER_VERSION}\n`);
  for (const line of roster.map((r) => JSON.stringify(Object.keys(r).sort().map((k) => r[k] ?? null))).sort()) {
    h.update(line); h.update('\n');
  }
  h.update('--coaches--\n');
  for (const line of coaches.map((r) => JSON.stringify(Object.keys(r).sort().map((k) => r[k] ?? null))).sort()) {
    h.update(line); h.update('\n');
  }
  return h.digest('hex');
}

const selectBuild = db.prepare('SELECT * FROM recruiting_arrivals_build WHERE sport = ?');

/** What the last build of this sport recorded, or null if it predates L7ZL. */
export function buildRecordFor(sport) {
  return selectBuild.get(sport) ?? null;
}

/**
 * Whether this sport's materialisation may be served, and why.
 *
 * Returns `{ state, sport, expected, actual, builtAt, generation }`. Callers
 * must distinguish STALE from "no arrivals" — see `recruitingPatterns`, where a
 * stale read raises rather than returning an empty result that would read as
 * "this programme has no recruiting history".
 */
export function materialisationState(sport) {
  const rec = buildRecordFor(sport);
  const actual = effectiveInputDigest(sport);
  if (!rec) {
    return { state: LEGACY_UNVERIFIED, sport, expected: null, actual,
      builtAt: null, generation: null };
  }
  return {
    state: rec.input_digest === actual ? FRESH : STALE,
    sport,
    expected: rec.input_digest,
    actual,
    builtAt: rec.built_at,
    generation: rec.generation,
  };
}

/**
 * Stamp a completed build. MUST be called inside the same transaction that
 * wrote the rows.
 *
 * Atomicity is the whole point: if the data and its stamp could commit
 * separately, a crash between them would leave a materialisation that claims to
 * be fresh and is not — which is exactly the failure this module exists to make
 * impossible. `buildRecruitingHistory.js` calls this inside its
 * `db.transaction`, so either both land or neither does.
 */
export function recordBuild({ sport, digest, now = new Date() }) {
  const prev = buildRecordFor(sport);
  db.prepare(`INSERT INTO recruiting_arrivals_build
      (sport, input_digest, builder_version, built_at, generation)
      VALUES (@sport, @input_digest, @builder_version, @built_at, @generation)
    ON CONFLICT(sport) DO UPDATE SET
      input_digest = excluded.input_digest,
      builder_version = excluded.builder_version,
      built_at = excluded.built_at,
      generation = excluded.generation`).run({
    sport,
    input_digest: digest,
    builder_version: BUILDER_VERSION,
    built_at: now.toISOString(),
    generation: (prev?.generation ?? 0) + 1,
  });
}

/** A stale read, raised rather than returned, so it cannot be mistaken for empty. */
export class StaleMaterialisationError extends Error {
  constructor(state) {
    super(`recruiting_arrivals for ${state.sport} is stale: it was built from a different roster `
      + `than the one Evidence now reads. Rebuild with \`npm run build:recruiting\`.`);
    this.name = 'StaleMaterialisationError';
    this.code = 'MATERIALISATION_STALE';
    this.sport = state.sport;
    this.expected = state.expected;
    this.actual = state.actual;
    this.builtAt = state.builtAt;
  }
}
