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
 * V1 AND V2 DIGESTS ARE NOT COMPARABLE, and the report says UNCOMPARABLE rather
 * than FAIL when it meets one across the boundary. They describe different
 * questions about the data; a number computed for one is not a wrong answer to
 * the other, it is an answer to something else.
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
 */
export const MANIFEST_VERSION = 'V3';

/** The last version before `roster_freshness`, kept so a V1 pin is nameable. */
export const LEGACY_MANIFEST_VERSION = 'V1';

/**
 * The tables `buildBaselines` reads, and only those.
 *
 * Found by instrumenting `db.prepare` across a full walk, not by reading
 * imports: `programme_seasons`, `conference_seasons`, `institution_aliases` and
 * the outreach tables were all plausible and none of them is touched. A
 * manifest that fingerprinted them would report CHANGED for data no baseline
 * can see, which is the same defect pointing the other way.
 */
export const MANIFEST_TABLES = Object.freeze([
  'players',
  'colleges',
  'roster_players',
  'coaches',
  'athletics_domains',
  'recruiting_arrivals',
  'coach_seasons',
]);

/**
 * One table, every column, order-independent.
 *
 * `rows` and `columns` travel with the digest so a DATASET CHANGED report can
 * say what moved before anyone opens a database.
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
export function buildBaselines() {
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
    decision.push(`${key}|${canonical({
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
    composition.push(`${key}|${canonical({
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
    body.push(`${key}|${canonical({
      source: rendered.source ?? null, structure: rendered.structure ?? null, body: rendered.body,
    })}`);

    /* 4. OPERATOR_WIRE — what the panel is handed. */
    let sent;
    try { sent = toWire(ev); } catch (err) { sent = { error: err.message }; }
    wire.push(`${key}|${canonical(sent)}`);

    /* 5. LOG_PAYLOAD — what we record about the email we sent. */
    log.push(`${key}|${canonical(evidenceLogPayload(ev))}`);

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
    operator.push(`${key}|${canonical(opv)}`);

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
