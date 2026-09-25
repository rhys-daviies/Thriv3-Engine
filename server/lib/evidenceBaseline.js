import { createHash } from 'node:crypto';
import { SQUAD_SEASON } from '../../shared/philosophy.js';
import db from '../db/client.js';
import { evidenceFor } from './evidenceQueries.js';
import { evidenceLogPayload } from '../../shared/evidence/index.js';
import { toWire } from '../routes/evidence.js';
import { wireOperatorEvidence } from '../routes/operatorEvidence.js';
import { operatorEvidenceFor } from '../../shared/evidence/operatorEvidence.js';
import { emailBodyFor } from '../../src/lib/emailTemplate.js';

/**
 * THE BEHAVIOURAL FINGERPRINTS PROTECTING COACH-FACING EVIDENCE.
 *
 * Every stage from F to H proved its changes safe by hashing the outbound
 * corpus before and after. Not one of those hashes lived in the repository:
 * the harness was written in a scratchpad, the constant was quoted in a brief,
 * and by H17 neither could be reproduced — the harness was gone and the
 * dataset had moved under it. H17 could still prove before/after equality by
 * rebuilding a harness and running it on both sides, but nobody else could
 * check that claim, and the constants in the earlier briefs were unverifiable.
 *
 * That is what this module fixes. One command, one corpus definition, one
 * serialization, committed expectations, and a dataset fingerprint beside them
 * so a moved hash says which of the two things moved.
 *
 *   npm run evidence:baseline              the table
 *   npm run evidence:baseline -- --json    the same, for CI
 *   npm run evidence:baseline -- --update  rewrite the expectations, explicitly
 *
 * ---------------------------------------------------------------------------
 * A HASH WITHOUT A DATASET IDENTITY IS A NUMBER, NOT A BASELINE.
 *
 * The older 3,498-pair corpus is the clearest case. It was three men's-soccer
 * athletes against 1,166 programmes; there are 1,169 now, so the same
 * definition produces 3,507 today. Nine pairs of drift, invisible, and every
 * hash taken over that corpus silently incomparable. `datasetManifest` is
 * checked first for exactly this reason: DATASET CHANGED is a different
 * message from a product regression and must never be reported as one.
 */

/* -------------------------------------------------------------------------- */
/* Canonical serialization                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A value as one deterministic string.
 *
 * Object keys are sorted at every depth, so two objects built by different
 * code paths in different key orders hash the same. Arrays are NOT sorted:
 * order is meaning here — the order claims were selected in, the order
 * sentences appear in the email — and sorting it away would hide the regression
 * most worth catching. Callers that hold an unordered COLLECTION sort it
 * themselves, once, where the ordering rule can be stated.
 *
 * `undefined` is normalised to null so a field that stops being set moves the
 * hash rather than vanishing from the serialization.
 */
export function canonical(value) {
  const walk = (v) => {
    if (v === undefined) return null;
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Map) return { __map: [...v.entries()].sort().map(([k, x]) => [k, walk(x)]) };
    if (v instanceof Set) return { __set: [...v].sort() };
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, walk(v[k])]));
  };
  return JSON.stringify(walk(value));
}

/**
 * Fields a behavioural baseline must not hash, because they are observations
 * of WHEN we looked rather than statements about what is true.
 *
 * There is exactly one, and it earned its place by measurement rather than by
 * argument. L7D imported 85 roster rows and moved OPERATOR_WIRE and LOG_PAYLOAD
 * for 3,584 pairs — every one of them differing in `rosterUpdatedAt` and
 * nothing else, because the import re-stamps `updated_date` on all 1,926
 * programmes whether or not a single player changed. Two of the six surfaces
 * could therefore never be stable across a refresh, which makes them useless
 * for the thing they exist to detect.
 *
 * THIS IS NOT "REMOVE THE FIELD UNTIL THE TEST PASSES". The timestamp reaches
 * behaviour, and it still does: `rosterFreshness` turns it into a `state`, an
 * `ageDays` and a `reason`, and `applyFreshness` reads the STATE to suppress or
 * downgrade evidence. Those derived values stay hashed, in full. What is
 * dropped is only the raw instant they were derived from.
 *
 * Measured both ways on the real corpus before the change:
 *
 *   +37 seconds on all 58,270 roster rows — a shift that cannot cross a day
 *   boundary — moved OPERATOR_WIRE and LOG_PAYLOAD and nothing else. Personalised
 *   pairs 1,758 either way.
 *
 *   -400 days on the same rows — enough to turn CURRENT into STALE — moved all
 *   six surfaces and took personalisation from 1,758 to 1,284.
 *
 * So the effect of freshness is still fully visible and only the clock reading
 * is gone. K3A fixed the other half of this: `BASELINE_NOW` pins `now`, and
 * this pins the other input to the same subtraction.
 *
 * Runtime is untouched. The panel, the wire and the log all still carry the
 * real timestamp; `projectBehavioural` runs in the baseline harness alone.
 */
export const NON_BEHAVIOURAL_FIELDS = Object.freeze(['rosterUpdatedAt']);

/**
 * `canonical`, with observation instants removed.
 *
 * Applied to all six surfaces rather than the two that carry the field today,
 * so a payload that starts reporting when it was scraped does not quietly
 * reintroduce the problem. `baselineFieldSites` below keeps that honest by
 * reporting where the field is actually found, and a test asserts the set.
 */
export function projectBehavioural(value) {
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Map || v instanceof Set) return v;
    const out = {};
    for (const k of Object.keys(v)) {
      if (NON_BEHAVIOURAL_FIELDS.includes(k)) continue;
      out[k] = walk(v[k]);
    }
    return out;
  };
  return canonical(walk(value));
}

