/**
 * L7ZJ — record the measured historical integrity findings, and nothing else.
 *
 *   node server/scripts/recordSeasonTrust.js --dry-run
 *   node server/scripts/recordSeasonTrust.js
 *
 * L7ZG measured two probable duplicate captures and L7ZH thirteen seasons whose
 * identity nothing surviving can establish. L7ZI built somewhere to put that
 * knowledge. This writes it down.
 *
 * ---------------------------------------------------------------------------
 * THE COHORT IS DERIVED, NOT LISTED. Fifteen names typed from a document is a
 * hand-picked cohort wearing a number, and a name that has drifted out of its
 * condition would be carried in forever. Both cohorts are re-derived here by
 * the rule their own audit stated, against the database as it is now, and the
 * run refuses if the shape it finds is not the shape it was told to expect.
 *
 * WHAT IT MAY WRITE: a machine diagnosis, and nothing else.
 *
 * L7ZK made that structural rather than a convention. This file imports no
 * disposition vocabulary, its INSERT names no disposition column, and it
 * therefore cannot produce a human decision of any kind — not an exclusion,
 * and not a RETAIN either. A decision belongs to an authenticated operator
 * through `server/lib/seasonTrustReview.js`, which is the only writer of that
 * half of the record.
 *
 * THE TWO RETAIN ROWS THIS SCRIPT ONCE WROTE ARE GRANDFATHERED. L7ZJ recorded
 * an operator decision for Eastern New Mexico and San Francisco State with a
 * null reviewer, which was this system's honest answer at the time: there was
 * no identity to record and inventing one would have been worse. They remain,
 * readable and marked LEGACY_UNATTRIBUTED. Run against a fresh database this
 * script would now produce their diagnoses alone, and a person would have to
 * decide again — which is the governance rule working rather than a regression.
 */
import crypto from 'node:crypto';
import db from '../db/client.js';
import { SEASONS, SQUAD_SEASON } from '../../shared/philosophy.js';
import { routeClass, nameKey } from './seasonIntegrityAudit.js';
import { DIAGNOSIS, validateTrustRecord } from '../../shared/roster/seasonTrust.js';

/** The turnover threshold, as a detector. Not redefined here — L7Q owns it. */
const GATE = 0.85;
/** What this run expects to find. A mismatch stops it rather than proceeding. */
export const EXPECTED = Object.freeze({ duplicates: 2, unproven: 13 });

const line = (s = '') => console.log(s);

/* -------------------------------------------------------------------------- */
/* Derivation                                                                  */
/* -------------------------------------------------------------------------- */

/** Every programme-season with its squad, route and surviving provenance. */
export function loadProgrammeSeasons() {
  const ps = new Map();
  for (const r of db.prepare(`
    SELECT r.college_name, r.sport, r.season, r.player_name, r.source_roster_url,
           r.source_page_season, c.division
    FROM roster_players r JOIN colleges c ON c.name = r.college_name AND c.sport = r.sport`).all()) {
    const k = `${r.college_name}||${r.sport}||${r.season}`;
    if (!ps.has(k)) {
      ps.set(k, { college_name: r.college_name, sport: r.sport, season: String(r.season),
        division: r.division, names: new Set(), urls: new Map(), rows: 0, pageSeason: 0 });
    }
    const g = ps.get(k);
    g.rows += 1;
    g.names.add(nameKey(r.player_name));
    const u = (r.source_roster_url ?? '').trim();
    g.urls.set(u, (g.urls.get(u) ?? 0) + 1);
    if (r.source_page_season) g.pageSeason += 1;
  }
  for (const g of ps.values()) {
    g.url = [...g.urls.entries()].sort((a, b) => b[1] - a[1])[0][0];
    g.route = routeClass(g.url);
    /*
     * "Something asserts the season" — a season-bearing route OR surviving L7Z
     * page-season provenance. Route shape is not proof the page was truthful
     * (L7ZG found hosts that serve one page for every season route), but it IS
     * an assertion, and neither cohort below is about seasons somebody claimed.
     */
    g.asserts = g.route === 'A_EXPLICIT_SEASON_PATH'
      || g.route === 'B_EXPLICIT_SEASON_QUERY_OR_ARCHIVE'
      || g.pageSeason > 0;
  }
  return ps;
}

const keyOf = (g) => `${g.college_name}||${g.sport}||${g.season}`;

