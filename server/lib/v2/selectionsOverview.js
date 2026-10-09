import db from '../../db/client.js';
import { SEND_EVENT_TYPE } from '../../../shared/outreachMessageState.js';
import { currentState } from './recruitingObservations.js';
import { OUTREACH_ORIGIN } from '../../../shared/outreachOrigin.js';

/**
 * =============================================================================
 * WHAT HAS HAPPENED TO EVERYTHING WE CHOSE — A9.7 §K.
 *
 * The operational surface a consultant needs for rollout: one row per
 * programme they selected, carrying what the run said at the time, what was
 * sent, whether anyone replied, and the latest reviewed reading of it.
 *
 * ===========================================================================
 * IT READS FIVE TABLES AND RECOMPUTES NONE OF THEM.
 *
 * Rank, band, status and Pursuit come from `matchmaking_selections`, which
 * froze them when the choice was made. This is the surface where a stale
 * number would be least visible and most damaging: a consultant looking at
 * "Lindenwood, #4" while deciding whether to chase a reply must be seeing the
 * #4 THAT CAUSED THE EMAIL, not a #61 a newer run has since assigned.
 * ===========================================================================
 *
 * NOT AN ANALYTICS DASHBOARD. No rates, no funnels, no aggregates across
 * athletes. §K is explicit, and so is the reason: three days of data would
 * mostly be a way of over-reading it.
 */

/**
 * One row per selection, newest first.
 *
 * ---------------------------------------------------------------------------
 * ONE QUERY FOR THE SPINE, THEN ONE PASS. An athlete may hold several hundred
 * selections across a season, and a per-row projection call would be a query
 * per programme per page load. The sends and replies arrive as grouped
 * aggregates; the observation state is computed per DISTINCT PROGRAMME rather
 * than per selection, because selecting the same school out of two runs is two
 * rows and one outcome history.
 * ---------------------------------------------------------------------------
 */
/**
 * RECIPIENTS, COUNTED BY KIND - Phase 5 (#14, review check 2).
 *
 * A send addresses a coach (coach_id) or a programme inbox (programme_contact_id).
 * Both are TEXT ids, and COALESCE(coach_id, programme_contact_id) would merge a
 * coach and an inbox whose ids happened to be equal into one recipient. The key
 * is namespaced by kind ('COACH:' / 'INBOX:'), so equal ids of different kinds stay apart.
 */
export const RECIPIENT_COUNT_SQL = `COUNT(DISTINCT CASE
             WHEN coach_id IS NOT NULL THEN 'COACH:' || coach_id
             WHEN programme_contact_id IS NOT NULL THEN 'INBOX:' || programme_contact_id
           END)`;

/**
 * THE SENDS EACH SELECTION ANSWERS FOR - Phase 5 follow-up.
 *
 * A campaign message records the selection that caused it
 * (`outreach_send.matchmaking_selection_id`). A MANUAL draft does not: the
 * Specific Search and programme composers never link one. Read through the
 * link alone, a programme that was manually contacted, confirmed sent and
 * replied to still showed "Not contacted yet".
 *
 * So an unlinked manual send is attributed here, at read time, to exactly ONE
 * selection of the same athlete, programme and sport: the latest one made at
 * or before the send was created, or, for a send that predates every
 * selection, the earliest. Nothing is written: provenance is not invented
 * after the fact, and historical sends are covered as they stand.
 *
 *   - A linked send keeps its link and is never attributed again, so a send
 *     counts once. Campaign and manual sends to the same coach share a
 *     relationship, and recipients and replies are counted DISTINCT.
 *   - Attribution never touches `state`. A prepared draft stays a message,
 *     not an accepted send; only a confirmed send is ACCEPTED.
 *   - Manual means origin 'manual', or a legacy row with no origin and no
 *     campaign (manual drafts predating the origin column). Unlinked CAMPAIGN
 *     sends are left alone: their provenance is the campaign's to state.
 */
function attributedSends(placeholders) {
  const SAME_PROGRAMME = 'm.player_id = s.athlete_id AND m.college_name = s.college_name AND m.sport = s.sport';
  return {
    sql: `WITH attributed AS (
      SELECT s.id, s.outreach_id, s.state, s.sent_at, s.coach_id, s.programme_contact_id,
             s.matchmaking_selection_id AS sel
        FROM outreach_send s
       WHERE s.matchmaking_selection_id IN (${placeholders})
      UNION ALL
      SELECT s.id, s.outreach_id, s.state, s.sent_at, s.coach_id, s.programme_contact_id,
             COALESCE(
               (SELECT m.id FROM matchmaking_selections m WHERE ${SAME_PROGRAMME} AND m.selected_at <= s.created_at
                 ORDER BY m.selected_at DESC, m.id DESC LIMIT 1),
               (SELECT m.id FROM matchmaking_selections m WHERE ${SAME_PROGRAMME}
                 ORDER BY m.selected_at ASC, m.id ASC LIMIT 1)) AS sel
        FROM outreach_send s
       WHERE s.matchmaking_selection_id IS NULL AND s.athlete_id = ?
         AND (s.origin = ? OR (s.origin IS NULL AND s.programme_campaign_id IS NULL))
    )`,
    params: (ids, playerId) => [...ids, playerId, OUTREACH_ORIGIN.MANUAL],
  };
}