/** Every path at which a non-behavioural field appears in a payload. Diagnostic. */
export function nonBehaviouralSites(value, surface = '') {
  const found = [];
  const walk = (v, path) => {
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    for (const k of Object.keys(v)) {
      const at = path ? `${path}.${k}` : k;
      if (NON_BEHAVIOURAL_FIELDS.includes(k)) found.push(surface ? `${surface}::${at}` : at);
      else walk(v[k], at);
    }
  };
  walk(value, '');
  return found;
}

/** SHA-256, full. Display truncates; comparison never does. */
export const digest = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/** For a table or a log line. The full digest is what is stored and compared. */
export const short = (d) => String(d).slice(0, 16);

/* -------------------------------------------------------------------------- */
/* The dataset this baseline describes                                         */
/* -------------------------------------------------------------------------- */

/**
 * The tables the outbound evidence path reads, and nothing else.
 *
 * Deliberately not "every table": a change to `outreach_log` or `suppressions`
 * cannot move an evidence hash, and including them would make the manifest
 * flap on ordinary operational writes. Each is fingerprinted by its row count
 * and by a digest of its identifying columns in a stated order — enough to
 * catch a re-import, a roster refresh or a new programme, which are the
 * changes that move product hashes for reasons that are not code.
 */
/**
 * The manifest's definition, versioned because it changed once and will again.
 *
 * V1 fingerprinted five tables by their identifying columns. V2 adds
 * `roster_freshness`, because K3A found a behavioural input the five did not
 * cover: `rosterUpdatedAt` reads `updated_date`, which V1 never looked at, so a
 * re-scrape that only rewrote timestamps would move three behavioural hashes
 * while the dataset line still read UNCHANGED — the precise misdiagnosis the
 * manifest exists to prevent.
 *
 * V3 adds `programme_status`, for the same reason one version later. L7O found
 * that `colleges.active` is absent from the `colleges` fingerprint, which was
 * harmless while it was a dormant flag nothing read. `programme_status` is not
 * dormant: it decides which programmes are eligible destinations for a season,
 * so live matching and outreach change when it changes. A behavioural hash that
 * moved while the dataset line read UNCHANGED is precisely what the manifest
 * exists to prevent.
 *
 * V4 adds `roster_measurements`, for the same reason two versions later, and
 * this time the gap was demonstrated rather than reasoned about. L7ZA changed
 * 1,762 historical rows' `minutes_played` and nothing else — no player added,
 * removed or renamed — and watched PROGRAMME_POOL_BENCHMARK move while BOTH
 * roster components reported UNCHANGED. The `roster_players` line projects
 * `(college_name, sport, season, player_name)`, which is membership, and
 * `roster_freshness` watches the CURRENT season's timestamps. A historical
 * measurement appears in neither, so a behavioural hash could move with the
 * dataset line saying nothing happened — the same misdiagnosis K3A found for
 * timestamps and L7O found for programme status, in the field the Philosophy
 * kinds are actually computed from.
 *
 * The two roster components are kept APART rather than merged. "The squad
 * changed" and "the same squad, measured differently" are different events with
 * different causes, and a single digest covering both would answer neither.
 *
 * V5 adds `roster_season_trust`, and it is the first component added BEFORE the
 * gap could be demonstrated rather than after. L7ZI introduced a table whose
 * `disposition` decides whether Evidence reads a programme-season at all, so a
 * single row written there would change what every roster-derived kind
 * computes while all four roster components reported UNCHANGED — they
 * fingerprint `roster_players`, and an exclusion changes nothing in it.
 *
 * The version moved even though production holds ZERO trust rows. That is the
 * point of versioning the DEFINITION rather than the data: a V4 digest was
 * taken over a table list that could not see this input, and a V4 digest taken
 * now would claim to answer the same question while answering a different one.
 * The manifest pin therefore moves in a stage where no product data moved at
 * all, and the behavioural baselines correctly do not.
 *
 * SUCCESSIVE VERSIONS ARE NOT COMPARABLE WITH EACH OTHER, and the report says
 * UNCOMPARABLE rather than FAIL when it meets one across a boundary. They
 * describe different questions about the data; a number computed for one is not
 * a wrong answer to the other, it is an answer to something else. Bumping the
 * version is what keeps that honest — a V2 pin and a V2 digest taken over a
 * different table list would both claim to be V2 and mean different things.
 */