/**
 * L7ZG's rule, unchanged: a resemblance at or above the gate AND an absence of
 * season evidence. TWO SIGNALS, because either alone is wrong — a programme may
 * keep 90% of its squad, and a season nobody can vouch for may still be right.
 */
export function deriveDuplicates(ps) {
  const out = [];
  for (const g of ps.values()) {
    if (!SEASONS.map(String).includes(g.season)) continue;
    const prior = ps.get(`${g.college_name}||${g.sport}||${Number(g.season) - 1}`);
    if (!prior) continue;
    const inter = [...g.names].filter((n) => prior.names.has(n)).length;
    const overlap = g.names.size ? inter / g.names.size : 0;
    if (overlap < GATE || g.asserts) continue;
    out.push({ ...g, overlap, priorSeason: prior.season, priorRows: prior.rows,
      identical: prior.names.size === g.names.size && inter === g.names.size });
  }
  return out;
}

/**
 * L7ZH's rule: no prior season to measure turnover against AND a route that
 * asserts no season — the same intersection the ingestion gate now fails
 * closed on, found in data that predates it.
 *
 * The earliest season held is excluded because nothing earlier CAN exist, so
 * its missing reference is arithmetic rather than a finding.
 */
export function deriveUnproven(ps, duplicates) {
  const earliest = [...SEASONS.map(String), String(SQUAD_SEASON)].sort()[0];
  const have = new Set(ps.keys());
  const dup = new Set(duplicates.map(keyOf));
  const out = [];
  for (const g of ps.values()) {
    if (g.season === earliest || g.asserts || dup.has(keyOf(g))) continue;
    if (have.has(`${g.college_name}||${g.sport}||${Number(g.season) - 1}`)) continue;
    out.push(g);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The records                                                                 */
/* -------------------------------------------------------------------------- */

const ROUTE_PROSE = {
  C_BARE_CURRENT_ROUTE: 'the bare current roster route, which serves whatever the site shows today',
  E_UNKNOWN_OR_MISSING: 'no recorded source URL at all',
  F_OTHER: 'a source URL of no recognised season-bearing shape',
};

/**
 * Why the machine reached this conclusion. Facts and measurements only — the
 * record has to be readable by someone deciding what to do about it, and a
 * diagnosis that only names its own class tells them nothing.
 */
function duplicateEvidence(g) {
  const shape = g.identical
    ? `an identical ${g.rows}-name set to the stored ${g.priorSeason} squad`
    : `${(g.overlap * 100).toFixed(1)}% of the stored ${g.priorSeason} squad `
      + `(${g.rows} rows against ${g.priorRows})`;
  return `Stored ${g.season} squad is ${shape}. Captured from ${ROUTE_PROSE[g.route] ?? g.route}, `
    + 'and no page-season provenance survives, so nothing establishes which season these rows '
    + 'represent. Two independent signals: the resemblance and the absence of season evidence.';
}

function unprovenEvidence(g) {
  return `No ${Number(g.season) - 1} roster exists for this programme, so turnover evidence could `
    + `not be measured, and the recorded source is ${ROUTE_PROSE[g.route] ?? g.route}. No `
    + 'page-season provenance survives. Nothing establishes which season these rows represent; '
    + 'this is not a finding that they are wrong.';
}

export function buildRecords({ duplicates, unproven, at }) {
  const recs = [];
  for (const g of duplicates) {
    recs.push({
      season: g.season, college_name: g.college_name, sport: g.sport,
      diagnosis: DIAGNOSIS.PROBABLE_DUPLICATE_CAPTURE,
      diagnosis_evidence: duplicateEvidence(g),
      diagnosed_at: at,
      /* A measurement, not a decision. The human half is not this file's. */
      disposition: null,
      disposition_evidence: null,
      reviewed_at: null,
      reviewed_by_operator_id: null,
      next_action: null,
    });
  }
  for (const g of unproven) {
    recs.push({
      season: g.season, college_name: g.college_name, sport: g.sport,
      diagnosis: DIAGNOSIS.SEASON_IDENTITY_UNPROVEN,
      diagnosis_evidence: unprovenEvidence(g),
      diagnosed_at: at,
      /* NO DISPOSITION. Unproven is not wrong, and marking thirteen seasons
       * RETAIN to empty a queue would be a decision disguised as tidiness. */
      disposition: null,
      disposition_evidence: null,
      reviewed_at: null,
      reviewed_by_operator_id: null,
      next_action: null,
    });
  }
  return recs.sort((a, b) => a.season.localeCompare(b.season)
    || a.college_name.localeCompare(b.college_name) || a.sport.localeCompare(b.sport));
}

/**
 * A digest over exactly what would be written, so two runs can be compared.
 *
 * TIMESTAMPS EXCLUDED, deliberately. `diagnosed_at` and `reviewed_at` record
 * when the run happened and differ on every invocation; including them would
 * make a plan digest that could never match another, which is the opposite of
 * what a plan digest is for. What this fingerprints is the DECISION — which
 * programme-seasons, which diagnoses, which dispositions, and the evidence
 * given for each.
 */
const DIGEST_FIELDS = ['season', 'college_name', 'sport', 'diagnosis', 'diagnosis_evidence',
  'disposition', 'disposition_evidence', 'reviewed_by_operator_id', 'next_action'];

export function planDigest(recs) {
  const payload = recs.map((r) => JSON.stringify(DIGEST_FIELDS.map((k) => r[k] ?? null))).join('\n');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/*
 * DIAGNOSIS COLUMNS ONLY. The human half is absent from this statement, so a
 * future edit to this file cannot set a disposition by accident — it would have
 * to add the column, which is a visible act rather than a typo.
 */
const INSERT = `INSERT INTO roster_season_trust
  (season, college_name, sport, diagnosis, diagnosis_evidence, diagnosed_at)
  VALUES (@season, @college_name, @sport, @diagnosis, @diagnosis_evidence, @diagnosed_at)`;

/* -------------------------------------------------------------------------- */

export function main(argv = process.argv) {
  const dryRun = argv.includes('--dry-run');
  const at = new Date().toISOString();

  const ps = loadProgrammeSeasons();
  const duplicates = deriveDuplicates(ps);
  const unproven = deriveUnproven(ps, duplicates);

  line();
  line(`  derived  PROBABLE_DUPLICATE_CAPTURE ${duplicates.length}   `
    + `SEASON_IDENTITY_UNPROVEN ${unproven.length}`);

  /*
   * THE SHAPE IS CHECKED BEFORE ANYTHING IS BUILT. A run that found three
   * duplicates would be finding something new, and a stage told to record two
   * must not quietly record three.
   */
  if (duplicates.length !== EXPECTED.duplicates || unproven.length !== EXPECTED.unproven) {
    throw new Error(`cohort is ${duplicates.length}/${unproven.length}, expected `
      + `${EXPECTED.duplicates}/${EXPECTED.unproven}. The measurement changed; stop and read it.`);
  }

  const recs = buildRecords({ duplicates, unproven, at });
  for (const r of recs) {
    const v = validateTrustRecord(r);
    if (!v.ok) throw new Error(`refused ${keyOf(r)}: ${v.reason}`);
    if (r.disposition !== null) {
      throw new Error('this script cannot write a human disposition of any kind');
    }
  }

  const existing = db.prepare('SELECT COUNT(*) n FROM roster_season_trust').get().n;
  line(`  existing trust rows ${existing}   planned inserts ${recs.length}   updates 0   deletes 0`);
  line(`  plan digest ${planDigest(recs)}`);
  line();
  line('  season  programme                                          sport          diagnosis                   disposition');
  for (const r of recs) {
    line(`  ${r.season}    ${r.college_name.slice(0, 48).padEnd(50)} ${r.sport.padEnd(14)} `
      + `${r.diagnosis.padEnd(27)} ${r.disposition ?? '(none — an operator decides)'}`);
  }

  if (dryRun) { line('\n  DRY RUN — nothing was written.\n'); return { recs, written: 0 }; }

  /* One transaction. A partial record of a measurement is not a measurement. */
  const write = db.transaction((rows) => {
    const ins = db.prepare(INSERT);
    for (const r of rows) ins.run(r);
  });
  write(recs);

  const after = db.prepare('SELECT COUNT(*) n FROM roster_season_trust').get().n;
  line(`\n  APPLIED  ${recs.length} inserted, one transaction. Trust rows now ${after}.\n`);
  return { recs, written: recs.length };
}

if (import.meta.url === `file://${process.argv[1]}`) main();
