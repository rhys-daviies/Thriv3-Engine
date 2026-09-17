import React, { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/Disclosure';
import { ORIGIN_LABEL, ORIGIN_UNRECORDED } from '@/lib/outreachLabels';
import {
  blockerCopy, isCampaignWide, BLOCKER_CATEGORY, ACTION_COPY, REASON_COPY, ROLE_COPY,
  EMAIL_STATUS_COPY, shortDate, PREPARE_COPY, preparedLabel, MESSAGE_COPY, messageStateLabel,
} from '@/lib/campaignLabels';

/**
 * ONE PROGRAMME IN A CAMPAIGN, AS THE SERVER DESCRIBES IT.
 *
 * A card answers five questions and stops — which school, which coach, what
 * step, what state, and why — with the rest behind a disclosure.
 *
 * IT DECIDES NOTHING. Which group a card is in, whether it is executable,
 * whether a new attempt may be prepared, what the next action is and whether
 * prior contact needs reviewing are all FIELDS ON THE PLAN. This formats them.
 *
 * FOUR CONTROLS, AND NONE OF THEM SENDS ANYTHING. Approving a first touch
 * records that a person has read a coach's prior contact; preparing an attempt
 * records that the campaign intends to write to them; generating writes the
 * words into a row; opening shows them to a person. No control on this card, or
 * anywhere on this page, hands a message to a mailbox, a queue or a schedule.
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

/**
 * THE ONE THING THIS SCREEN CAN CHANGE.
 *
 * Approving a first touch records that a PERSON has looked at the prior contact
 * and is content for the campaign's opening message to go. It approves nothing
 * else: not a message, not a send, not the campaign. Every stance, suppression,
 * revocation and lifecycle rule is evaluated afterwards exactly as before, and
 * there is still no control anywhere on this page that makes an email happen.
 *
 * Three steps, inline. A modal is what this repo reserves for DELETION — the
 * one irreversible thing it does — and an approval is neither destructive nor
 * final: re-approving replaces it, and the hold comes back on its own the
 * moment new contact is recorded. What the middle step buys is the scope said
 * out loud, naming the coach and the school, so a click on the wrong card is
 * caught before it is a decision on the record.
 */
function ApproveFirstTouch({ programme, onApprove }) {
  const [mode, setMode] = useState('idle');
  const [error, setError] = useState(null);
  const coach = programme.currentCoach;

  /**
   * FOCUS FOLLOWS THE STEP, because the control the operator was on keeps being
   * replaced. Pressing Approve swaps the button for two others, and cancelling
   * or failing swaps them back — a keyboard user left on a removed element is
   * returned to the top of the document each time.
   *
   * Only the steps this component owns. Where an approval succeeds the whole
   * plan is replaced, and where focus goes then is the page's business rather
   * than a card that may no longer exist.
   */
  const approveRef = useRef(null);
  const confirmRef = useRef(null);
  const returning = useRef(false);

  useEffect(() => {
    if (mode === 'confirming') confirmRef.current?.focus();
    else if (returning.current) {
      approveRef.current?.focus();
      returning.current = false;
    }
  }, [mode]);

  /**
   * A NEW PLAN CLEARS THIS. `programme` is a fresh object on every successful
   * load, so a reload after approving returns the control to rest — and if the
   * server still holds the review, it comes back ready to be pressed again
   * rather than stuck pending.
   */
  useEffect(() => { setMode('idle'); setError(null); }, [programme]);

  const submit = async () => {
    setMode('pending');
    setError(null);
    try {
      await onApprove(programme);
      // Left pending: the reload replaces this card's data, and the effect
      // above is what returns it to rest. Nothing is assumed in between.
    } catch (err) {
      // Back to the control that can try again, with the alert beside it.
      returning.current = true;
      setMode('idle');
      setError(err);
    }
  };

  const stale = programme.firstTouchReview?.approval?.status === 'stale';
  const where = `${coach.name} at ${programme.collegeName}`;

  return (
    <div className="space-y-2">
      {mode === 'idle' && (
        <Button
          ref={approveRef}
          size="sm"
          variant="outline"
          onClick={() => setMode('confirming')}
          /* Named in full, because a screen reader hears this without the card. */
          aria-label={`${stale ? 'Review again' : 'Approve first touch'}: ${where}`}
        >
          {stale ? 'Review again' : 'Approve first touch'}
        </Button>
      )}

      {mode === 'confirming' && (
        <div className="space-y-2">
          <p className="text-sm">
            Approve the campaign’s first outreach to <span className="font-medium">{where}</span>,
            knowing this athlete has contacted them before?
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { returning.current = true; setMode('idle'); }}
            >
              Cancel
            </Button>
            <Button
              ref={confirmRef}
              size="sm"
              onClick={submit}
              aria-label={`Confirm approval: ${where}`}
            >
              Confirm approval
            </Button>
          </div>
        </div>
      )}

      {mode === 'pending' && (
        <p className="text-sm text-muted-foreground" role="status" data-testid="approval-pending">
          Recording your review…
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert" data-testid="approval-error">
          {error.operatorMessage ?? 'Approval could not be recorded. Try again.'}
        </p>
      )}
    </div>
  );
}

