import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  MESSAGE_COPY, messageStateLabel, evidenceSentences, shortDate, ROLE_COPY,
} from '@/lib/campaignLabels';

/**
 * ONE EMAIL, READ THE WAY A PERSON READS AN EMAIL.
 *
 * ---------------------------------------------------------------------------
 * THIS IS A REVIEW SCREEN, NOT A SECOND CAMPAIGN DASHBOARD.
 *
 * A campaign holds a hundred programmes and rendering a hundred email bodies
 * into a list would be neither readable nor honest about which one an operator
 * is deciding on. So the campaign lists, and this shows exactly one: who it is
 * addressed to, which message of the sequence it is, what it says, and WHY it
 * says it.
 *
 * NOTHING HERE SENDS. There is no send, queue, schedule, dispatch or approve
 * control on this screen, and `reviewed` is a statement about WORDS — that a
 * named person read these exact ones. Whether the campaign may write to this
 * coach at all is the card's business and is evaluated afterwards exactly as
 * before.
 * ---------------------------------------------------------------------------
 *
 * IT DECIDES NOTHING ABOUT THE MESSAGE EITHER. The state, the recipient, the
 * step, the evidence and both versions of the text are fields on the server's
 * own resource. This formats them, keeps one draft of the operator's edits, and
 * hands them back unchanged.
 */

/**
 * A label bound to its control, because a placeholder is not a label.
 *
 * A reviewed message has no control to bind to — the words are final and are
 * rendered as text — so the label becomes a heading for the text rather than a
 * `for` pointing at an element that is not there.
 */
function Field({ id = null, label, children }) {
  return (
    <div className="space-y-1.5">
      {id ? (
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>
      ) : (
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      )}
      {children}
    </div>
  );
}

/**
 * WHY THIS WAS WRITTEN — the point of the whole slice.
 *
 * The sentences the email actually made, in the order it made them. NOT the
 * held claims: those are the things the body cap licensed and deliberately left
 * out, and offering them as justification would credit this email with saying
 * something it does not say. See `evidenceSentences`.
 */
