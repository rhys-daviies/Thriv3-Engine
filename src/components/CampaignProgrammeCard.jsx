import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Disclosure } from '@/components/ui/Disclosure';
import { ORIGIN_LABEL, ORIGIN_UNRECORDED } from '@/lib/outreachLabels';
import {
  blockerCopy, isCampaignWide, BLOCKER_CATEGORY, ACTION_COPY, REASON_COPY, ROLE_COPY,
  EMAIL_STATUS_COPY, shortDate,
} from '@/lib/campaignLabels';

/**
 * ONE PROGRAMME IN A CAMPAIGN, AS THE SERVER DESCRIBES IT.
 *
 * READ-ONLY. There is no button here, and that is this slice's whole point:
 * the screen has to be legible before it is allowed to do anything. A card
 * answers five questions and stops — which school, which coach, what step,
 * what state, and why — with the rest behind a disclosure.
 *
 * IT DECIDES NOTHING. Which group a card is in, whether it is executable, what
 * the next action is and whether prior contact needs reviewing are all fields
 * on the plan. This formats them.
 */

/** The facts a first-touch review is made on, and no more than the facts. */
function PriorContact({ priorContact }) {
  /**
   * `hasConfirmedSend` IS THE QUESTION, NEVER THE COUNT. A relationship older
   * than the per-message table reports a confirmed send with a count of zero,
   * so `count > 0` would hide exactly the coaches with the longest history.
   */
  if (!priorContact?.hasConfirmedSend) return null;

  const { confirmedSendCount: count, firstConfirmedSendAt, lastConfirmedSendAt, origins } =
    priorContact;
  const routes = (origins ?? []).map((o) => ORIGIN_LABEL[o] ?? ORIGIN_UNRECORDED);

  return (
    <div className="space-y-2">
      <p className="text-sm">
        This athlete has already had confirmed outreach to this coach.
      </p>
      <ul className="text-xs text-muted-foreground space-y-1">
        <li>
          {/*
            ZERO IS AN HONEST COUNT. A message went — the relationship records
            it — and nothing recorded how many, which is what a relationship
            older than the message table looks like.
          */}
          {count > 0
            ? `${count} confirmed ${count === 1 ? 'send' : 'sends'} on file`
            : 'A confirmed send is on file; the number of messages was not recorded'}
        </li>
        {lastConfirmedSendAt && <li>Last confirmed contact {shortDate(lastConfirmedSendAt)}</li>}
        {firstConfirmedSendAt && firstConfirmedSendAt !== lastConfirmedSendAt && (
          <li>First confirmed contact {shortDate(firstConfirmedSendAt)}</li>
        )}
        {routes.length > 0 && <li>{routes.join(' · ')}</li>}
      </ul>
    </div>
  );
}