export function selectionsOverview(playerId, { limit = 200 } = {}) {
  const selections = db.prepare(`
    SELECT s.*, r.computed_at AS run_computed_at
      FROM matchmaking_selections s
      JOIN matchmaking_runs r ON r.id = s.matchmaking_run_id
     WHERE s.player_id = ?
     ORDER BY s.selected_at DESC, s.id
     LIMIT ?`).all(playerId, limit);

  if (!selections.length) return { playerId, selections: [] };

  const ids = selections.map((s) => s.id);
  const placeholders = ids.map(() => '?').join(', ');

  /**
   * SENDS PER SELECTION. Deliberately a COUNT and the latest state rather than
   * the messages themselves: one selection legitimately produces several
   * messages — a head coach, an assistant, a follow-up — and this surface
   * answers "has anything gone out", not "show me the mail".
   */
  const attributed = attributedSends(placeholders);
  const sendRows = db.prepare(`
    ${attributed.sql}
    SELECT sel,
           COUNT(*)                                             AS messages,
           SUM(CASE WHEN state = 'ACCEPTED' THEN 1 ELSE 0 END)  AS accepted,
           MAX(sent_at)                                         AS last_sent_at,
           ${RECIPIENT_COUNT_SQL}                                AS coaches
      FROM attributed
     WHERE sel IN (${placeholders})
     GROUP BY sel`).all(...attributed.params(ids, playerId), ...ids);
  const sends = new Map(sendRows.map((r) => [r.sel, r]));

  /**
   * REPLIES, AS RECIPIENTS WHO HAVE REPLIED - Phase 5 (#13, review check 1).
   *
   * A reply reaches Thriv3 by one of two paths that never write to each other:
   * a REPLY event on a send (reply intake), or "Mark responded" on the
   * Engagement tab (`engagement_rollup.responded_at`, per relationship). The
   * count is the number of DISTINCT RELATIONSHIPS (athlete x recipient) with a
   * reply recorded by EITHER path. So one reply recorded both ways counts once,
   * and replies from different recipients recorded by different paths each
   * count - neither the larger of the two (which under-counts a split) nor the
   * sum (which double-counts an overlap). Several replies from the same
   * recipient are one replying recipient: the field answers "how many have
   * replied", which is what both paths can actually support.
   */
  const replyRows = db.prepare(`
    ${attributed.sql}
    SELECT sel, COUNT(DISTINCT outreach_id) AS replies, MAX(at) AS last_reply_at
      FROM (
        SELECT a.sel, a.outreach_id, e.observed_at AS at
          FROM outreach_send_event e
          JOIN attributed a ON a.id = e.outreach_send_id
         WHERE e.type = ?
        UNION ALL
        SELECT a.sel, a.outreach_id, r.responded_at AS at
          FROM attributed a
          JOIN engagement_rollup r ON r.outreach_id = a.outreach_id
         WHERE r.responded_at IS NOT NULL
      )
     WHERE sel IN (${placeholders})
     GROUP BY sel`).all(...attributed.params(ids, playerId), SEND_EVENT_TYPE.REPLY, ...ids);
  const replies = new Map(replyRows.map((r) => [r.sel, r]));

  /** One outcome history per PROGRAMME, not per selection — see above. */
  const stateByProgramme = new Map();
  for (const s of selections) {
    const key = `${s.college_name}|${s.sport}`;
    if (stateByProgramme.has(key)) continue;
    stateByProgramme.set(key, currentState(db, {
      athleteId: playerId,
      collegeName: s.college_name,
      sport: s.sport,
      /**
       * REVIEWED ONLY — §J. An operational screen a consultant acts on shows
       * what a person has confirmed, not what an unreviewed classifier
       * guessed. The unreviewed rows are still in the ledger and still on the
       * programme panel, where they carry their "not yet reviewed" label.
       */
      unreviewed: false,
    }));
  }

  return {
    playerId,
    selections: selections.map((s) => {
      const send = sends.get(s.id) ?? null;
      const reply = replies.get(s.id) ?? null;
      const state = stateByProgramme.get(`${s.college_name}|${s.sport}`) ?? null;
      return {
        selectionId: s.id,
        collegeName: s.college_name,
        sport: s.sport,
        /** What the run said WHEN IT WAS CHOSEN. Never re-read. */
        status: s.status,
        rank: s.rank,
        band: s.band,
        pursuit: s.pursuit,
        source: s.source,
        runId: s.matchmaking_run_id,
        runComputedAt: s.run_computed_at,
        runWasStale: s.run_was_stale === 1,
        selectedAt: s.selected_at,
        outreach: {
          messages: send?.messages ?? 0,
          accepted: send?.accepted ?? 0,
          coaches: send?.coaches ?? 0,
          lastSentAt: send?.last_sent_at ?? null,
        },
        /**
         * `replies: 0` MEANS NOBODY HAS RECORDED ONE. It is not "no reply" as a
         * finding and never "not interested" — nothing ingests replies, so a
         * zero here is as much a statement about Thriv3's observation as about
         * the coach.
         */
        reply: {
          /** Recipients with a reply recorded by either path (see above). */
          replies: reply?.replies ?? 0,
          lastReplyAt: reply?.last_reply_at ?? null,
        },
        latest: state ? {
          programmeInterest: state.programmeInterest,
          recruitingNeed: state.recruitingNeed,
          athleteOutcome: state.athleteOutcome,
        } : null,
      };
    }),
  };
}