/**
 * RECORD THAT THIS CAMPAIGN INTENDS TO CONTACT THE CURRENT COACH.
 *
 * ---------------------------------------------------------------------------
 * IT IS NOT A SEND BUTTON, AND IT MUST NOT LOOK LIKE ONE.
 *
 * Nothing is composed, queued, scheduled or handed to a mailbox. So the control
 * is an outline button the same weight as Approve rather than a primary action,
 * the confirmation says out loud that nothing will be sent, and the state it
 * produces reads as operational metadata rather than a success banner. An
 * operator who came away thinking outreach had started would have been misled
 * by this component, not by the server.
 * ---------------------------------------------------------------------------
 *
 * Three steps, inline, mirroring the first-touch approval beside it. A modal is
 * what this repo reserves for deletion. What the middle step buys is the scope
 * said out loud — the coach and the school — so a click on the wrong card is
 * caught before it is a row on the record.
 */
function PrepareAttempt({ programme, onPrepare }) {
  const [mode, setMode] = useState('idle');
  const [error, setError] = useState(null);
  const coach = programme.currentCoach;

  /**
   * FOCUS FOLLOWS THE STEP, because the control the operator was on keeps being
   * replaced — pressing Prepare swaps the button for two others, and cancelling
   * or failing swaps them back. Only the steps this component owns: where a
   * preparation succeeds the whole plan is replaced, and where focus goes then
   * is the page's business rather than a card that may no longer exist.
   */
  const prepareRef = useRef(null);
  const confirmRef = useRef(null);
  const returning = useRef(false);

  useEffect(() => {
    if (mode === 'confirming') confirmRef.current?.focus();
    else if (returning.current) {
      prepareRef.current?.focus();
      returning.current = false;
    }
  }, [mode]);

  /** A new plan returns the control to rest — see the approval control above. */
  useEffect(() => { setMode('idle'); setError(null); }, [programme]);

  const submit = async () => {
    setMode('pending');
    setError(null);
    try {
      await onPrepare(programme);
      /*
        LEFT PENDING ON PURPOSE. Nothing is rendered as prepared until the
        server says so: the reload replaces this card's data and the effect
        above returns it to rest. An optimistic marker would claim an intent
        that a refusal or a dropped response never actually recorded.
      */
    } catch (err) {
      returning.current = true;
      setMode('idle');
      setError(err);
    }
  };

  const where = coach?.name ? `${coach.name} at ${programme.collegeName}` : programme.collegeName;

  return (
    <div className="space-y-2" data-testid="prepare-attempt">
      {mode === 'idle' && (
        <Button
          ref={prepareRef}
          size="sm"
          variant="outline"
          onClick={() => setMode('confirming')}
          /* Named in full, because a screen reader hears this without the card. */
          aria-label={`${PREPARE_COPY.action}: ${where}`}
        >
          {PREPARE_COPY.action}
        </Button>
      )}

      {mode === 'confirming' && (
        <div className="space-y-2">
          <p className="text-sm">
            Prepare this attempt for <span className="font-medium">{where}</span>?
          </p>
          {/* The one sentence that keeps the button honest. */}
          <p className="text-xs text-muted-foreground">{PREPARE_COPY.explain}</p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { returning.current = true; setMode('idle'); }}
            >
              {PREPARE_COPY.cancel}
            </Button>
            <Button
              ref={confirmRef}
              size="sm"
              variant="outline"
              onClick={submit}
              aria-label={`${PREPARE_COPY.confirm}: ${where}`}
            >
              {PREPARE_COPY.confirm}
            </Button>
          </div>
        </div>
      )}

      {mode === 'pending' && (
        <p className="text-sm text-muted-foreground" role="status" data-testid="prepare-pending">
          {PREPARE_COPY.pending}
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert" data-testid="prepare-error">
          {error.operatorMessage ?? 'The attempt could not be prepared. Try again.'}
        </p>
      )}
    </div>
  );
}

