import db, { dbPath } from '../db/client.js';
import { assertCanonicalWrite } from '../db/corpusIdentity.js';
import { buildSeasonLinks, loadLinkInputs } from '../lib/players/linkBuilder.js';
import { isFactual } from '../../shared/players/identity.js';

/**
 * Carries minutes forward from an earlier season, for a season being played now.
 *
 *   npm run project-minutes                    # 2026 from the nearest earlier season
 *   npm run project-minutes -- --season 2026 --from 2025
 *
 * A season in progress has no minutes, so nothing can say who clears
 * STARTER_MINUTES yet. Last season's total is the best available stand-in, and
 * for the group this matters most for it is a good one: 85% of the 2026
 * graduating cohort appears on the 2025 roster and 70% carries real minutes,
 * against 50% / 38% for the rest of the squad. Players who are leaving have
 * history almost by definition.
 *
 * It is written to `projected_minutes`, never to `minutes_played`, and its
 * source season travels beside it. The distinction is the whole point: a
 * projection presented as the current season is worse than no number at all,
 * because a coach's roster has visibly changed since and the operator cannot
 * tell which figures are real.
 *
 * Deliberately NOT part of the import. It needs the earlier season already in
 * the table, and re-running an import must not silently regenerate projections
 * from whatever happens to be there.
 */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Match key: same normalisation the retention analysis uses. */
const NORM = "lower(replace(replace(replace(replace(player_name,' ',''),'-',''),'''',''),'.',''))";

/**
 * PERMANENT GUARD (Phase 8B.1A): a prior_programme may only be written from a
 * VERIFIED_SAME_PERSON link that carries its evidence. Throws, and the whole
 * rebuild rolls back, if anything else would reach the factual column.
 */
export function assertFactualPriors({ links, prior }) {
  const factualBy = new Map();
  for (const l of links) if (isFactual(l.decision)) (factualBy.get(l.to_observation_id) || factualBy.set(l.to_observation_id, []).get(l.to_observation_id)).push(l);
  for (const [id, was] of prior) {
    if (!was) continue;
    const ok = (factualBy.get(id) || []).filter((l) => l.from_programme === was && l.evidence_json && ['EXPLICIT_PRIOR_SCHOOL', 'MULTI_SIGNAL', 'REVIEWED', 'PROGRAMME_SCOPED'].includes(l.evidence_class) && (l.evidence_class !== 'PROGRAMME_SCOPED' || l.relation === 'SAME_PROGRAMME_CONTINUATION'));
    if (ok.length !== 1) throw new Error(`refusing a factual prior_programme for ${id}: ${ok.length} verified link(s) with evidence (name-only identity is never factual)`);
  }
}

