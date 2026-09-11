import { useCallback, useEffect, useState } from 'react';
import { campaigns } from '@/api/client';

/**
 * THE CAMPAIGN THAT IS RUNNING, AND WHAT IT WOULD DO NEXT.
 *
 * Two requests, once: the athlete's campaigns, then the execution plan for the
 * one that is live. Nothing polls, nothing refetches on a keystroke, and the
 * plan is recomputed server-side on every call — so asking twice is asking
 * twice, and the screen asks once.
 *
 * ---------------------------------------------------------------------------
 * "CURRENT" MEANS ACTIVE, AND THAT IS THE DATABASE'S RULE RATHER THAN THIS
 * HOOK'S OPINION.
 *
 * `idx_campaigns_one_active` is a partial unique index over
 * (athlete_id) WHERE state = 'active', so an athlete has AT MOST ONE active
 * campaign. The schema says why in as many words: it is what lets a later send
 * resolve "the campaign this message belongs to" from the athlete alone. This
 * hook resolves it the same way, so the screen and the send path can never
 * disagree about which campaign is meant.
 *
 * DRAFTS AND CLOSED CAMPAIGNS ARE UNLIMITED, and none of them is current. Where
 * there is no active campaign this reports `NONE` and says what else exists,
 * rather than picking the newest draft — choosing between drafts would be this
 * hook inventing a rule the product has not got, and showing one as though the
 * campaign were running would be worse than showing none.
 * ---------------------------------------------------------------------------
 *
 * Returns { status, plan, campaign, otherCampaigns, error, reload }.
 */
export const CAMPAIGN_PLAN = Object.freeze({
  /** No athlete yet. Nothing has been asked and nothing is coming. */
  IDLE: 'idle',
  LOADING: 'loading',
  /** An active campaign, and its plan. */
  READY: 'ready',
  /** The athlete has no campaign that is running. `otherCampaigns` says what they have. */
  NONE: 'none',
  FAILED: 'failed',
});

export function useCampaignPlan(playerId) {
  const [state, setState] = useState({
    status: CAMPAIGN_PLAN.IDLE, plan: null, campaign: null, otherCampaigns: [], error: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!playerId) {
      setState({
        status: CAMPAIGN_PLAN.IDLE, plan: null, campaign: null, otherCampaigns: [], error: null,
      });
      return undefined;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, status: CAMPAIGN_PLAN.LOADING, error: null }));

    (async () => {
      const { campaigns: list = [] } = await campaigns.listForPlayer(playerId);
      const active = list.find((c) => c.state === 'active') ?? null;
      if (!active) {
        return {
          status: CAMPAIGN_PLAN.NONE, plan: null, campaign: null,
          otherCampaigns: list, error: null,
        };
      }
      const plan = await campaigns.executionPlan(active.id);
      return {
        status: CAMPAIGN_PLAN.READY, plan, campaign: active, otherCampaigns: list, error: null,
      };
    })()
      .then((next) => { if (!cancelled) setState(next); })
      .catch((err) => {
        if (cancelled) return;
        /**
         * NO PARTIAL PLAN, EVER. A plan half-read is a campaign whose blocked
         * programmes might be missing from it, and a screen that renders one as
         * authoritative is worse than a screen that says it could not read it.
         */
        setState({
          status: CAMPAIGN_PLAN.FAILED,
          plan: null,
          campaign: null,
          otherCampaigns: [],
          error: err.message ?? String(err),
        });
      });

    return () => { cancelled = true; };
  }, [playerId, attempt]);

  /**
   * ASK AGAIN, DELIBERATELY. Used by the failure notice today and by the
   * first-touch approval later: approving must re-read server truth rather
   * than let the screen assume what the approval did.
   */
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, reload };
}