/**
 * ---------------------------------------------------------------------------
 * V2 → V3: EVERY COLUMN OF EVERY TABLE THE WALK READS — D3.3.
 *
 * V2's premise was that a named projection of "identifying columns" describes
 * the dataset. D3.3 disproved it twice over, by measurement rather than
 * reading, and the second one is what cost a baseline its provenance:
 *
 *   TWO TABLES WERE MISSING ENTIRELY. Instrumenting `buildBaselines` — every
 *   prepared statement it executes — shows the walk reads SEVEN tables. V2
 *   fingerprinted five. `recruiting_arrivals` is queried once per pair (4,742
 *   times) and `coach_seasons` 3,963 times, and neither was in the manifest.
 *   Changing 181 arrival rows moves EMAIL_BODY while the dataset line still
 *   reads UNCHANGED. That is exactly how the historical EMAIL_BODY pin became
 *   unreproducible: it was taken over rows the manifest could not see, so the
 *   digest recorded beside it was not an identity for the data that produced
 *   it.
 *
 *   AND THE PROJECTIONS WERE TOO NARROW. Nulling the roster_players columns V2
 *   did not name — position, nationality, hometown, country, class_year_label,
 *   the minutes — moves all six baselines with the dataset line unchanged.
 *
 * COLUMN MATERIALITY CANNOT BE PREDICTED BY NAME, which is the finding that
 * settles the design. `roster_row_id` looks like a join key and is inert.
 * `built_at` and `imported_at` look like provenance timestamps and move all six
 * hashes. Any hand-picked projection is a guess, and a guess that is wrong in
 * the omitting direction is silent.
 *
 * So V3 fingerprints EVERY column of every table the walk actually reads, and
 * nothing else. The seven are not a guess either — they are what the
 * instrumentation found.
 *
 * WHY THE FALSE-POSITIVE ARGUMENT NO LONGER APPLIES. V2 stayed narrow because a
 * manifest that reports CHANGED constantly teaches people to repin without
 * reading, and it was reading the working database, which moved daily. D3.2
 * made the input an immutable pinned snapshot. A maximally sensitive manifest
 * over a fixture that only changes when somebody deliberately re-pins it
 * produces no noise at all — it speaks exactly once, when the dataset really is
 * a different dataset.
 *
 * ORDERING CANNOT CHANGE A DIGEST. Each row is hashed on its own and the row
 * hashes are sorted before the table hash is taken, so the fingerprint is a
 * property of the SET of rows. No ORDER BY to get right, and a VACUUM, a
 * rebuild or a different query plan cannot move it. Column names are sorted for
 * the same reason: physical column order is not data.
 *
 * V2 AND V3 DIGESTS ARE NOT COMPARABLE. The version carries that, and
 * `compareBaselines` reports DEFINITION_CHANGED rather than CHANGED.
 *
 * ---------------------------------------------------------------------------
 * V3 -> V7: THE SAME METHOD OVER A LARGER PRODUCT - L8B-3.
 *
 * The two branches reached this design independently and agree on it. What
 * differs is only how many tables the walk had to read, and that difference is
 * fully accounted for: main's instrumentation found SEVEN because seven is all
 * that existed there. `roster_season_trust`, `programme_status` and
 * `recruiting_arrivals_build` are created by the Evidence branch and by no
 * other, so main could not have measured them. Seven plus those three is the
 * ten below, re-measured on the merged tree by `npm run closure` rather than
 * assumed from the arithmetic.
 *
 * The intervening versions are Evidence-side: V4 added `roster_season_trust`,
 * V5 and V6 closed two holes L7ZP made visible, and V7 is this - main's
 * every-column `tableFingerprint` applied to the measured ten.
 */
export const MANIFEST_VERSION = 'V7';

/*
 * L8B-2 — V7: EVERY COLUMN OF EVERY TABLE THE SIX OUTPUTS EXECUTE AGAINST.
 *
 * V6 named columns. That is a guess, and L8B-1 measured the guess being wrong:
 * tampering with `recruiting_arrivals_build.input_digest` moved ALL SIX
 * behavioural baselines — `assertServable` gates every recruiting claim on it —
 * while V6 reported the dataset UNCHANGED. The table had been excluded as
 * "operational metadata" on the strength of what it looked like.
 *
 * `main` reached the same conclusion independently at V3, and its wording is
 * the rule: a hand-picked projection is a guess, and a guess that is wrong in
 * the omitting direction is silent. V7 adopts main's `tableFingerprint`
 * verbatim and applies it to a table set that is a MEASUREMENT rather than a
 * choice — the execution closure of `buildBaselines`, instrumented at the
 * statement level rather than at prepare, because modules prepare statements at
 * import whether or not they run.
 *
 * WHAT THIS COSTS, AND WHY IT IS FREE HERE. Every-column hashing moves for
 * `updated_date`, `roster_row_id` and `built_at` — churn that no behavioural
 * output reflects. On a LIVE corpus that is noise, and noise teaches people to
 * repin without reading. Acceptance therefore runs against a PINNED IMMUTABLE
 * snapshot, where nothing writes and the churn cannot occur. The two decisions
 * are one decision: every-column is safe only with a pinned corpus, and a
 * pinned corpus makes every-column free.
 *
 * `roster_freshness` survives below as a DIAGNOSTIC line, exactly as main keeps
 * it: subsumed by the full `roster_players` fingerprint, still useful in a
 * report that has to say what moved.
 */

/*
 * L7ZQ — V6 CLOSES TWO HOLES L7ZP MADE VISIBLE.
 *
 * L7ZP rebuilt `recruiting_arrivals`, moved all six behavioural baselines, and
 * left this digest EXACTLY where it was. That breaks the one promise the
 * manifest makes: if data capable of changing behaviour changes, dataset
 * identity changes with it. Two independent causes, both demonstrated by
 * mutating one field against a fixture and watching:
 *
 *   SOURCE_INPUT_MISSING          `coach_seasons` is read straight into
 *                                 Evidence by `philosophyQueries` and reaches
 *                                 coach tenure and arrival attribution. V5
 *                                 carried `coaches`, which is a different
 *                                 table. Renaming coaches moved all six
 *                                 baselines with V5 unchanged.
 *
 *   DERIVED_STATE_NOT_IDENTIFIED  `recruiting_arrivals` is materialised, and
 *                                 V5 saw only its inputs. Deleting a season of
 *                                 it moved all six baselines with V5 unchanged
 *                                 — AND with the L7ZL freshness state still
 *                                 reporting FRESH, because that fingerprint
 *                                 covers what the table was built FROM and
 *                                 never what it now CONTAINS.
 *
 * The second point is why the freshness fingerprint could not simply be
 * borrowed. Freshness answers "does this derived table still match its
 * inputs"; the manifest answers "what data will the product actually read".
 * A table truncated after a successful build satisfies the first and fails the
 * second, so V6 hashes the derived CONTENT rather than trusting a build stamp.
 *
 * Operational fields stay out. `built_at` and the build generation counter are
 * bookkeeping — a rebuild that reproduces identical rows must not move dataset
 * identity, and L7ZP proved rebuilds are deterministic, so they would only add
 * churn.
 */

/** The last version before `roster_season_trust`, kept so a V4 pin is nameable. */
export const LEGACY_MANIFEST_VERSION = 'V4';