export function projectMinutes(db, { season, from }) {
  const seasons = db.prepare('SELECT DISTINCT season FROM roster_players ORDER BY season DESC').all()
    .map((r) => r.season);
  if (!seasons.includes(season)) {
    throw new Error(`season ${season} is not in roster_players (have ${seasons.join(', ')})`);
  }
  // Nearest EARLIER season by default. A later one would be a forecast made
  // from the future, which is fine for backtesting and wrong for this.
  const source = from || seasons.filter((s) => Number(s) < Number(season))[0];
  if (!source) throw new Error(`no season earlier than ${season} to carry forward from`);

  const played = db.prepare(
    'SELECT COUNT(*) n FROM roster_players WHERE season = ? AND minutes_played IS NOT NULL'
  ).get(season).n;
  if (played > 0) {
    console.log(`  note: ${season} already has ${played} rows with real minutes.`);
    console.log('        Only rows still missing them are projected — real data always wins.');
  }

  /**
   * ONE TRANSACTION, BECAUSE THE CLEAR ALONE IS A VALID-LOOKING DATABASE.
   *
   * Ported from 754a70c, which is the commit that produced the current
   * canonical projection. These were three separate write units: wipe the
   * columns, rebuild the projections, backfill the prior programme. A process
   * that died between the first and the second left every 2026 row with a NULL
   * projection — which is not a crash, it is a silently degraded matcher.
   * `isStarter` falls back to `false`, every departure drops from starter to
   * squad at 0.4 weight, and nothing in the suite goes red.
   *
   * better-sqlite3 runs the callback inside BEGIN/COMMIT and rolls back on a
   * throw, so an interrupted rebuild now leaves the previous projections in
   * place rather than no projections at all. The clear is only durable if
   * everything after it also is.
   *
   * L7ZN VERIFIED: this changes DURABILITY, not output. The pre-transaction
   * code on this branch reproduced the canonical 39,430-row projection with
   * zero mismatches across 281,159 rows before the wrapper was added.
   */
  const rebuild = db.transaction(() => {
    db.prepare('UPDATE roster_players SET projected_minutes = NULL, projected_minutes_season = NULL, '
      + 'prior_programme = NULL WHERE season = ?').run(season);

    const info = db.prepare(`
      UPDATE roster_players AS t
         SET projected_minutes = (
               SELECT MAX(p.minutes_played) FROM roster_players p
                WHERE p.season = @source AND p.college_name = t.college_name
                  AND p.sport = t.sport AND ${NORM.replace(/player_name/g, 'p.player_name')} = ${NORM.replace(/player_name/g, 't.player_name')}
                  AND p.minutes_played IS NOT NULL),
             projected_minutes_season = @source
       WHERE t.season = @season
         AND t.minutes_played IS NULL
         AND EXISTS (
               SELECT 1 FROM roster_players p
                WHERE p.season = @source AND p.college_name = t.college_name
                  AND p.sport = t.sport AND ${NORM.replace(/player_name/g, 'p.player_name')} = ${NORM.replace(/player_name/g, 't.player_name')}
                  AND p.minutes_played IS NOT NULL)
    `).run({ season, source });

    // ---- where each player was the season before -------------------------
    // Phase 8B.1A. This used to be "the only programme with this letters-only
    // name last season", written straight into prior_programme as fact. Measured
    // across 4,431 such links: ~600 named a different person (1,139 contradicted
    // by hometown, 329 whose "prior" player was still on the prior programme's
    // own 2026 roster). A NAME MATCH IS A CANDIDATE, NOT A PERSON.
    //
    // Every candidate is now a pairwise claim with its signals and a decision
    // (server/lib/players/linkBuilder.js, shared/players/identity.js), stored in
    // player_observation_links. prior_programme is a projection of the
    // VERIFIED_SAME_PERSON links only; a candidate, probable, ambiguous or
    // contradicted origin leaves it NULL and lives in the links table.
    const inputs = loadLinkInputs(db, { season });
    // an APPROVED review outranks recomputation: its decision is used, its row is kept
    const reviewed = new Map(db.prepare('SELECT link_id, decision FROM player_observation_links WHERE to_season = ? AND reviewed_at IS NOT NULL').all(String(season)).map((r) => [r.link_id, { decision: r.decision }]));
    const built = buildSeasonLinks({ ...inputs, season, source, reviewed, recordedAt: new Date().toISOString() });
    assertFactualPriors(built);
    const setPrior = db.prepare('UPDATE roster_players SET prior_programme = ? WHERE id = ?');
    db.prepare('DELETE FROM player_observation_links WHERE to_season = ? AND reviewed_at IS NULL').run(String(season));
    const insLink = db.prepare(`INSERT INTO player_observation_links (link_id, relation, to_observation_id, from_observation_id, sport, to_programme, to_season, from_programme, from_season, decision, evidence_class, evidence_json, evidence_id, method, reviewed_at, reviewed_by, review_note, recorded_at)
      VALUES (@link_id, @relation, @to_observation_id, @from_observation_id, @sport, @to_programme, @to_season, @from_programme, @from_season, @decision, @evidence_class, @evidence_json, @evidence_id, @method, @reviewed_at, @reviewed_by, @review_note, @recorded_at)`);
    let located = 0, movedIn = 0;
    // Already inside `rebuild`; better-sqlite3 nests this as a SAVEPOINT rather
    // than a second BEGIN, so the whole operation still commits or rolls back
    // as one.
    db.transaction(() => {
      for (const l of built.links) if (!reviewed.has(l.link_id)) insLink.run(l);
      for (const [id, was] of built.prior) {
        if (!was) continue;
        setPrior.run(was, id);
        located += 1;
      }
    })();
    const byId = new Map(inputs.rows.filter((r) => String(r.season) === String(season)).map((r) => [r.id, r]));
    for (const [id, was] of built.prior) if (was && byId.get(id)?.college_name !== was) movedIn += 1;
    return { info, located, movedIn };
  });
  const { info, located, movedIn } = rebuild();

  const tot = db.prepare('SELECT COUNT(*) n FROM roster_players WHERE season = ?').get(season).n;
  const grad = db.prepare(`
    SELECT COUNT(*) n, SUM(projected_minutes IS NOT NULL) proj
      FROM roster_players WHERE season = ? AND estimated_graduation_year = ?
  `).get(season, Number(season) + 1);

  console.log(`\n  ${season} projected from ${source}:`);
  console.log(`    ${info.changes} of ${tot} rows carry a projection (${(100 * info.changes / tot).toFixed(1)}%)`);
  console.log(`    graduating cohort (${Number(season) + 1}): ${grad.proj} of ${grad.n} (${(100 * grad.proj / grad.n).toFixed(1)}%)`);
  console.log(`    the remainder are newcomers with no prior season — unknown, NOT zero`);
  console.log(`    ${located} rows with a VERIFIED prior programme, of which ${movedIn} at a different programme`);
  console.log(`    (every other candidate origin is in player_observation_links, never in prior_programme)`);
  return { changes: info.changes, source };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  /*
   * L7ZM. This writes product data. When the corpus is one other checkouts
   * share, say so out loud rather than surprising them — see
   * `server/db/corpusIdentity.js`.
   */
  assertCanonicalWrite({ script: 'projectRosterMinutes.js', path: dbPath });
  const season = String(arg('season', '2026'));
  const from = arg('from', null);
  const { source } = projectMinutes(db, { season, from });
  console.log(`\nDone. projected_minutes on ${season} rows now carries ${source} minutes.`);
  console.log('Remember: this is not current-season data. It is labelled as such everywhere it surfaces.');
}