/**
 * AN ATTEMPT IS ON FILE, SAID AS QUIETLY AS IT DESERVES.
 *
 * Operational metadata, not an achievement: no colour, no badge weight, no
 * green. The campaign has recorded that it means to write to this coach, and
 * nothing has been sent — so this sits in the same muted line as the rest of
 * the card's bookkeeping.
 */
function PreparedMarker({ currentAttempt }) {
  const prepared = preparedLabel(currentAttempt);
  if (!prepared) return null;
  return (
    <p className="text-xs text-muted-foreground" data-testid="attempt-prepared">
      <span className="text-foreground">{prepared.label}</span>
      {/* No date rather than a fabricated one — the attempt exists either way. */}
      {prepared.on ? ` · Prepared ${prepared.on}` : ''}
    </p>
  );
}

/**
 * WRITE THE WORDS THIS CAMPAIGN WOULD SEND THIS COACH.
 *
 * ---------------------------------------------------------------------------
 * IT IS STILL NOT A SEND BUTTON.
 *
 * Generating composes a subject and a body into a row and stops. No mailbox is
 * touched, nothing is queued, scheduled or dispatched, and `outreach_send`
 * remains the only thing in this build that says a message happened. So the
 * control is the same outline weight as Prepare and Approve beside it, the
 * confirmation says out loud that nothing will be sent, and no wording anywhere
 * on this card calls the result ready.
 * ---------------------------------------------------------------------------
 *
 * Three steps, inline, mirroring the two controls above it. What the middle step
 * buys is the scope said out loud — the coach and the school — so a click on the
 * wrong card is caught before it is content on the record.
 */
function GenerateMessage({ programme, onGenerate }) {
  const [mode, setMode] = useState('idle');
  const [error, setError] = useState(null);
  const coach = programme.currentCoach;

  const generateRef = useRef(null);
  const confirmRef = useRef(null);
  const returning = useRef(false);

  useEffect(() => {
    if (mode === 'confirming') confirmRef.current?.focus();
    else if (returning.current) {
      generateRef.current?.focus();
      returning.current = false;
    }
  }, [mode]);

  /** A new plan returns the control to rest — see the two controls above. */
  useEffect(() => { setMode('idle'); setError(null); }, [programme]);

  const submit = async () => {
    setMode('pending');
    setError(null);
    try {
      await onGenerate(programme);
      /*
        LEFT PENDING ON PURPOSE. Nothing is rendered as written until the server
        says so — a success opens the detail view on the resource it returned,
        and a refusal or a dropped response never claimed one.
      */
    } catch (err) {
      returning.current = true;
      setMode('idle');
      setError(err);
    }
  };

  const where = coach?.name ? `${coach.name} at ${programme.collegeName}` : programme.collegeName;

  return (
    <div className="space-y-2" data-testid="generate-message">
      {mode === 'idle' && (
        <Button
          ref={generateRef}
          size="sm"
          variant="outline"
          onClick={() => setMode('confirming')}
          /* Named in full, because a screen reader hears this without the card. */
          aria-label={`${MESSAGE_COPY.generate}: ${where}`}
        >
          {MESSAGE_COPY.generate}
        </Button>
      )}

      {mode === 'confirming' && (
        <div className="space-y-2">
          <p className="text-sm">
            Generate the message for <span className="font-medium">{where}</span>?
          </p>
          {/* The one sentence that keeps the button honest. */}
          <p className="text-xs text-muted-foreground">{MESSAGE_COPY.generateExplain}</p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { returning.current = true; setMode('idle'); }}
            >
              {MESSAGE_COPY.cancel}
            </Button>
            <Button
              ref={confirmRef}
              size="sm"
              variant="outline"
              onClick={submit}
              aria-label={`${MESSAGE_COPY.generateConfirm}: ${where}`}
            >
              {MESSAGE_COPY.generateConfirm}
            </Button>
          </div>
        </div>
      )}

      {mode === 'pending' && (
        <p className="text-sm text-muted-foreground" role="status" data-testid="generate-pending">
          {MESSAGE_COPY.generatePending}
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert" data-testid="generate-error">
          {error.operatorMessage ?? 'The message could not be written. Try again.'}
        </p>
      )}
    </div>
  );
}

