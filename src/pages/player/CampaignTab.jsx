import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import CampaignProgrammeCard from '@/components/CampaignProgrammeCard';
import CampaignMessageDetail from '@/components/CampaignMessageDetail';
import { usePlayerWorkspace } from './PlayerWorkspace';
import { campaigns } from '@/api/client';
import { useCampaignPlan, CAMPAIGN_PLAN } from '@/lib/useCampaignPlan';
import {
  blockerCopy, isCampaignWide, approvalError, preparationError, generationError,
  messageLoadError, messageEditError, messageReviewError,
  CAMPAIGN_STATE_COPY, shortDate,
} from '@/lib/campaignLabels';

/**
 * WHAT THIS CAMPAIGN IS DOING, AND WHAT IS STOPPING IT.
 *
 * The operator surface over an architecture that has been able to answer these
 * questions since B6 and has never been asked them by a screen. It renders the
 * execution plan and nothing else.
 *
 * ---------------------------------------------------------------------------
 * IT DERIVES PRESENTATION, NEVER POLICY.
 *
 * Grouping is the only decision made here, and it is made out of authoritative
 * fields rather than by re-deciding anything: `firstTouchReview.required`,
 * `executableNow`, `exhausted`, `safety.kind`. Sequencing, stance, prior
 * contact, approval currency and executability are the server's, and a screen
 * that recomputed any of them would be a second policy that could disagree.
 *
 * TWO FIELDS LOOK LIKE THE ANSWER AND ARE NOT.
 *
 *   `priorityActions` is the order actions should be CONSIDERED in, and
 *   includes programmes that are not executable — a manual-only programme sits
 *   at priority 1 with `executableNow: false`. Rendering it as a ready list
 *   would put a school the campaign may not write to at the top.
 *
 *   `operatorReviewRequired` is true for the first-touch review AND for a
 *   programme with nobody reachable, a step disagreement, unresolved timing and
 *   an unconfigured mailbox. The review UI keys on `firstTouchReview.required`
 *   alone.
 * ---------------------------------------------------------------------------
 */

/**
 * WHICH GROUP A PROGRAMME BELONGS IN. Exactly one, decided in this order.
 *
 * The order is the operator's attention, not the severity of the blocker: a
 * programme they can act on comes before one they cannot, and a prohibition —
 * which is settled — comes before a wait, which is not. A programme can carry
 * several blockers at once, so the first match wins and the rest are still
 * printed on the card.
 */
export const GROUP = Object.freeze({
  REVIEW: 'review',
  READY: 'ready',
  COMPLETE: 'complete',
  BLOCKED: 'blocked',
  WAITING: 'waiting',
  DECISION: 'decision',
});

export function groupFor(programme) {
  if (programme.firstTouchReview?.required) return GROUP.REVIEW;
  if (programme.executableNow) return GROUP.READY;
  if (programme.exhausted || programme.nextAction === 'NO_FURTHER_COLD_OUTREACH') {
    return GROUP.COMPLETE;
  }
  if (programme.safety?.kind === 'PROHIBITION') return GROUP.BLOCKED;

  /**
   * WAITING IS ABOUT A DAY ARRIVING. A timing refusal from B3 — the campaign
   * has not started — or a follow-up that is not due yet. Both become
   * executable by themselves, which is what separates them from everything
   * below.
   */
  const blockers = programme.blockers ?? [];
  const timingBlocker = blockers.some((b) => b.source === 'TIMING');
  if (timingBlocker || programme.safety?.kind === 'TIMING') return GROUP.WAITING;

  /**
   * AND SO IS A CAMPAIGN-WIDE ONE. A programme whose only remaining blocker is
   * capacity or configuration — an unset mailbox limit, today's allowance spent
   * — has nothing wrong with it: it becomes executable when a setting is made
   * or a day passes, which is what waiting means.
   *
   * Found by looking at the screen. With no mailbox limit configured every
   * programme carries that blocker, and without this the whole Ready group fell
   * through to "Needs a decision" — sixty schools apparently demanding
   * attention because of one setting nobody had chosen.
   */
  if (blockers.length > 0 && blockers.every((b) => isCampaignWide(b.code))) return GROUP.WAITING;

  return GROUP.DECISION;
}