/**
 * The execution closure of the six behavioural outputs, measured not chosen.
 *
 * Statement executions during one `buildBaselines` run, L8B-2:
 *   roster_players 18,980 · roster_season_trust 18,973 · coach_seasons 8,738
 *   colleges 4,748 · recruiting_arrivals 4,743 · recruiting_arrivals_build 4,742
 *   players 2 · athletics_domains 2 · coaches 1 · programme_status 1
 *
 * `outreach`, `outreach_send` and `outreach_evidence` are PREPARED at module
 * import and never executed by the walk, so they are not product identity for
 * these outputs. `dependencyClosure.test.js` re-measures this and fails if the
 * walk ever reads a table absent from here.
 *
 * AND ONLY THOSE - main's D3.3 note, still true on the merged tree.
 * `programme_seasons`, `conference_seasons`, `institution_aliases` and the
 * outreach tables were all plausible and none of them is touched. A manifest
 * that fingerprinted them would report CHANGED for data no baseline can see,
 * which is the same defect pointing the other way.
 */
export const MANIFEST_TABLES = Object.freeze([
  'players',
  'colleges',
  'roster_players',
  'roster_season_trust',
  'coaches',
  'athletics_domains',
  'programme_status',
  'coach_seasons',
  'recruiting_arrivals',
  'recruiting_arrivals_build',
]);

/**
 * One table, every column, order-independent — main's V3 semantics verbatim.
 *
 * Column names come from `PRAGMA table_info` and are SORTED, so physical column
 * order is not data and a new column moves the digest automatically. Each row
 * is hashed alone and the row hashes are sorted, so the result is a property of
 * the SET of rows: no ORDER BY to get right, and a VACUUM or a different query
 * plan cannot move it. `rows` and `columns` travel with the digest so a CHANGED
 * report can say what moved before anyone opens a database.
 */
export function tableFingerprint(table) {
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name).sort();
  if (!columns.length) throw new Error(`no such table: ${table}`);
  const rows = db.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${table}"`).all();
  const rowDigests = rows.map((row) => digest(canonical(columns.map((c) => row[c]))));
  rowDigests.sort();
  return {
    table, rows: rows.length, columns: columns.length, digest: digest(canonical(rowDigests)),
  };
}

/**
 * What the dataset is, in one line per table plus one digest over all of it.
 *
 * A missing table is recorded as absent rather than throwing: the manifest's
 * job is to describe what it found, and a schema that has lost a table is
 * information the report should carry, not a crash.
 */
/**
 * Roster freshness, in exactly the unit production reads it.
 *
 * `buildProgrammeContext` calls `latestUpdate(squadRows)`, and `squadRows` is
 * `(college_name, sport)` filtered to `SQUAD_SEASON` — so the behavioural input
 * is one MAX per programme-sport over the CURRENT season, and that is what this
 * fingerprints. Deliberately not every row's raw timestamp: there are ~11,800
 * distinct values across the table, so a full-timestamp digest would flap on
 * any partial re-scrape, and a manifest that reports CHANGED constantly teaches
 * people to repin without reading it.
 *
 * The narrow definition is also the honest one. A historical season's timestamp
 * and a non-max row in the current season do not reach any email, so moving
 * this digest for them would be claiming a behavioural dependency that is not
 * there.
 */
const ROSTER_FRESHNESS_SQL = `
  SELECT college_name, sport, MAX(updated_date) AS latest
  FROM roster_players
  WHERE season = ?
  GROUP BY college_name, sport
  ORDER BY sport, college_name`;

/**
 * Every roster_players field an Evidence generator can actually read.
 *
 * NOT every column. The Evidence path loads roster rows through exactly one
 * projection — `ROSTER_COLUMNS` in server/lib/philosophyQueries.js, used by
 * both `programmeRows` and `squadRows` — so a column absent from it is
 * invisible to every generator by construction. This list is that projection
 * minus `updated_date`, which is a statement about when we looked rather than
 * what is true: `roster_freshness` already fingerprints it in the one form
 * production reads, and hashing it raw here would move this component on every
 * re-import, which is the L7D defect that cost two baselines their usefulness.
 *
 * Deliberately included despite looking like provenance: `source_roster_url`.
 * `rosterSourceFor` in evidenceQueries.js resolves the operator's verification
 * link from it and returns AMBIGUOUS_SOURCE when a programme-season carries
 * more than one, so it changes what an operator is shown. It is a behavioural
 * input that happens to be a URL.
 *
 * Deliberately EXCLUDED: `source_page_season`, `source_fetched_at`,
 * `source_parser` (L7Z), `data_confidence`, `source_stats_url`,
 * `projected_minutes_season`, `division`, `conference`, `notes`. None is in
 * ROSTER_COLUMNS, so no generator can see any of them. They are recorded facts
 * about acquisition, and a manifest that moved for them would report work that
 * changed nothing an athlete or an operator reads.
 */
export const ROSTER_MEASUREMENT_FIELDS = Object.freeze([
  'college_name', 'sport', 'season', 'player_name',
  'position', 'class_year_label',
  'minutes_played', 'games_played', 'games_started',
  'estimated_graduation_year', 'eligibility_end_year', 'projected_minutes',
  'nationality', 'country', 'hometown', 'prior_programme',
  'source_roster_url',
]);

/**
 * One row, reduced to what behaviour can distinguish.
 *
 * Storage representation must not move the hash where production cannot see
 * it. The importer writes numbers through `toIntOrNull` and text through
 * `|| undefined`, so `998`, `'998'` and `'998.0'` are one value to it and `''`
 * is absence — and this normalises to the same, using those semantics rather
 * than inventing new ones. Nothing else is canonicalised: `position` is already
 * stored in production's normalised vocabulary because `normalizePosition`
 * runs at import, and `class_year_label` is carried RAW into philosophy output
 * as `classLabel`, so its exact spelling is itself behavioural.
 */