function Evidence({ evidence }) {
  const sentences = useMemo(() => evidenceSentences(evidence), [evidence]);

  return (
    <section className="space-y-2" aria-labelledby="message-evidence" data-testid="message-evidence">
      <h3 id="message-evidence" className="text-sm font-medium">{MESSAGE_COPY.evidenceHeading}</h3>
      {sentences.length === 0 ? (
        /* Truthful rather than empty: no evidence is a fact, not a missing panel. */
        <p className="text-xs text-muted-foreground" data-testid="message-evidence-none">
          {MESSAGE_COPY.evidenceNone}
        </p>
      ) : (
        <ul className="space-y-2">
          {sentences.map((s) => (
            <li key={s.key} className="text-sm">
              {s.role && (
                <span className="text-xs text-muted-foreground block">{s.role}</span>
              )}
              <span className="break-words">{s.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

export default function CampaignMessageDetail({
  message,
  programme = null,
  status = 'ready',
  error = null,
  onBack,
  onRetry = null,
  onSave,
  onReview,
}) {
  /**
   * THE OPERATOR'S DRAFT, HELD LOCALLY AND SENT ONLY WHEN THEY SAY SO.
   *
   * Not a PATCH per keystroke: every character would be a write, a version and
   * an `updated_at` on a row whose whole purpose is to record what a person
   * approved. Dirty is computed against the server's copy rather than tracked
   * with a flag, so typing a change and typing it back is not dirty.
   */
  const [subject, setSubject] = useState(message?.subject ?? '');
  const [body, setBody] = useState(message?.body ?? '');
  const [mode, setMode] = useState('idle');
  const [saved, setSaved] = useState(false);
  const [localError, setLocalError] = useState(null);

  const headingRef = useRef(null);
  const bodyRef = useRef(null);
  const reviewedRef = useRef(null);
  const confirmRef = useRef(null);
  const discardRef = useRef(null);

  const reviewed = message?.state === 'reviewed';
  const dirty = Boolean(message) && !reviewed
    && (subject !== (message.subject ?? '') || body !== (message.body ?? ''));

  /**
   * A NEW SERVER RESOURCE REPLACES THE DRAFT, and nothing else does. Saving and
   * reviewing both return the stored row, so the fields become what is actually
   * on file rather than what was typed — which is the only way an operator can
   * trust that the words they reviewed are the words that were kept.
   */
  useEffect(() => {
    setSubject(message?.subject ?? '');
    setBody(message?.body ?? '');
    setMode('idle');
    setLocalError(null);
  }, [message]);

  /**
   * FOCUS ARRIVES WITH THE SCREEN. The campaign list is gone and a keyboard
   * user pressed a control that no longer exists, so the heading of what
   * replaced it takes focus and announces where they are.
   */
  useEffect(() => {
    if (status === 'ready') headingRef.current?.focus();
  }, [status, message?.id]);

  /** And moves to the recorded status the moment a review lands. */
  useEffect(() => { if (reviewed) reviewedRef.current?.focus(); }, [reviewed]);

  /**
   * THE WHOLE EMAIL, NOT A WINDOW ONTO IT — found by looking at the real screen.
   *
   * A fixed-height textarea gives a nine-paragraph email its own scrollbar
   * inside a page that also scrolls: the operator reads the thing they are
   * reviewing through a letterbox, and a wheel over the field scrolls the
   * message instead of the page. An email is a document, so the field grows to
   * fit it and the page does the scrolling.
   *
   * `scrollHeight` after a reset to `auto`, because a shrinking edit would
   * otherwise keep the height the longest draft ever had — plus the border,
   * which `scrollHeight` excludes and `box-sizing: border-box` then charges
   * against the content. Two pixels short is two pixels of scrollbar.
   *
   * AND IT RE-MEASURES ON WIDTH, not only on content — found in F10c by
   * narrowing a real browser to a phone. The same text rewraps into far more
   * lines at 375px than at 1200, so a height measured once at the wider size
   * clipped 2,700 pixels of a long email behind exactly the internal scrollbar
   * this effect exists to remove. A rotation or a resized window is not an edit,
   * so nothing in the dependency list above would have fired.
   */
  useEffect(() => {
    const field = bodyRef.current;
    if (!field) return undefined;

    let lastWidth = null;
    const fit = () => {
      field.style.height = 'auto';
      const border = field.offsetHeight - field.clientHeight;
      field.style.height = `${field.scrollHeight + border}px`;
      lastWidth = field.clientWidth;
    };
    fit();

    /**
     * A ResizeObserver rather than a window listener: the field also changes
     * width when something OTHER than the viewport does — a panel opening, a
     * zoom, a font loading — and those are the cases a resize event misses.
     *
     * WIDTH ONLY, and that guard is load-bearing rather than tidy. `fit` sets a
     * height, which resizes the very element being observed — so an unguarded
     * observer re-measures on its own writes, and a browser that detects the
     * loop drops the notification rather than raising it. Setting a height never
     * changes a width, so keying on width terminates.
     *
     * Guarded for jsdom and older browsers, where a window event is the honest
     * fallback.
     */
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        if (field.clientWidth !== lastWidth) fit();
      });
      observer.observe(field);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [body, status, message?.id]);

  useEffect(() => {
    if (mode === 'confirming') confirmRef.current?.focus();
    if (mode === 'discarding') discardRef.current?.focus();
  }, [mode]);

  const back = useCallback(() => {
    // Never silently. An unsaved edit is work, and losing it to a misplaced
    // click is the one irreversible thing this screen can do.
    if (dirty) { setMode('discarding'); return; }
    onBack();
  }, [dirty, onBack]);

  const save = async () => {
    setMode('saving');
    setLocalError(null);
    setSaved(false);
    try {
      const patch = {};
      if (subject !== message.subject) patch.subject = subject;
      if (body !== message.body) patch.body = body;
      await onSave(message, patch);
      setSaved(true);
      // Left to the effect above: the new resource is what returns this to rest.
    } catch (err) {
      setMode('idle');
      setLocalError(err);
    }
  };

  const review = async () => {
    setMode('reviewing');
    setLocalError(null);
    try {
      await onReview(message);
    } catch (err) {
      setMode('idle');
      setLocalError(err);
    }
  };

  const BackButton = (
    <Button size="sm" variant="ghost" onClick={back} data-testid="message-back">
      ← {MESSAGE_COPY.back}
    </Button>
  );

  if (status === 'loading') {
    return (
      <div className="space-y-4">
        {BackButton}
        <Card className="p-6" role="status" data-testid="message-loading">
          <p className="text-sm text-muted-foreground">{MESSAGE_COPY.loading}</p>
        </Card>
      </div>
    );
  }

  if (status === 'failed' || !message) {
    return (
      <div className="space-y-4">
        {BackButton}
        <Card className="p-4 flex items-center justify-between gap-3" role="alert" data-testid="message-failed">
          <p className="text-sm">{error ?? 'The message could not be loaded.'}</p>
          {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
        </Card>
      </div>
    );
  }

  const edited = message.bodyHash !== message.generatedBodyHash
    || message.subject !== message.generatedSubject;
  const where = programme?.currentCoach?.name
    ? `${programme.currentCoach.name} at ${programme.collegeName}`
    : programme?.collegeName ?? '';

  return (
    <div className="space-y-4" data-testid="message-detail">
      {BackButton}

      {mode === 'discarding' && (
        <Card className="p-4 space-y-2" role="alertdialog" aria-label={MESSAGE_COPY.discard} data-testid="message-discard">
          <p className="text-sm">{MESSAGE_COPY.discard}</p>
          <div className="flex items-center gap-2">
            <Button ref={discardRef} size="sm" variant="ghost" onClick={() => setMode('idle')}>
              {MESSAGE_COPY.keepEditing}
            </Button>
            <Button size="sm" variant="outline" onClick={onBack} data-testid="message-discard-confirm">
              {MESSAGE_COPY.discardConfirm}
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="text-base font-medium break-words"
              data-testid="message-heading"
            >
              {programme?.collegeName ?? message.recipientEmail}
            </h2>
            {programme?.currentCoach && (
              <p className="text-xs text-muted-foreground break-words">
                {programme.currentCoach.name}
                {/*
                  THE PRODUCT'S OWN WORD FOR THE ROLE, not the stored value. The
                  card renders "Head coach" through `ROLE_COPY` and this screen
                  printed the raw `head` beside it — two names for one fact on
                  two screens an operator moves between in one click.
                */}
                {programme.currentCoach.role
                  ? ` · ${ROLE_COPY[programme.currentCoach.role] ?? programme.currentCoach.role}`
                  : ''}
              </p>
            )}
            {/*
              THE ADDRESS AS STORED ON THE MESSAGE, not as the plan currently
              reports it. The recipient was frozen when the words were written,
              and an address that has changed since does not retroactively
              change who this email is to. `break-all` because an address is one
              long unbreakable token on a phone.
            */}
            <p className="text-xs text-muted-foreground break-all" data-testid="message-recipient">
              {message.recipientEmail}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            {/*
              NEUTRAL, NEVER GREEN. "Reviewed" is a fact about words and not a
              permission to send, and a success colour here would be the screen
              claiming something the server has not said.
            */}
            <Badge variant="muted" data-testid="message-state">{messageStateLabel(message.state)}</Badge>
            <span className="text-xs text-muted-foreground">Step {message.step}</span>
          </div>
        </div>

        {reviewed && (
          <p
            ref={reviewedRef}
            tabIndex={-1}
            className="text-xs text-muted-foreground"
            role="status"
            data-testid="message-reviewed-note"
          >
            {/*
              A DATE, AND NO IDENTIFIER — F10c.

              The server holds `reviewedByOperatorId` and goes on holding it:
              the review is attributed on the record, where an audit needs it.
              What it is NOT is a name, and printing a raw UUID beside a date
              put the one thing on this screen a person cannot read where a
              person's name would go. The choice was between a name we do not
              have and an identifier that says nothing, so the honest line is
              the fact itself — this message was reviewed, on this day.

              A readable reviewer needs the operator's email or display name on
              the resource, which is a server change and an F11 decision. This
              is presentation only: nothing about what is stored has moved.
            */}
            Reviewed{message.reviewedAt ? ` ${shortDate(message.reviewedAt)}` : ''}
            {edited ? ` · ${MESSAGE_COPY.editedBeforeReview}` : ''}
          </p>
        )}

        <Field id={reviewed ? null : 'message-subject'} label="Subject">
          {reviewed ? (
            <p className="text-sm break-words" data-testid="message-subject-readonly">{message.subject}</p>
          ) : (
            <Input
              id="message-subject"
              value={subject}
              onChange={(e) => { setSubject(e.target.value); setSaved(false); }}
              data-testid="message-subject"
            />
          )}
        </Field>

        <Field id={reviewed ? null : 'message-body'} label="Message">
          {reviewed ? (
            <p
              className="text-sm whitespace-pre-wrap break-words"
              data-testid="message-body-readonly"
            >
              {message.body}
            </p>
          ) : (
            <Textarea
              ref={bodyRef}
              id="message-body"
              value={body}
              rows={16}
              /* Grown to its content by the effect above; never scrolled itself. */
              className="min-h-[18rem] font-normal resize-none overflow-hidden"
              onChange={(e) => { setBody(e.target.value); setSaved(false); }}
              data-testid="message-body"
            />
          )}
        </Field>

        {/*
          THE ONE THING IN THE BODY THAT IS NOT A WORD. Shown only where the
          token is actually there, so a message without one carries no note.
        */}
        {String(message.body ?? '').includes(MESSAGE_COPY.profileToken) && (
          <p className="text-xs text-muted-foreground" data-testid="message-token-note">
            {MESSAGE_COPY.profileTokenNote}
          </p>
        )}

        {!reviewed && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                disabled={!dirty || mode === 'saving' || mode === 'reviewing'}
                onClick={save}
                data-testid="message-save"
              >
                {mode === 'saving' ? MESSAGE_COPY.savePending : MESSAGE_COPY.save}
              </Button>

              {mode !== 'confirming' && (
                <Button
                  size="sm"
                  variant="outline"
                  /*
                    REVIEW IS DISABLED WHILE DIRTY, and this is the simpler of
                    the two honest options. Saving first behind the operator's
                    back would record a review of words they had not finished
                    writing, and the helper text below says exactly why the
                    control is unavailable rather than leaving it inert.
                  */
                  disabled={dirty || mode === 'saving' || mode === 'reviewing'}
                  onClick={() => setMode('confirming')}
                  aria-label={where ? `${MESSAGE_COPY.review}: ${where}` : MESSAGE_COPY.review}
                  data-testid="message-review"
                >
                  {MESSAGE_COPY.review}
                </Button>
              )}
            </div>

            {dirty && (
              <p className="text-xs text-muted-foreground" data-testid="message-review-dirty">
                {MESSAGE_COPY.reviewDirty}
              </p>
            )}
            {saved && !dirty && (
              <p className="text-xs text-muted-foreground" role="status" data-testid="message-saved">
                {MESSAGE_COPY.saved}
              </p>
            )}

            {mode === 'confirming' && (
              <div className="space-y-2" data-testid="message-review-confirm">
                <p className="text-sm">Review this message?</p>
                <p className="text-xs text-muted-foreground">{MESSAGE_COPY.reviewExplain}</p>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>
                    {MESSAGE_COPY.cancel}
                  </Button>
                  <Button
                    ref={confirmRef}
                    size="sm"
                    variant="outline"
                    onClick={review}
                    aria-label={where ? `${MESSAGE_COPY.reviewConfirm}: ${where}` : MESSAGE_COPY.reviewConfirm}
                  >
                    {MESSAGE_COPY.reviewConfirm}
                  </Button>
                </div>
              </div>
            )}

            {mode === 'reviewing' && (
              <p className="text-sm text-muted-foreground" role="status" data-testid="message-review-pending">
                {MESSAGE_COPY.reviewPending}
              </p>
            )}

            {localError && (
              <p className="text-sm text-destructive" role="alert" data-testid="message-error">
                {localError.operatorMessage ?? 'That could not be recorded. Try again.'}
              </p>
            )}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <Evidence evidence={message.evidence} />
      </Card>
    </div>
  );
}