const SECTIONS = [
  {
    key: GROUP.REVIEW,
    title: 'Needs your review',
    blurb: 'A campaign message here would be a first introduction to somebody who has already '
      + 'heard from this athlete.',
  },
  {
    key: GROUP.READY,
    title: 'Ready',
    /**
     * ADDED IN F9c, ON THE STRENGTH OF LOOKING AT THE REAL SCREEN.
     *
     * Fourteen cards under an unqualified "Ready", each carrying the same
     * button, reads as a list of things to fire — the section framing was doing
     * the implying that the button's own wording carefully avoids. So the blurb
     * says what "ready" is a fact ABOUT, and what the control actually does.
     */
    blurb: 'Nothing is stopping these. Preparing one records the campaign’s next intended '
      + 'contact; it does not send anything.',
    compact: true,
  },
  {
    key: GROUP.DECISION,
    title: 'Needs a decision',
    blurb: 'Something here needs a person, and it is not a first-touch review.',
  },
  {
    key: GROUP.WAITING,
    title: 'Waiting',
    /**
     * AND HERE THE AMBIGUITY IS SHARPER — F9c.
     *
     * "Waiting" beside a button an operator CAN press reads as though pressing
     * it would stop the waiting. It would not: these become available on their
     * own, and preparing is a separate thing that is allowed now because an
     * intent is not a message. The section had no blurb at all, which left the
     * card's own "Follow-up due Sep 15" line to carry the whole explanation.
     */
    blurb: 'These become available on their own — a date arrives, or a setting is made. '
      + 'The next contact can still be prepared now.',
    compact: true,
  },
  { key: GROUP.BLOCKED, title: 'Not contactable', blurb: null },
  { key: GROUP.COMPLETE, title: 'Complete', blurb: null, compact: true },
];

const COUNT_LABEL = Object.freeze({
  [GROUP.REVIEW]: 'need your review',
  [GROUP.READY]: 'ready',
  [GROUP.WAITING]: 'waiting',
  [GROUP.BLOCKED]: 'not contactable',
  [GROUP.COMPLETE]: 'complete',
  [GROUP.DECISION]: 'need a decision',
});

/* -------------------------------------------------------------------------- */

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

function Loading() {
  return (
    <div className="space-y-4" data-testid="campaign-loading">
      <Card className="p-4 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
      </Card>
      {[0, 1, 2].map((i) => (
        <Card key={i} className="p-4 space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-72" />
        </Card>
      ))}
    </div>
  );
}

function Empty({ otherCampaigns }) {
  /**
   * NO CAMPAIGN IS RUNNING, WHICH IS NOT THE SAME AS NO CAMPAIGN EXISTING.
   * Drafts and closed campaigns are unlimited and none of them is current, so
   * what they have is named rather than selected — picking one would be this
   * screen inventing a rule the product has not got.
   */
  const drafts = otherCampaigns.filter((c) => c.state === 'draft').length;
  const closed = otherCampaigns.filter((c) => c.state === 'closed').length;

  return (
    <Card className="p-6 space-y-2" data-testid="campaign-empty">
      <p className="text-sm font-medium">No campaign is running</p>
      <p className="text-sm text-muted-foreground">
        This athlete has no active outreach campaign.
        {drafts > 0 && ` ${drafts} draft ${drafts === 1 ? 'campaign is' : 'campaigns are'} waiting to be reviewed and activated.`}
        {closed > 0 && ` ${closed} ${closed === 1 ? 'campaign has' : 'campaigns have'} been closed.`}
      </p>
    </Card>
  );
}

