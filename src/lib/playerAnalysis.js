import { entities } from '@/api/client';
import { CURRENT_ROSTER_SEASON } from '@/lib/divisions';
import { buildRosterIndex, rankMatches, normaliseAthlete } from '@shared/matching/pool.js';

/**
 * The Pillar 1 matching run — three phases, client-side.
 *
 * The scoring itself lives in shared/matching, not here, because
 * server/lib/matchingBacktest.js has to be able to run the *same* code over
 * 600 real recruiting outcomes per sport. A harness that scored differently
 * from the product would measure nothing about the product.
 *
 * What changed on 2026-08-25, and why it matters to anyone reading a match
 * card:
 *
 *   The score means something fixed. Six criteria, each 0..1, combined by
 *   weights that sum to 1. 100 is a perfect result on everything the athlete
 *   cares about. The previous score summed four unrelated terms and clipped
 *   at 100, so a developmental athlete's D3 safety scored 99 while an elite
 *   athlete's best D1 fit scored 93 — numbers that were never on the same
 *   scale as each other.
 *
 *   Academic importance is a weight, not a filter. It used to be compared
 *   against academic_rating as a minimum, which is a different quantity
 *   entirely: an athlete setting the slider to 7 lost half of D1 and nearly
 *   all of NAIA and NJCAA before anything was scored.
 *
 *   Nothing is excluded silently. Hard filters are eligibility only —
 *   division and conference — and what they removed is returned so the UI can
 *   say so.
 *
 *   Missing data is neutral, not zero. An unscraped roster used to score as
 *   "no openings", so a programme we had simply never collected could not
 *   rank well however well it fitted.
 *
 * Measured, not asserted: against 600 real 2025 arrivals ranked using only
 * 2024 data, the old model put the athlete's actual school at a median 59.3rd
 * percentile (men) where chance is 45.4; this one puts it at the 91.9th.
 */
export async function analyze(player, { onPhase, onProgress }) {
  const playerSport = player.sport || 'mens-soccer';
  const athlete = normaliseAthlete(player);

  // ---- Phase 1: Scouting ----
  onPhase(1);
  const allColleges = await entities.College.filter({ sport: playerSport });
  onProgress({ current: 0, total: allColleges.length, school: '', phase: 'scouting', loaded: allColleges.length });

  // ---- Phase 2: Researching ----
  onPhase(2);
  const rosterRows = await entities.RosterPlayer.filter({ sport: playerSport, season: CURRENT_ROSTER_SEASON });
  const rosterIndex = buildRosterIndex(rosterRows);

  // Coaching contacts still live on GraduatingSenior records whichever model
  // supplies the roster data, so the Email Coaches button needs this lookup
  // regardless of where the opportunity numbers came from.
  const coachingStaffMap = {};
  const gradRecords = await entities.GraduatingSenior.filter({ sport: playerSport });
  for (const r of gradRecords) {
    if (r.coaching_staff && r.coaching_staff.length) coachingStaffMap[r.college_name] = r.coaching_staff;
  }

  onProgress({ current: allColleges.length, total: allColleges.length, school: '', phase: 'researching' });
  // Yield once so the progress bar paints before the synchronous ranking pass.
  await new Promise((r) => setTimeout(r, 0));

  // ---- Phase 3: Ranking & Persistence ----
  onPhase(3);
  const { results, excluded, poolSize } = rankMatches({ athlete, colleges: allColleges, rosterIndex });

  const top100 = results.slice(0, 100).map((r) => ({
    ...r,
    program_quality_rating: r.soccer_score != null ? r.soccer_score / 10 : null,
    coaching_staff: coachingStaffMap[r.name] || [],
    // The two pairs below are different numbers and must not be aliased to
    // each other. They were: both "total" fields were assigned the
    // at-position values, so the card's "Total Graduating" and "At Your
    // Position" rendered the same list on every school. Only 1% of
    // programmes genuinely lose their whole graduating cohort from one
    // position, so this was wrong essentially everywhere it was shown.
    all_graduating_senior_names: r.graduating_names_total,
    total_graduating_seniors: r.graduating_total,
    graduating_seniors_at_position: r.graduating_at_position,
    graduating_senior_names_at_position: r.graduating_names_at_position,
    graduating_starter_names_at_position: r.graduating_starter_names_at_position,
    position_need: r.labels.roster === 'high' ? 'High' : r.labels.roster === 'medium' ? 'Medium' : 'Low',
  }));

  const withOpportunity = top100.filter((r) => r.graduating_starters_at_position > 0).length;
  const unrated = top100.filter((r) => r.academic_rating == null).length;
  const removed = excluded.division + excluded.conference;

  const summary = [
    `Ranked ${poolSize} eligible programs on six weighted criteria.`,
    removed ? `${removed} excluded by your division and conference filters.` : null,
    // Said out loud on purpose. The previous model applied an academic
    // threshold nobody had asked for and never mentioned it, which is how an
    // athlete came to be shown 40 programs out of 1,154 without knowing.
    excluded.academicMinimum
      ? `${excluded.academicMinimum} excluded by your minimum academic rating of ${player.academic_minimum}.`
      : null,
    excluded.unratedKept
      ? `${excluded.unratedKept} unrated program(s) kept rather than dropped, since a minimum cannot judge them.`
      : null,
    `${withOpportunity} of the top ${top100.length} have a graduating starter at ${player.position}.`,
    unrated ? `${unrated} are shown without an academic rating rather than hidden.` : null,
  ].filter(Boolean).join(' ');

  return { recommendations: top100, summary };
}