/**
 * A MESSAGE EXISTS, SAID AS QUIETLY AS THE PREPARED MARKER BESIDE IT.
 *
 * `Generated` and `Reviewed` are states of WORDS. Neither means contactable,
 * due, within budget or sendable, so neither gets a colour, a green badge or
 * the word "ready" — the card's own blockers above remain the only account of
 * whether this campaign may write to this coach at all.
 *
 * The control it carries OPENS the message. It is the only way onto the review
 * screen, and it changes nothing by itself.
 */
function MessageMarker({ programme, onOpenMessage }) {
  const message = programme.currentMessage;
  if (!message?.id) return null;

  const reviewed = message.state === 'reviewed';
  const where = programme.currentCoach?.name
    ? `${programme.currentCoach.name} at ${programme.collegeName}`
    : programme.collegeName;

  return (
    <div className="space-y-2" data-testid="message-marker">
      <p className="text-xs text-muted-foreground" data-testid="message-status">
        <span className="text-foreground">{messageStateLabel(message.state)}</span>
        {/* No date rather than a fabricated one — the message exists either way. */}
        {shortDate(message.generatedAt) ? ` · Written ${shortDate(message.generatedAt)}` : ''}
      </p>
      {onOpenMessage && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onOpenMessage(programme)}
          aria-label={`${reviewed ? MESSAGE_COPY.openReviewed : MESSAGE_COPY.open}: ${where}`}
          data-testid="open-message"
        >
          {reviewed ? MESSAGE_COPY.openReviewed : MESSAGE_COPY.open}
        </Button>
      )}
    </div>
  );
}

export default function CampaignProgrammeCard({
  programme, compact = false, onApprove = null, onPrepare = null,
  onGenerate = null, onOpenMessage = null,
}) {
  const {
    collegeName, rank, tier, tierSource, programmeState, currentCoach,
    nextAction, derivedStep, policyReason, blockers, policyEligibleOn, candidates,
    firstTouchReview, preparableNow, currentAttempt, currentMessage,
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
        AN ATTEMPT IS ON FILE. Shown wherever one exists, in whichever group the
        card is in — it is a fact about the programme rather than a property of
        a section, and a prepared programme in Waiting is still prepared.
      */}
      <PreparedMarker currentAttempt={currentAttempt} />

      {/*
        AND WHETHER THE WORDS EXIST YET. Shown wherever a message does, in
        whichever group the card is in — a written message under a Waiting
        programme is still written, and hiding it would make an operator
        generate a second one to find out.
      */}
      <MessageMarker programme={programme} onOpenMessage={onOpenMessage} />

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
              ? 'This review is out of date because further confirmed contact has been recorded '
                + 'since it was approved.'
              : 'The first outreach of this campaign to this coach needs reviewing.'}
          </p>

          {/*
            OFFERED ONLY WHERE THE SERVER SAYS THERE IS SOMETHING TO APPROVE and
            the identifiers it would be approved with are the plan's own. No
            control is reconstructed from a school name.
          */}
          {onApprove && currentCoach?.id && programme.programmeCampaignId && (
            <ApproveFirstTouch programme={programme} onApprove={onApprove} />
          )}
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

      {/*
        OFFERED ON THE SERVER'S WORD ALONE.

        `preparableNow` is the plan's own answer to whether a NEW attempt can be
        recorded, and `currentAttempt.id` is its answer to whether one already
        is. Neither is re-derived here, and neither is `executableNow`: that
        field answers whether something could be SENT now, and gating on it
        would hide the control on exactly the programmes preparation is for —
        a follow-up that is not due yet, a campaign whose mailbox limit is
        unset, a day whose budget is spent. The two disagree on purpose.
      */}
      {onPrepare && preparableNow && !currentAttempt?.id && (
        <PrepareAttempt programme={programme} onPrepare={onPrepare} />
      )}

      {/*
        AND GENERATION IS OFFERED ON THE SERVER'S WORD TOO — F10b-5.

        `currentAttempt.id` is the plan's answer to whether this campaign has
        recorded an intent to write to this coach, and `currentMessage.id` is
        its answer to whether the words already exist. Both are the SERVER'S,
        neither is re-derived here, and neither is `executableNow`: writing a
        message is not sending one, so a follow-up that is not due yet and a
        campaign whose mailbox limit is unset can both be written.

        WHAT THIS SCREEN MUST NOT DO is invent a safety rule of its own. The
        generation gate is the authority on whether these words may be written,
        and it refuses with a code this card turns into a sentence — which is
        why an operator meets a real refusal rather than a hidden control.
      */}
      {onGenerate && currentAttempt?.id && !currentMessage?.id && (
        <GenerateMessage programme={programme} onGenerate={onGenerate} />
      )}

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
