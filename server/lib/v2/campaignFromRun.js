import crypto from 'node:crypto';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import {
  tierForRank, MAX_RANK, validateCampaignDates, getCampaign, listProgrammeCampaigns,
} from '../campaigns.js';
import { resolveRun } from './matchmakingSelection.js';
import { STATUS, bandForRank } from './matchmakingService.js';
import { TOP_N } from '../../../shared/matching/v2/pursuitRules.js';

/**
 * =============================================================================
 * A CAMPAIGN FROM A PERSISTED RUN — A9.7 §E.
 *
 * A9.5 found that `createCampaign` reads `players.recommendations` — a pointer
 * to a V1 analysis FILE on disk. That path is untouched and still works; this
 * is a second, parallel one that reads the persisted V2 run instead.
 *
 * ===========================================================================
 * IT READS. IT DOES NOT SCORE.
 *
 * Every programme, rank, band and layer value comes out of
 * `matchmaking_programme_results` exactly as the run stored it. Nothing here
 * computes, re-ranks, re-reads the corpus or falls back to a live evaluation.
 * A campaign built from a run is a snapshot of that run and must be readable
 * as one a year later, when the corpus underneath it has moved.
 * ===========================================================================
 *
 * -- WHY THIS CREATES SELECTIONS, WHICH §D ASKED TO BE DELIBERATE -----------
 *
 * Each of the hundred targets gets a `matchmaking_selections` row with source
 * `TOP_100`. That is not provenance invented after the fact: CREATING A V2
 * CAMPAIGN *IS* THE SELECTION STEP. The consultant's act is "pursue the top
 * hundred of this run", and it chooses exactly those hundred programmes at
 * exactly that moment — which is what a selection row records. `TOP_100` as
 * the source is the literally true answer to "which surface did this come
 * from", and is what later lets "did searched programmes out-reply ranked
 * ones?" be asked at all.
 *
 * The alternative is campaign targets with no provenance, which is the gap
 * A9.6 existed to close.
 *
 * -- WHAT THIS DELIBERATELY CANNOT DO --------------------------------------
 *
 * Only RANKED programmes inside the Top 100 become campaign rows, and that is
 * the schema's decision rather than a policy choice made here:
 *
 *   programme_campaigns.rank   NOT NULL   — an unranked programme has no rank,
 *                                           and A9.5 refused to fabricate one
 *   programme_campaigns.tier   NOT NULL   — and `tierForRank` has no band
 *                                           above 100, so #101+ has no tier
 *
 * So a LIMITED_DATA programme, an unsupported association, and a #431 school
 * found by Specific Search cannot be campaign rows without inventing a rank, a
 * tier, or both. They are pursued through the MANUAL outreach path instead,
 * which requires neither and which carries selection provenance as of A9.7 —
 * so their truthful status is preserved in `matchmaking_selections` and their
 * outreach is still fully attributed. See §E in the A9.7 report.
 */

/** V2 campaigns are marked, so nothing compares their scores with V1's. */
export const MATCHING_MODEL_V2 = 'LAYERED_V2';

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * `match_score` is V1's column and V1's SCALE, so a V2 row must not pretend to
 * share it. Pursuit is a 0..1 weighted composite; this is that number on the
 * column's scale and nothing more.
 *
 * `matching_inputs.model` on the campaign says `LAYERED_V2`, and
 * `score_breakdown` carries the three layers with their grades. A reader
 * comparing a V1 82 with a V2 82 is comparing two different quantities, and
 * the model marker is how they can tell.
 */
const scoreOutOf100 = (pursuit) => Math.round((pursuit ?? 0) * 100);

/**
 * Create a draft campaign from the Top 100 of a persisted run.
 *
 * Returns the campaign and its programme rows, in the shape `createCampaign`
 * returns them, so every existing campaign reader works unchanged.
 */