const NUMERIC_MEASUREMENTS = new Set(['minutes_played', 'games_played', 'games_started',
  'estimated_graduation_year', 'eligibility_end_year', 'projected_minutes']);

export function canonicalMeasurement(field, value) {
  if (value === undefined || value === null) return null;
  if (NUMERIC_MEASUREMENTS.has(field)) {
    if (value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  const s = String(value);
  return s === '' ? null : s;
}

/**
 * The measurements, in an order the database cannot influence.
 *
 * Rows are serialised and then SORTED, so neither SQLite's row order nor an
 * index change can move the digest, and two programme-seasons holding the same
 * player name twice stay distinguishable.
 */
export function rosterMeasurementFingerprint() {
  const rows = db.prepare(
    `SELECT ${ROSTER_MEASUREMENT_FIELDS.join(', ')} FROM roster_players`,
  ).all();
  const lines = rows
    .map((r) => canonical(ROSTER_MEASUREMENT_FIELDS.map((f) => canonicalMeasurement(f, r[f]))))
    .sort();
  return { table: 'roster_measurements', rows: lines.length, digest: digest(lines.join('\n')) };
}

/**
 * The behavioural content of `recruiting_arrivals`, which is DERIVED data.
 *
 * Taken from `toArrival` in `recruitingPatterns.js` — the one function that
 * turns a stored row into the object the aggregations see — so this hashes
 * what the product reads and nothing else. Two columns are deliberately
 * absent, and both would otherwise generate pure noise:
 *
 *   roster_row_id   loaded into the pattern object and consumed by nothing.
 *                   L7ZP measured 24,929 rows differing ONLY here after a
 *                   roster re-import gave the source rows new surrogate ids.
 *                   A manifest that moved for that would cry wolf about a
 *                   change no claim can see.
 *
 *   region          `toArrival` says in its own comment that it does not read
 *                   the stored column, because `patterns.js` recomputes region
 *                   from country so a taxonomy change applies immediately
 *                   rather than at the next rebuild. The stored value is a
 *                   cache, so it is not dataset identity.
 *
 * `id` and `built_at` are excluded for the same reason as any surrogate or
 * timestamp: a deterministic rebuild must not move the digest.
 *
 * Lines are serialised and SORTED, as `rosterMeasurementFingerprint` does, so
 * neither SQLite's row order nor a tie in any ORDER BY can move the result.
 */
export const ARRIVAL_SEMANTIC_FIELDS = Object.freeze([
  'programme', 'sport', 'arrival_season', 'prior_season', 'source_transition',
  'player_name', 'name_key', 'arrival_confidence', 'identity_method', 'reconciled_from',
  'canonical_position', 'nationality_flag', 'country', 'is_international',
  'class_label_raw', 'entry_type',
  'prior_programme', 'prior_confidence', 'prior_candidates',
  'coach', 'coach_attribution',
]);

export function recruitingArrivalsFingerprint() {
  const rows = db.prepare(
    `SELECT ${ARRIVAL_SEMANTIC_FIELDS.join(', ')} FROM recruiting_arrivals`,
  ).all();
  const lines = rows.map((r) => canonical(ARRIVAL_SEMANTIC_FIELDS.map((f) => r[f] ?? null))).sort();
  return { table: 'recruiting_arrivals', rows: lines.length, digest: digest(lines.join('\n')) };
}

export function rosterFreshnessFingerprint() {
  const rows = db.prepare(ROSTER_FRESHNESS_SQL).all(SQUAD_SEASON);
  return { table: 'roster_freshness', rows: rows.length, digest: digest(canonical(rows)) };
}

export function datasetManifest() {
  const tables = [];
  for (const name of MANIFEST_TABLES) {
    try { tables.push(tableFingerprint(name)); }
    catch (err) {
      tables.push({ table: name, rows: null, columns: null, digest: null, error: err.message });
    }
  }
  /**
   * Kept from V2, and now a DIAGNOSTIC rather than the only cover.
   *
   * V3's full `roster_players` fingerprint already includes `updated_date`, so
   * this component no longer closes a gap. It stays because it names the thing
   * the product actually reads — one MAX per programme-sport over the current
   * season — so a report can distinguish "the squad rows moved" from "the
   * freshness the emails quote moved" without a second investigation.
   */
  try { tables.push(rosterFreshnessFingerprint()); }
  catch (err) { tables.push({ table: 'roster_freshness', rows: null, digest: null, error: err.message }); }
  return { version: MANIFEST_VERSION, tables, digest: digest(canonical(tables)) };
}

/* -------------------------------------------------------------------------- */
/* The corpus                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every athlete against every programme in that athlete's own sport.
 *
 * WHY ALL PAIRS AND NOT A SAMPLE. The rare states are the ones worth
 * protecting: 22 CURRENT_SAME_COUNTRY renders and 29
 * ARRIVAL_SAME_COUNTRY_POSITION renders across the whole corpus, and any
 * sampling rule that is not "everything" is a rule about which regressions we
 * are willing to miss.
 *
 * WHY BOTH SPORTS. Cross-sport is not a pairing anyone would send — an
 * athlete is only ever matched within their sport — so the corpus is the union
 * of the per-sport products, not their cross product. The men's-only subset
 * earlier stages used is still derivable: it is the rows whose sport is
 * mens-soccer, and the report prints the split.
 *
 * Ordering is stated by the queries, not inherited from the database.
 */
export function canonicalCorpus() {
  const pairs = [];
  for (const athlete of db.prepare('SELECT * FROM players ORDER BY id').all()) {
    const sport = athlete.sport ?? 'mens-soccer';
    for (const college of db.prepare('SELECT name FROM colleges WHERE sport = ? ORDER BY name').all(sport)) {
      pairs.push({ athlete, sport, college: college.name });
    }
  }
  return pairs;
}

/* -------------------------------------------------------------------------- */
/* The baselines                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A profile URL is per-send and per-environment.
 *
 * The body is hashed with this fixed value substituted, so a token rotation or
 * a different APP_URL does not read as a change to what the email says. That
 * is the only transport concern normalised away — the compliance footer, the
 * greeting and every evidence sentence are content and are hashed as they are.
 */
const FIXED_PROFILE_URL = 'https://baseline.invalid/p/FIXED';

/**
 * The instant this baseline is taken at. A CONSTANT, and it must stay one.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS FIXES, because it cost three baselines their entire life.
 *
 * `rosterUpdatedAt` — the newest `updated_date` on a programme's squad rows —
 * feeds `rosterFreshness(updatedAt, now)`, which returns `ageDays` and a
 * `reason` with that number written into it. `toWire`, `evidenceLogPayload`
 * and `wireOperatorEvidence` each carry the whole `programme` block, so all
 * three had a day counter inside the bytes being hashed.
 *
 * OUTBOUND_DECISION, COACH_COMPOSITION and EMAIL_BODY project a named field
 * list that never included it, which is the only reason they were stable and
 * the reason the split looked mysterious rather than obvious.
 *
 * So the three pins were correct when written and wrong the next morning. H18
 * pinned them at bb1248a and they failed by the following day; J8 repinned
 * them at 5ac8107 and they failed about two hours later, when Akron's roster
 * crossed from nine days old to ten. Both eras were reproduced exactly by
 * rerunning that same code with the clock frozen to the commit's own
 * timestamp — which is what proved this rather than argued it.
 *
 * ---------------------------------------------------------------------------
 * WHY A FIXED CLOCK AND NOT A FIELD STRIPPED OUT.
 *
 * Freshness is not decoration. `state` decides whether CURRENT evidence is
 * suppressed at all, and `seasonIsBehind` flips every programme's context in
 * January. Deleting the fields would blind the baseline to a real product
 * change; pinning the clock keeps every one of them under the hash and makes
 * the whole thing a pure function of code and data. Same argument, and the
 * same shape, as FIXED_PROFILE_URL above.
 *
 * MOVING THIS CONSTANT MOVES EVERY BASELINE, deliberately: it is a statement
 * about which day the corpus is being read on, and that is a product-relevant
 * fact, not a detail. Chosen as the UTC midnight before the H18 pins so the
 * fixed reading sits in the same freshness band those baselines were born in.
 */
export const BASELINE_NOW = Date.parse('2026-09-06T00:00:00Z');

/**
 * Five fingerprints, each for a boundary the others cannot see.
 *
 * They are layered, and the layering is the diagnostic: a change that moves
 * OUTBOUND_DECISION and everything downstream is a selection change; one that
 * moves COACH_COMPOSITION but not OUTBOUND_DECISION is wording or placement;
 * one that moves EMAIL_BODY alone is the template. Reading which subset moved
 * localises the change before anyone opens a diff.
 */
/**
 * @param {{ withLines?: boolean }} [opts] — `withLines` also returns the raw
 *   per-pair corpus lines behind each digest.
 *
 * L7ZN. A digest says THAT a surface moved; only the lines say WHICH pairs and
 * WHAT about them. L7ZM had to report four moved baselines with no way to
 * sample a single changed pair, and "probably the projection" is not an
 * explanation. Off by default because the lines are large and nothing in the
 * normal path wants them.
 */
export function buildBaselines({ withLines = false } = {}) {
  const decision = []; const composition = []; const body = [];
  const wire = []; const log = []; const operator = [];
  const stats = {
    pairs: 0, personalised: 0, generic: 0, sentences: 0, held: 0,
    structures: {}, renderedByKind: {},
  };
  /**
   * WHAT WE RECORD MUST BE WHAT THE COACH READ.
   *
   * Counted on the same walk as the hashes, because they answer the same
   * question from two directions: a hash says the output is what it was, and
   * these say the output agrees with the log about itself. The legacy
   * `primary` reported ACADEMIC_FIT as the lead claim of 701 emails that never
   * contained it, which no hash could have caught — both the log and the body
   * were stable, and they were describing different emails.
   *
   * Every one of these is expected to be zero. `held` is NOT among them: a
   * claim the composer capped is correct behaviour and is counted in `stats`.
   */
  const invariants = {
    renderedButNoSentence: 0,
    sentenceButNotRendered: 0,
    sentenceMissingFromTemplate: 0,
    personalisedWithNoEvidenceSentence: 0,
    notPersonalisedWithEvidenceSentence: 0,
    primaryKindNotRendered: 0,
    hookKindNotRendered: 0,
    primaryRoleIsRecognition: 0,
    examples: [],
  };
  const contradiction = (name, key, detail) => {
    invariants[name] += 1;
    if (invariants.examples.length < 20) invariants.examples.push({ name, pair: key, ...detail });
  };

  for (const { athlete, sport, college } of canonicalCorpus()) {
    let ev;
    try { ev = evidenceFor(athlete, college, { sport, now: BASELINE_NOW }); }
    catch (err) {
      // Recorded, not skipped. A pairing that starts throwing is a regression,
      // and a harness that silently drops it would hash the same as before.
      const key = `${athlete.full_name}|${college}`;
      for (const bucket of [decision, composition, body, wire, log, operator]) bucket.push(`${key}|THREW|${err.message}`);
      stats.pairs += 1;
      continue;
    }
    const key = `${athlete.full_name}|${college}`;
    const first = String(athlete.full_name ?? '').split(' ')[0];
    stats.pairs += 1;

    /* 1. OUTBOUND_DECISION — what the outbound selector decided, and why. */
    const roles = ev.roles ?? { hooks: [], relevance: [], recognition: [], alternatives: [] };
    decision.push(`${key}|${projectBehavioural({
      hooks: roles.hooks.map((h) => h.kind),
      relevance: roles.relevance.map((h) => h.kind),
      recognition: roles.recognition.map((h) => h.kind),
      alternatives: (ev.alternatives ?? roles.alternatives ?? [])
        .map((a) => [a.kind, a.role, a.group ?? null, a.supersededBy ?? null]),
      // Dispositions carry the qualification and supersession outcome for every
      // kind the surface saw. Ordered as the selector produced them.
      dispositions: (ev.dispositions ?? []).map((d) => [d.kind, d.disposition, d.reason ?? null, d.supersededBy ?? null]),
      personalised: ev.hasPersonalisation ?? false,
      /**
       * Prefer-relevant state. `engineSelected` is what the engine chose on its
       * own and `operatorSelected` whether a preference was applied;
       * `unavailableRequests` is a preference the send path refused. An offer
       * the panel makes and the send path declines is the H1 defect, and it is
       * only visible if all three travel together.
       */
      engineSelected: ev.engineSelected ?? [],
      operatorSelected: ev.operatorSelected ?? false,
      unavailableRequests: ev.unavailableRequests ?? [],
    })}`);

    /* 2. COACH_COMPOSITION — what the email actually says, and where. */
    const comp = ev.composition ?? {};
    composition.push(`${key}|${projectBehavioural({
      structure: ev.structure?.key ?? null,
      structureSource: ev.structure?.source ?? null,
      sentences: (comp.sentences ?? []).map((s) => [s.order, s.slot, s.kind, s.text]),
      placement: (comp.placement ?? []).map((p) => [p.order, p.kind, p.slot, p.displayed !== false]),
      tokens: comp.tokens ?? {},
      personalised: ev.hasPersonalisation ?? false,
    })}`);

    /* 3. EMAIL_BODY — the coach-facing text, before transport touches it. */
    let rendered;
    try {
      rendered = emailBodyFor(athlete, { name: college }, 'Coach Baseline', {
        evidence: ev, profileUrl: FIXED_PROFILE_URL,
      });
    } catch (err) { rendered = { body: `THREW:${err.message}`, source: null, structure: null }; }
    body.push(`${key}|${projectBehavioural({
      source: rendered.source ?? null, structure: rendered.structure ?? null, body: rendered.body,
    })}`);

    /* 4. OPERATOR_WIRE — what the panel is handed. */
    let sent;
    try { sent = toWire(ev); } catch (err) { sent = { error: err.message }; }
    wire.push(`${key}|${projectBehavioural(sent)}`);

    /* 5. LOG_PAYLOAD — what we record about the email we sent. */
    log.push(`${key}|${projectBehavioural(evidenceLogPayload(ev))}`);

    /**
     * 6. OPERATOR_EVIDENCE — the inspection surface, which is a different
     * payload from `toWire` and the only one carrying `sourceUrl`.
     *
     * DATA-SENSITIVE BY DESIGN. Its provenance links come from
     * `athletics_domains` through the H12/H16 verification gate, so a registry
     * re-scrape moves this hash and no other. That is why the manifest
     * fingerprints that table: without it, a domain import would look like an
     * unexplained evidence regression.
     */
    let opv;
    try { opv = wireOperatorEvidence(operatorEvidenceFor(ev)); }
    catch (err) { opv = { error: err.message }; }
    operator.push(`${key}|${projectBehavioural(opv)}`);

    /* ---- The rendered/recorded invariant, on the objects just built. ---- */
    const logged = evidenceLogPayload(ev);
    const said = new Set((comp.sentences ?? []).map((x) => x.kind));
    const shownKinds = new Set((comp.placement ?? []).filter((p) => p.displayed !== false).map((p) => p.kind));
    for (const k of shownKinds) {
      if (!said.has(k)) contradiction('renderedButNoSentence', key, { kind: k });
    }
    for (const k of said) {
      if (!shownKinds.has(k)) contradiction('sentenceButNotRendered', key, { kind: k });
    }
    const SLOT_TOKEN = { HOOK: 'evidence_hook', RELEVANCE: 'evidence_relevance', RECOGNITION: 'evidence_recognition' };
    for (const line of comp.sentences ?? []) {
      const token = SLOT_TOKEN[line.slot];
      const filled = comp.tokens?.[token];
      // The sentence must be in the token AND the token in the template — a
      // block dropped by `structuredTemplate` would otherwise leave a sentence
      // recorded that no coach could read.
      if (!filled || !filled.includes(line.text) || !(comp.template ?? '').includes(`{{${token}}}`)) {
        contradiction('sentenceMissingFromTemplate', key, { kind: line.kind, slot: line.slot });
      }
    }
    /**
     * Personalisation means an athlete-specific sentence APPEARED.
     *
     * Recognition does not count, and that is a product decision this only
     * enforces: congratulating a programme on its conference title is a
     * courtesy any sender could pay and says nothing about whether this
     * athlete belongs there. `outreachEvidenceFor` owns the rule; the check is
     * that the flag and the email agree about it.
     */
    const personalSentences = (comp.sentences ?? []).filter((x) => x.slot !== 'RECOGNITION');
    if (logged.has_personalisation && personalSentences.length === 0) {
      contradiction('personalisedWithNoEvidenceSentence', key, {});
    }
    if (!logged.has_personalisation && personalSentences.length > 0) {
      contradiction('notPersonalisedWithEvidenceSentence', key, {
        kinds: personalSentences.map((x) => x.kind),
      });
    }
    if (logged.primary_kind && !said.has(logged.primary_kind)) {
      contradiction('primaryKindNotRendered', key, { primary: logged.primary_kind, said: [...said] });
    }
    if (logged.hook_kind && !said.has(logged.hook_kind)) {
      contradiction('hookKindNotRendered', key, { hook: logged.hook_kind, said: [...said] });
    }
    // A congratulation is never why we wrote.
    if (logged.primary_role === 'RECOGNITION') contradiction('primaryRoleIsRecognition', key, {});

    /* Descriptive counts. Not hashed — they are for the report's header. */
    const sentences = comp.sentences ?? [];
    stats.sentences += sentences.length;
    stats.held += (comp.placement ?? []).filter((p) => p.displayed === false).length;
    if (ev.hasPersonalisation) stats.personalised += 1; else stats.generic += 1;
    const sk = ev.structure?.key ?? 'NONE';
    stats.structures[sk] = (stats.structures[sk] ?? 0) + 1;
    for (const s of sentences) stats.renderedByKind[s.kind] = (stats.renderedByKind[s.kind] ?? 0) + 1;
  }

  /**
   * Each corpus line is keyed by athlete and programme, so sorting them makes
   * the digest independent of the order the corpus happened to be walked in
   * while leaving every ordering INSIDE a line — roles, sentences, placement —
   * exactly as the engine produced it.
   */
  const fingerprint = (lines) => digest(lines.slice().sort().join('\n'));

  return {
    manifest: datasetManifest(),
    /** Recorded so a reader can see which clock the hashes were taken at. */
    now: new Date(BASELINE_NOW).toISOString(),
    stats,
    invariants,
    baselines: [
      { name: 'OUTBOUND_DECISION', size: decision.length, digest: fingerprint(decision) },
      { name: 'COACH_COMPOSITION', size: composition.length, digest: fingerprint(composition) },
      { name: 'EMAIL_BODY', size: body.length, digest: fingerprint(body) },
      { name: 'OPERATOR_WIRE', size: wire.length, digest: fingerprint(wire) },
      { name: 'LOG_PAYLOAD', size: log.length, digest: fingerprint(log) },
      { name: 'OPERATOR_EVIDENCE', size: operator.length, digest: fingerprint(operator) },
    ],
    ...(withLines ? { lines: {
      OUTBOUND_DECISION: decision,
      COACH_COMPOSITION: composition,
      EMAIL_BODY: body,
      OPERATOR_WIRE: wire,
      LOG_PAYLOAD: log,
      OPERATOR_EVIDENCE: operator,
    } } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Comparison                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Measured against committed, with the dataset checked first.
 *
 * The order matters. A product hash that moved because someone re-imported a
 * roster is not a regression, and reporting it as one trains people to repin
 * without reading. So `dataset` is its own verdict, and when it is CHANGED
 * every product line is reported as UNCOMPARABLE rather than FAIL.
 */
/** The contradictions that must all be zero. `examples` is diagnostic, not a count. */
export const CONTRADICTION_KEYS = Object.freeze([
  'renderedButNoSentence', 'sentenceButNotRendered', 'sentenceMissingFromTemplate',
  'personalisedWithNoEvidenceSentence', 'notPersonalisedWithEvidenceSentence',
  'primaryKindNotRendered', 'hookKindNotRendered', 'primaryRoleIsRecognition',
]);

export function compareBaselines(expected, actual = buildBaselines()) {
  /**
   * A pin from an older manifest DEFINITION is not a failed comparison.
   *
   * V1 did not look at roster freshness, so its digest answers a different
   * question from V2's. Reporting that as CHANGED would be true but useless —
   * it reads as "the data moved" when what moved is what we count as data. The
   * verdict is its own value so the transition is legible exactly once.
   */
  const expectedVersion = expected?.manifest?.version ?? LEGACY_MANIFEST_VERSION;
  const versionChanged = expectedVersion !== actual.manifest.version;
  const datasetOk = !versionChanged && expected?.manifest?.digest === actual.manifest.digest;
  const byName = new Map((expected?.baselines ?? []).map((b) => [b.name, b]));
  const results = actual.baselines.map((b) => {
    const want = byName.get(b.name);
    if (!want) return { ...b, status: 'NEW', expected: null };
    if (!datasetOk) return { ...b, status: 'UNCOMPARABLE', expected: want.digest };
    if (want.digest !== b.digest) return { ...b, status: 'FAIL', expected: want.digest };
    if (want.size !== b.size) return { ...b, status: 'FAIL', expected: want.digest };
    return { ...b, status: 'PASS', expected: want.digest };
  });
  return {
    dataset: datasetOk ? 'UNCHANGED' : (versionChanged ? 'DEFINITION_CHANGED' : 'CHANGED'),
    manifestVersion: actual.manifest.version,
    manifestVersionExpected: expectedVersion,
    datasetExpected: expected?.manifest?.digest ?? null,
    datasetActual: actual.manifest.digest,
    manifest: actual.manifest,
    /**
     * Which components moved, so a reader is not left diffing eight digests.
     *
     * "The dataset changed" is not an answer anyone can act on. "Roster
     * membership unchanged, roster measurements changed" says where to look,
     * and it is the distinction L7ZB split the two roster components to make.
     * A component absent from the pin is reported as new rather than moved --
     * across a version boundary that is the expected state, not a difference.
     */
    components: actual.manifest.tables.map((t) => {
      const want = (expected?.manifest?.tables ?? []).find((x) => x.table === t.table);
      return {
        table: t.table, rows: t.rows, digest: t.digest,
        status: !want ? 'NEW' : (want.digest === t.digest ? 'unchanged' : 'MOVED'),
        expected: want?.digest ?? null,
      };
    }),
    now: actual.now,
    stats: actual.stats,
    invariants: actual.invariants,
    results,
    /**
     * The invariant counts are part of the verdict, not a footnote. A log that
     * disagrees with the email is a defect whether or not any hash moved.
     */
    invariantsOk: CONTRADICTION_KEYS.every((k) => actual.invariants[k] === 0),
    ok: datasetOk && results.every((r) => r.status === 'PASS')
      && CONTRADICTION_KEYS.every((k) => actual.invariants[k] === 0),
  };
}