/** Why the campaign is not sending, in words, minus anything campaign-wide. */
function Blockers({ blockers, policyEligibleOn, alreadySaid = [] }) {
  /**
   * CAPACITY AND CONFIGURATION ARE NOT ABOUT THIS SCHOOL. An unset mailbox
   * limit blocks every programme in the campaign, and printing it on each of a
   * hundred cards would bury the one thing that IS about this school. It is
   * said once, at the page.
   *
   * NOR IS ANYTHING THE CARD HAS ALREADY EXPLAINED. The review panel above
   * states the prior-contact hold in full, with the history behind it; adding
   * the one-line version underneath made the longest card on the page repeat
   * its own headline.
   */
  const local = (blockers ?? [])
    .filter((b) => !isCampaignWide(b.code) && !alreadySaid.includes(b.code));
  if (!local.length) return null;

  return (
    <ul className="space-y-1.5">
      {local.map((b) => {
        const copy = blockerCopy(b.code);
        const dated = b.code === 'FOLLOW_UP_NOT_YET_DUE' && policyEligibleOn;
        /**
         * A PROHIBITION READS DIFFERENTLY FROM A PREFERENCE.
         *
         * "Do not contact" and "Manual outreach only" both stop a campaign, and
         * they are not the same thing: one is an instruction about the person,
         * the other is a decision about which route the work takes. Set in the
         * same weight they scan as interchangeable. The colour is a second
         * signal, never the only one — the wording carries it alone.
         */
        const prohibited = copy.category === BLOCKER_CATEGORY.PROHIBITION;
        return (
          <li key={`${b.source}:${b.code}`} className="text-xs">
            <span className={prohibited ? 'font-medium text-destructive' : 'font-medium text-foreground'}>
              {dated ? `Follow-up due ${shortDate(policyEligibleOn)}` : copy.label}
            </span>
            <span className="text-muted-foreground"> — {copy.description}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function CampaignProgrammeCard({ programme, compact = false }) {
  const {
    collegeName, rank, tier, tierSource, programmeState, currentCoach,
    nextAction, derivedStep, policyReason, blockers, policyEligibleOn, candidates,
    firstTouchReview,
  } = programme;

  const role = currentCoach ? (ROLE_COPY[currentCoach.role] ?? currentCoach.role) : null;
  const emailNote = currentCoach ? EMAIL_STATUS_COPY[currentCoach.emailStatus] : null;
  const action = ACTION_COPY[nextAction] ?? null;
  const reason = REASON_COPY[policyReason] ?? null;
  const approval = firstTouchReview?.approval;

  return (
    <Card
      className={compact ? 'p-3 space-y-1' : 'p-4 space-y-3'}
      data-testid="campaign-programme"
      data-programme={programme.programmeCampaignId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{collegeName}</p>
          {currentCoach ? (
            <p className="text-xs text-muted-foreground truncate">
              {currentCoach.name}
              {role ? ` · ${role}` : ''}
              {currentCoach.email ? ` · ${currentCoach.email}` : ''}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No coach selected for this programme</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-muted-foreground">#{rank}</span>
          <Badge variant="muted">
            Tier {tier}
            {tierSource === 'OPERATOR' ? ' · set by operator' : ''}
          </Badge>
          {/* Only where it is not the ordinary case, so a badge means something. */}
          {programmeState !== 'queued' && programmeState !== 'active' && (
            <Badge variant="muted">{programmeState}</Badge>
          )}
        </div>
      </div>

      {action && (
        <p className="text-xs text-muted-foreground">
          <span className="text-foreground font-medium">{action}</span>
          {derivedStep ? ` · step ${derivedStep}` : ''}
          {reason ? ` · ${reason}` : ''}
        </p>
      )}

      {emailNote && <p className="text-xs text-muted-foreground">{emailNote}</p>}

      {/*
        THE REVIEW, STATED AND NOT YET ACTIONABLE. The button arrives in the
        next slice; what this checkpoint is testing is whether an operator can
        tell from the card alone what they would be deciding.
      */}
      {firstTouchReview?.required && (
        <div className="rounded-lg border border-border p-3 space-y-2" data-testid="first-touch-review">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="amber">{blockerCopy('PRIOR_CONFIRMED_CONTACT').short}</Badge>
            {approval?.status === 'stale' && (
              <Badge variant="muted" data-testid="stale-approval">
                Reviewed {shortDate(approval.approvedAt)} · contact recorded since
              </Badge>
            )}
          </div>
          <PriorContact priorContact={currentCoach?.priorContact} />
          <p className="text-xs text-muted-foreground">
            {approval?.status === 'stale'
              ? 'The earlier review no longer matches what is on file, so this needs reviewing again.'
              : 'The first outreach of this campaign to this coach needs reviewing.'}
          </p>
        </div>
      )}

      {/*
        THE REASON IS SHOWN EVEN ON A COMPACT CARD. `compact` is density, not
        redaction — and the groups that use it are exactly the ones whose title
        says least: "Complete" covers both a programme written to in full and
        one where nobody was reachable, and "Waiting" says nothing about which
        day. Hiding the line would make the section heading the only
        explanation, which for those two is not enough.
      */}
      <Blockers
        blockers={blockers}
        policyEligibleOn={policyEligibleOn}
        alreadySaid={firstTouchReview?.required ? ['PRIOR_CONFIRMED_CONTACT'] : []}
      />

      {!compact && candidates && (
        <Disclosure
          header={<span className="text-xs text-muted-foreground">Staff depth</span>}
          bodyClassName="pt-2"
        >
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>{candidates.eligible} reachable at this programme</li>
            {candidates.beyondDepth > 0 && (
              <li>{candidates.beyondDepth} beyond this tier’s pursuit depth</li>
            )}
            {candidates.ineligible > 0 && (
              <li>{candidates.ineligible} not approachable — role, address or opt-out</li>
            )}
          </ul>
        </Disclosure>
      )}
    </Card>
  );
}