export function createCampaignFromRun(athleteId, {
  runId = null, label = null, startsOn = null, outreachEndsOn = null, endsOn = null,
  at = new Date().toISOString(), limit = TOP_N,
} = {}) {
  /**
   * THE ATHLETE IS RESOLVED HERE, not handed in — the signature
   * `createCampaign` uses, for the reason `server/routes/campaigns.test.js`
   * enforces: that route is a boundary that "runs no SQL of its own", and a
   * route reading a player row to pass it down here would be the first
   * exception to it.
   */
  const player = Player.get(athleteId);
  if (!player || player.archived_at) {
    throw fail('ATHLETE_NOT_FOUND', `No athlete ${athleteId}`);
  }
  const { row: run, staleness } = resolveRun(db, player, { runId });

  /**
   * RANKED ONLY, TOP 100, IN RANK ORDER — §E, as a query rather than a filter
   * applied afterwards, so a LIMITED_DATA or unsupported programme cannot
   * reach the list by any route.
   */
  const programmes = db.prepare(`
    SELECT * FROM matchmaking_programme_results
     WHERE run_id = @runId
       AND status = @ranked
       AND rank IS NOT NULL
       AND rank <= @limit
     ORDER BY rank
  `).all({ runId: run.id, ranked: STATUS.RANKED, limit: Math.min(limit, MAX_RANK) });

  if (!programmes.length) {
    throw fail('EMPTY_RUN_UNIVERSE',
      'That matchmaking run ranked no programmes, so there is nothing to pursue. '
      + 'This is usually an unresolved family contribution.');
  }

  /**
   * THE ATHLETE'S OWN SUPPRESSIONS STILL APPLY, read the same way
   * `createCampaign` reads them. A school an operator removed from this
   * athlete's list does not enter their campaign because a different matcher
   * produced the list.
   *
   * UNLIKE V1, THE SLOT IS NOT BACKFILLED. V1 promotes the next programme out
   * of its `reserve` to keep the count at a hundred. Doing that here would
   * mean the campaign's ranks were no longer the RUN's ranks — #101 arriving
   * as the hundredth row — and every later question about what Thriv3 believed
   * at pursuit time would read a rank the run never assigned. A campaign of 97
   * is the truthful outcome of suppressing three.
   */
  const suppressed = new Set(db.prepare(`
    SELECT college_name FROM athlete_programmes
     WHERE athlete_id = ? AND sport = ? AND visibility = 'suppressed'
  `).all(player.id, run.sport).map((r) => r.college_name));

  const chosen = programmes.filter((p) => !suppressed.has(p.college_name));
  if (!chosen.length) {
    throw fail('EMPTY_RUN_UNIVERSE',
      'Every ranked programme in that run is suppressed for this athlete.');
  }

  const dates = validateCampaignDates({
    starts_on: startsOn ?? at.slice(0, 10),
    outreach_ends_on: outreachEndsOn,
    ends_on: endsOn,
  });

  const campaignId = crypto.randomUUID();
  const campaign = {
    id: campaignId,
    athlete_id: player.id,
    sport: run.sport,
    label: typeof label === 'string' && label.trim() ? label.trim() : null,
    // NEVER 'active'. Review, then activate — the same rule V1 campaigns obey.
    state: 'draft',
    starts_on: dates.starts_on,
    outreach_ends_on: dates.outreach_ends_on,
    ends_on: dates.ends_on,
    created_at: at,
    updated_at: at,
    closed_at: null,
    close_reason: null,
    /**
     * NOT A FILE PATH. V1 stores the analysis blob's name here; a V2 campaign
     * names the RUN, which is a database row that cannot be edited, moved or
     * lost. Prefixed so no reader mistakes it for a path and tries to open it.
     */
    source_analysis_ref: `matchmaking_run:${run.id}`,
    snapshot_taken_at: at,
    matching_inputs: JSON.stringify({
      model: MATCHING_MODEL_V2,
      matchmakingRunId: run.id,
      runComputedAt: run.computed_at,
      matcherVersion: run.matcher_version ?? null,
      rankedInRun: programmes.length,
      suppressed: programmes.length - chosen.length,
      /**
       * Whether the run already described a stale profile when the campaign
       * was frozen. Recorded rather than refused: pursuing a historical run is
       * a legitimate choice, and A9.5 settled that the fact it was historical
       * is part of what happened.
       */
      runWasStale: !staleness.current,
    }),
    programme_count: chosen.length,
  };

  const insertCampaign = db.prepare(`
    INSERT INTO campaigns (
      id, athlete_id, sport, label, state, starts_on, outreach_ends_on, ends_on,
      created_at, updated_at, closed_at, close_reason,
      source_analysis_ref, snapshot_taken_at, matching_inputs, programme_count
    ) VALUES (
      @id, @athlete_id, @sport, @label, @state, @starts_on, @outreach_ends_on, @ends_on,
      @created_at, @updated_at, @closed_at, @close_reason,
      @source_analysis_ref, @snapshot_taken_at, @matching_inputs, @programme_count
    )`);

  const insertSelection = db.prepare(`
    INSERT INTO matchmaking_selections (
      id, player_id, matchmaking_run_id, college_name, sport, college_id,
      status, rank, band, pursuit, source, run_was_stale, selected_at
    ) VALUES (
      @id, @player_id, @matchmaking_run_id, @college_name, @sport, @college_id,
      @status, @rank, @band, @pursuit, 'TOP_100', @run_was_stale, @selected_at
    )`);

  const insertProgramme = db.prepare(`
    INSERT INTO programme_campaigns (
      id, campaign_id, college_name, sport, college_id, rank, match_score, score_breakdown,
      division, conference, tier, tier_source, tier_set_at,
      state, state_reason, state_changed_at, created_at, updated_at,
      matchmaking_selection_id
    ) VALUES (
      @id, @campaign_id, @college_name, @sport, @college_id, @rank, @match_score, @score_breakdown,
      @division, @conference, @tier, 'AUTO', @tier_set_at,
      'queued', NULL, NULL, @created_at, @updated_at,
      @matchmaking_selection_id
    )`);

  /**
   * ONE TRANSACTION. A campaign whose targets lost their provenance halfway
   * through would be indistinguishable afterwards from a V1 campaign, and §S
   * requires an interrupted creation to leave nothing rather than something
   * half-attributed.
   */
  db.transaction(() => {
    insertCampaign.run(campaign);
    for (const p of chosen) {
      const selectionId = crypto.randomUUID();
      insertSelection.run({
        id: selectionId,
        player_id: player.id,
        matchmaking_run_id: run.id,
        college_name: p.college_name,
        sport: p.sport,
        college_id: p.college_id ?? null,
        status: p.status,
        rank: p.rank,
        band: bandForRank(p.rank),
        pursuit: p.pursuit,
        run_was_stale: staleness.current ? 0 : 1,
        selected_at: at,
      });
      insertProgramme.run({
        id: crypto.randomUUID(),
        campaign_id: campaignId,
        college_name: p.college_name,
        sport: p.sport,
        college_id: p.college_id ?? null,
        rank: p.rank,
        match_score: scoreOutOf100(p.pursuit),
        score_breakdown: JSON.stringify({
          model: MATCHING_MODEL_V2,
          pursuit: p.pursuit,
          band: bandForRank(p.rank),
          recruitability: { value: p.recruitability, grade: p.recruitability_grade },
          financial: { value: p.financial, grade: p.financial_grade },
          opportunity: { value: p.opportunity, grade: p.opportunity_grade },
        }),
        division: p.division ?? null,
        conference: null,
        tier: tierForRank(p.rank),
        tier_set_at: at,
        created_at: at,
        updated_at: at,
        matchmaking_selection_id: selectionId,
      });
    }
  })();

  return {
    campaign: getCampaign(campaignId),
    programmes: listProgrammeCampaigns(campaignId),
    runId: run.id,
    runWasStale: !staleness.current,
  };
}