function Failed({ error, onRetry }) {
  return (
    <Card className="p-4 flex items-center justify-between gap-3" role="status">
      <div className="min-w-0">
        <p className="text-sm font-medium">The campaign plan could not be loaded</p>
        <p className="text-xs text-muted-foreground">
          Nothing is shown rather than part of it — a plan read halfway could be missing exactly
          the programmes that are blocked.
          {error ? ` (${error})` : ''}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

export default function CampaignTab() {
  const { player } = usePlayerWorkspace();
  const {
    status, plan, campaign, otherCampaigns, error, reload,
  } = useCampaignPlan(player?.id);
  const [query, setQuery] = useState('');
  /** Which programmes have a request in flight, so a second click cannot start one. */
  const inFlight = useRef(new Set());
  /**
   * SAID AT THE PAGE, BECAUSE THE CARD MAY NOT SURVIVE IT.
   *
   * Two approval refusals are not refusals at all — the server has moved on
   * since the page was drawn, and the answer is to read the plan again. But a
   * reload replaces every card, and the review that failed may be gone
   * entirely, so a message attached to that card would vanish in the same
   * moment it became true. It lives here instead, and stays until the next
   * thing the operator does.
   */
  const [notice, setNotice] = useState(null);

  /**
   * WHERE FOCUS GOES WHEN THE PLAN IS REPLACED.
   *
   * Approving removes the control that was pressed — the card may move group or
   * disappear entirely — so a keyboard user is otherwise returned to the top of
   * the document with no account of what happened. The notice takes focus
   * instead: it says what was recorded, and it is next to the thing that
   * changed.
   */
  /**
   * A CALLBACK REF RATHER THAN AN EFFECT, because the notice unmounts on the way
   * past: setting it is immediately followed by a reload, and the page shows
   * skeletons while that runs. An effect keyed on the message would have fired
   * against an element that was about to be thrown away, and never again once
   * the real one mounted. This focuses whatever notice actually appears.
   */
  const noticeRef = useCallback((el) => { el?.focus(); }, []);

  const programmes = plan?.programmes ?? [];

  /**
   * RECORD A REVIEW, THEN GO AND READ THE PLAN AGAIN.
   *
   * NOTHING IS ASSUMED ABOUT WHAT THE APPROVAL DID. It clears one hold, and the
   * programme may still be blocked by a stance, a suppression, the campaign's
   * own state or an unconfigured mailbox — so the card is not moved to Ready
   * here, or anywhere. The next plan decides which group it belongs in, the
   * same way it decided the last one.
   *
   * The identifiers are the plan's own. Nothing is reconstructed from a school
   * name, and the request carries no body at all: the operator, the history
   * snapshot and the timestamp are the server's to derive.
   */
  const approve = useCallback(async (programme) => {
    const key = `${programme.programmeCampaignId}:${programme.currentCoach.id}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      setNotice(null);
      await campaigns.approveFirstTouch(programme.programmeCampaignId, programme.currentCoach.id);
      /**
       * SAID, NOT ASSUMED. The sentence reports what was RECORDED — a review —
       * and never what it achieved: the reload decides whether this programme
       * is now ready, still waiting on a setting, or refused by something the
       * approval had no bearing on.
       */
      setNotice(`Review recorded for ${programme.currentCoach.name} at ${programme.collegeName}. `
        + 'The campaign has been reloaded.');
      reload();
    } catch (err) {
      /**
       * A FAILED APPROVAL IS NOT A FAILED PLAN. The plan on screen is still the
       * one the server sent and is still true, so it stays: replacing the page
       * with the load-failure state would throw away something correct.
       *
       * WHERE THE MESSAGE GOES DEPENDS ON WHAT HAPPENED. A refusal this
       * operator can retry belongs on the panel that tried. The server having
       * moved on — somebody sent a message, the plan advanced to another coach
       * — belongs at the page, because the reload that answers it may take the
       * card away.
       */
      const copy = approvalError(err);
      if (copy.refresh) {
        setNotice(copy.message);
        reload();
        return;
      }
      throw Object.assign(err, { operatorMessage: copy.message });
    } finally {
      inFlight.current.delete(key);
    }
  }, [reload]);

  /**
   * RECORD THE CAMPAIGN'S NEXT CONTACT INTENT, THEN GO AND READ THE PLAN AGAIN.
   *
   * ---------------------------------------------------------------------------
   * NOTHING IS SENT, AND NOTHING IS ASSUMED ABOUT WHAT WAS PREPARED.
   *
   * The request carries no body: the coach, the step and the action are the
   * server's to derive from the pursuit plan, which is what stops this screen
   * recording an intent against somebody the campaign would not approach.
   *
   * The card is NOT marked prepared here. The next plan decides whether this
   * programme now shows an attempt, still needs a review, or has been refused by
   * something the preparation had no bearing on — the same way it decided the
   * last one.
   * ---------------------------------------------------------------------------
   */
  const prepare = useCallback(async (programme) => {
    const key = `prepare:${programme.programmeCampaignId}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      setNotice(null);
      await campaigns.prepareNextAttempt(programme.programmeCampaignId);
      /**
       * SAID, NOT ASSUMED, and said in the only words that are true of it. An
       * intent was recorded. No message exists and nothing was sent, so the
       * sentence must not imply either — and the reload is what decides how the
       * card reads afterwards.
       */
      setNotice(`Attempt prepared for ${programme.currentCoach?.name ?? 'the current coach'} at `
        + `${programme.collegeName}. Nothing has been sent. The campaign has been reloaded.`);
      reload();
    } catch (err) {
      /**
       * A FAILED PREPARATION IS NOT A FAILED PLAN — the same rule the approval
       * follows. The plan on screen is still the server's and is still true.
       *
       * Where the message goes depends on what happened. A refusal that means
       * the SERVER HAS MOVED ON — a stance changed, a message was confirmed, the
       * campaign closed — belongs at the page, because the reload that answers
       * it may take the card away. A dropped connection or a 500 belongs on the
       * control that tried, which can safely try again: the endpoint is
       * idempotent.
       */
      const copy = preparationError(err);
      if (copy.refresh) {
        setNotice(copy.message);
        reload();
        return;
      }
      throw Object.assign(err, { operatorMessage: copy.message });
    } finally {
      inFlight.current.delete(key);
    }
  }, [reload]);

  /**
   * ONE MESSAGE, OPEN, INSIDE THIS TAB.
   *
   * ---------------------------------------------------------------------------
   * STATE, NOT A ROUTE.
   *
   * No URL is minted for a message in F10. A deep link would be a durable
   * reference to a row whose whole point is that it is part of a campaign an
   * operator is working through, and inventing one now would settle a
   * navigation design nobody has made. Opening one hides the list and shows the
   * email; going back shows the list again, unchanged.
   *
   *   { programmeCampaignId, messageId, status, message, error }
   *
   * `message` is ALWAYS the server's own resource — from the generate response,
   * the read, the edit or the review. Nothing on this page constructs one.
   * ---------------------------------------------------------------------------
   */
  const [selected, setSelected] = useState(null);

  /**
   * WHERE FOCUS GOES ON THE WAY BACK. The control the operator pressed is on a
   * card that was unmounted while the message was open, so returning has to put
   * them back on it rather than at the top of a page of a hundred schools.
   */
  const returnTo = useRef(null);

  useEffect(() => {
    if (selected || !returnTo.current) return;
    const card = document.querySelector(`[data-programme="${CSS.escape(returnTo.current)}"]`);
    const control = card?.querySelector('[data-testid="open-message"]')
      ?? card?.querySelector('button');
    control?.focus();
    returnTo.current = null;
  }, [selected, programmes]);

  const closeMessage = useCallback(() => setSelected(null), []);

  /**
   * WRITE THE MESSAGE, THEN SHOW IT, THEN GO AND READ THE PLAN AGAIN.
   *
   * ---------------------------------------------------------------------------
   * THE REQUEST CARRIES NO CONTENT AND NOTHING IS SENT.
   *
   * Two identifiers go up; a subject, a body and the evidence behind them come
   * back. The athlete, the recipient, the step, the structure and every sentence
   * are the server's to derive from the campaign and the prepared intent, which
   * is what stops this screen asking for words addressed to somebody the
   * campaign would not approach.
   * ---------------------------------------------------------------------------
   *
   * THE RESPONSE IS THE RESOURCE. The detail view opens on what the server
   * returned rather than on a locally-assembled object, and the plan is reloaded
   * afterwards so the card behind it reports `currentMessage` from server truth.
   * Nothing is fabricated in between.
   */
  const generate = useCallback(async (programme) => {
    const key = `generate:${programme.programmeCampaignId}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      setNotice(null);
      const message = await campaigns.generateMessage(
        programme.programmeCampaignId, programme.currentCoach.id,
      );
      returnTo.current = programme.programmeCampaignId;
      setSelected({
        programmeCampaignId: programme.programmeCampaignId,
        messageId: message.id,
        status: 'ready',
        message,
        error: null,
      });
      reload();
    } catch (err) {
      /**
       * A FAILED GENERATION IS NOT A FAILED PLAN — the same rule approving and
       * preparing follow. The plan on screen is still the server's and is still
       * true, so it stays.
       *
       * A refusal that means the SERVER HAS MOVED ON belongs at the page,
       * because the reload that answers it may take the card away. A dropped
       * connection or a 500 belongs on the control that tried, which can safely
       * try again: generation is idempotent, and a second call returns the
       * message the first one wrote.
       */
      const copy = generationError(err);
      if (copy.refresh) {
        setNotice(copy.message);
        reload();
        return;
      }
      throw Object.assign(err, { operatorMessage: copy.message });
    } finally {
      inFlight.current.delete(key);
    }
  }, [reload]);

  /**
   * OPEN A MESSAGE THAT ALREADY EXISTS. One read, by id.
   *
   * The whole campaign is NOT reloaded to open one email: the plan on screen is
   * still true, and a hundred programmes recomputed to display one body would
   * be the most expensive way possible to answer a cheap question.
   */
  const openMessage = useCallback(async (programme) => {
    const messageId = programme.currentMessage?.id;
    if (!messageId) return;
    returnTo.current = programme.programmeCampaignId;
    setNotice(null);
    setSelected({
      programmeCampaignId: programme.programmeCampaignId,
      messageId,
      status: 'loading',
      message: null,
      error: null,
    });
    try {
      const message = await campaigns.message(messageId);
      setSelected((prev) => (prev?.messageId === messageId
        ? { ...prev, status: 'ready', message } : prev));
    } catch (err) {
      const copy = messageLoadError(err);
      /**
       * GONE MEANS LEAVE. A message that is not there is not a screen to redraw
       * — the operator is returned to the campaign with the sentence at the
       * page, and the reload decides what that card should now say.
       */
      if (copy.gone) {
        setSelected(null);
        setNotice(copy.message);
        reload();
        return;
      }
      setSelected((prev) => (prev?.messageId === messageId
        ? { ...prev, status: 'failed', error: copy.message } : prev));
    }
  }, [reload]);

  const retryMessage = useCallback(() => {
    if (!selected) return;
    const programme = programmes.find(
      (p) => p.programmeCampaignId === selected.programmeCampaignId,
    );
    if (programme) openMessage(programme);
  }, [selected, programmes, openMessage]);

  /**
   * SAVE THE OPERATOR'S WORDS. The changed fields only, and nothing else.
   *
   * NO PLAN RELOAD. Editing changes the subject and body of a message that is
   * already `generated`; it does not change the programme's state, its blockers,
   * its step, or whether a message exists — so there is nothing on the campaign
   * behind this screen that could have become untrue. Reloading a hundred
   * programmes on every save would be a cost with no answer attached.
   */
  const saveMessage = useCallback(async (message, patch) => {
    const key = `edit:${message.id}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      const saved = await campaigns.editMessage(message.id, patch);
      setSelected((prev) => (prev?.messageId === message.id
        ? { ...prev, message: saved } : prev));
    } catch (err) {
      const copy = messageEditError(err);
      /**
       * SOMEBODY REVIEWED IT WHILE THIS WAS OPEN. The edit was not applied and
       * the words on file are final, so the honest move is to show what is
       * actually stored rather than to leave an unsaved draft claiming to be
       * the message.
       */
      if (copy.reload) {
        setNotice(copy.message);
        const programme = programmes.find(
          (p) => p.programmeCampaignId === selected?.programmeCampaignId,
        );
        if (programme) openMessage(programme);
        return;
      }
      if (copy.gone) {
        setSelected(null);
        setNotice(copy.message);
        reload();
        return;
      }
      throw Object.assign(err, { operatorMessage: copy.message });
    } finally {
      inFlight.current.delete(key);
    }
  }, [programmes, selected, openMessage, reload]);

  /**
   * RECORD THAT A PERSON READ THESE EXACT WORDS.
   *
   * ---------------------------------------------------------------------------
   * IT IS NOT SEND APPROVAL.
   *
   * The request carries no body: the reviewer is the session's operator and the
   * timestamp is the server's. Nothing is queued, scheduled or handed to a
   * mailbox, and every stance, suppression, revocation, lifecycle rule, budget
   * and timing check is evaluated afterwards exactly as before.
   * ---------------------------------------------------------------------------
   *
   * THE PLAN IS RELOADED because the card's `currentMessage.state` genuinely
   * changed — which is the one thing a save does not do.
   */
  const reviewMessage = useCallback(async (message) => {
    const key = `review:${message.id}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      const reviewed = await campaigns.reviewMessage(message.id);
      setSelected((prev) => (prev?.messageId === message.id
        ? { ...prev, message: reviewed } : prev));
      reload();
    } catch (err) {
      const copy = messageReviewError(err);
      if (copy.gone) {
        setSelected(null);
        setNotice(copy.message);
        reload();
        return;
      }
      throw Object.assign(err, { operatorMessage: copy.message });
    } finally {
      inFlight.current.delete(key);
    }
  }, [reload]);

  const grouped = useMemo(() => {
    const by = new Map(SECTIONS.map((s) => [s.key, []]));
    for (const p of programmes) by.get(groupFor(p)).push(p);
    return by;
  }, [programmes]);

  /**
   * COUNTS FROM THE CARDS THEMSELVES. `summary` carries its own counters and
   * they slice differently — `operatorReviewRequiredCount` includes budget and
   * integrity states — so deriving these from the same list the sections render
   * is what keeps the header and the page from disagreeing. The whole programme
   * set is in the response, so there is nothing to page over.
   */
  const counts = useMemo(
    () => Object.fromEntries([...grouped].map(([key, list]) => [key, list.length])),
    [grouped],
  );

  /**
   * ONE BANNER FOR WHAT IS TRUE OF THE WHOLE CAMPAIGN.
   *
   * An unset mailbox limit blocks every programme, and F8a's inspection found
   * that with it unconfigured a plan reports every single programme as blocked
   * and ready-count zero. Printed per card that is a hundred identical
   * warnings burying the one thing that is about the school; said once it is
   * what it actually is — a setting nobody has chosen yet.
   */
  const campaignWide = useMemo(() => {
    const seen = new Map();
    for (const p of programmes) {
      for (const b of p.blockers ?? []) {
        if (isCampaignWide(b.code) && !seen.has(b.code)) seen.set(b.code, blockerCopy(b.code));
      }
    }
    return [...seen.entries()].map(([code, copy]) => ({ code, ...copy }));
  }, [programmes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return grouped;
    const by = new Map();
    for (const [key, list] of grouped) {
      by.set(key, list.filter((p) => `${p.collegeName} ${p.currentCoach?.name ?? ''}`
        .toLowerCase().includes(q)));
    }
    return by;
  }, [grouped, query]);

  /**
   * THE NOTICE OUTLIVES THE PAGE IT WAS RAISED ON — F9c.
   *
   * It was rendered only in the READY branch, which was wrong in exactly the
   * case it matters most. A preparation refused because the campaign had closed
   * reloads into "No campaign is running", and the sentence explaining what
   * happened to the operator's click was dropped in the same moment it became
   * true — leaving somebody who had just pressed Confirm with an empty page and
   * no idea whether anything had been recorded.
   *
   * So it is built once and rendered in every terminal state. LOADING still
   * drops it, which is right: the reload is in flight, and it returns with the
   * answer a moment later.
   */
  const noticeCard = notice ? (
    <Card
      ref={noticeRef}
      tabIndex={-1}
      className="p-4 flex items-center justify-between gap-3"
      role="status"
      data-testid="campaign-notice"
    >
      <p className="text-sm">{notice}</p>
      <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>
    </Card>
  ) : null;

  if (status === CAMPAIGN_PLAN.IDLE || status === CAMPAIGN_PLAN.LOADING) return <Loading />;
  if (status === CAMPAIGN_PLAN.FAILED) {
    return (
      <div className="space-y-6">
        {noticeCard}
        <Failed error={error} onRetry={reload} />
      </div>
    );
  }
  if (status === CAMPAIGN_PLAN.NONE) {
    return (
      <div className="space-y-6">
        {noticeCard}
        <Empty otherCampaigns={otherCampaigns} />
      </div>
    );
  }

  /**
   * ONE EMAIL REPLACES THE LIST, RATHER THAN SITTING ON TOP OF IT.
   *
   * Not a modal: a modal is what this repo reserves for deletion, and an email
   * body with its evidence is longer than a dialog should ever be — on a phone
   * it would be a scrolling sheet over a scrolling page. The campaign is still
   * there and Back returns to it with its search and its sections exactly as
   * they were, because nothing about it was unmounted for a reason it could
   * forget.
   *
   * The page notice stays above it: a refusal raised while a message was open
   * is still the answer to what the operator just did.
   */
  if (selected) {
    return (
      <div className="space-y-6">
        {noticeCard}
        <CampaignMessageDetail
          message={selected.message}
          programme={programmes.find(
            (p) => p.programmeCampaignId === selected.programmeCampaignId,
          ) ?? null}
          status={selected.status}
          error={selected.error}
          onBack={closeMessage}
          onRetry={retryMessage}
          onSave={saveMessage}
          onReview={reviewMessage}
        />
      </div>
    );
  }

  const visible = [...filtered.values()].reduce((n, list) => n + list.length, 0);

  return (
    <div className="space-y-6">
      <Card className="p-4 space-y-3" data-testid="campaign-summary">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-medium">Campaign</h2>
            <Badge variant={campaign.state === 'active' ? 'green' : 'muted'}>
              {CAMPAIGN_STATE_COPY[campaign.state] ?? campaign.state}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {campaign.starts_on ? `Started ${shortDate(campaign.starts_on)} · ` : ''}
            {programmes.length} {programmes.length === 1 ? 'programme' : 'programmes'}
          </p>
        </div>

        {/* Text, never colour alone — every count says what it counts. */}
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {SECTIONS.map(({ key }) => (counts[key] ? (
            <li key={key} data-testid={`count-${key}`}>
              <span className="font-medium text-foreground">{counts[key]}</span>
              {' '}
              {COUNT_LABEL[key]}
            </li>
          ) : null))}
        </ul>
      </Card>

      {noticeCard}

      {campaignWide.map((b) => (
        <Card key={b.code} className="p-4 space-y-1" role="status" data-testid="campaign-banner">
          <p className="text-sm font-medium">{b.label}</p>
          <p className="text-xs text-muted-foreground">{b.description}</p>
        </Card>
      ))}

      {programmes.length === 0 ? (
        <Card className="p-6 space-y-1" data-testid="campaign-no-programmes">
          <p className="text-sm font-medium">This campaign contains no programmes</p>
          <p className="text-sm text-muted-foreground">
            It was frozen without any, so there is nothing for it to do.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search school or coach"
              aria-label="Search programmes by school or coach"
              className="max-w-xs"
            />
            {query && (
              <p className="text-xs text-muted-foreground">
                {visible} of {programmes.length}
              </p>
            )}
          </div>

          {SECTIONS.map(({ key, title, blurb, compact }) => {
            const list = filtered.get(key) ?? [];
            if (!list.length) return null;
            return (
              <section key={key} className="space-y-3" aria-labelledby={`campaign-${key}`}>
                <div className="space-y-1">
                  <h3 id={`campaign-${key}`} className="text-sm font-medium">
                    {title} <span className="text-muted-foreground">({list.length})</span>
                  </h3>
                  {blurb && <p className="text-xs text-muted-foreground">{blurb}</p>}
                </div>
                <div className={compact
                  ? 'grid grid-cols-1 sm:grid-cols-2 gap-3'
                  : 'space-y-3'}
                >
                  {list.map((p) => (
                    <CampaignProgrammeCard
                      key={p.programmeCampaignId}
                      programme={p}
                      compact={compact}
                      /*
                        TWO STATE-CHANGING CONTROLS, AND NEITHER SENDS ANYTHING.

                        Approving is offered on the one group whose cards carry
                        a review. Preparing is offered on EVERY group, because
                        whether it appears is the server's decision and not a
                        section's: `preparableNow` is true on a Waiting card
                        whose follow-up is not due yet, and false on a Ready card
                        that has already been prepared. Gating it by group here
                        would be this screen inventing a rule the plan has not
                        got — and would hide the control on exactly the
                        programmes preparation exists for.
                      */
                      onApprove={key === GROUP.REVIEW ? approve : null}
                      onPrepare={prepare}
                      /*
                        AND TWO MORE, OFFERED EVERYWHERE FOR THE SAME REASON.
                        Whether a message can be written is `currentAttempt.id`
                        and `currentMessage.id` — the server's answers — and
                        whether one can be opened is whether one exists. A
                        section is not a permission, and gating either by group
                        would hide them on exactly the programmes that have them.
                      */
                      onGenerate={generate}
                      onOpenMessage={openMessage}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {query && visible === 0 && (
            <p className="text-sm text-muted-foreground">No programme matches “{query}”.</p>
          )}
        </>
      )}
    </div>
  );
}
