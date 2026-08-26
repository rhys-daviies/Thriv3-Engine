import db from '../db/client.js';

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

  db.prepare('UPDATE roster_players SET projected_minutes = NULL, projected_minutes_season = NULL WHERE season = ?')
    .run(season);

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

  const tot = db.prepare('SELECT COUNT(*) n FROM roster_players WHERE season = ?').get(season).n;
  const grad = db.prepare(`
    SELECT COUNT(*) n, SUM(projected_minutes IS NOT NULL) proj
      FROM roster_players WHERE season = ? AND estimated_graduation_year = ?
  `).get(season, Number(season) + 1);

  console.log(`\n  ${season} projected from ${source}:`);
  console.log(`    ${info.changes} of ${tot} rows carry a projection (${(100 * info.changes / tot).toFixed(1)}%)`);
  console.log(`    graduating cohort (${Number(season) + 1}): ${grad.proj} of ${grad.n} (${(100 * grad.proj / grad.n).toFixed(1)}%)`);
  console.log(`    the remainder are newcomers with no prior season — unknown, NOT zero`);
  return { changes: info.changes, source };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const season = String(arg('season', '2026'));
  const from = arg('from', null);
  const { source } = projectMinutes(db, { season, from });
  console.log(`\nDone. projected_minutes on ${season} rows now carries ${source} minutes.`);
  console.log('Remember: this is not current-season data. It is labelled as such everywhere it surfaces.');
}
