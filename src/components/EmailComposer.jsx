import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, XCircle, Send } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { pickBestContact } from '@shared/coachRoles.js';
import EmailRiskBadge from '@/components/EmailRiskBadge';
import { useCoachEmailStatus, statusOf } from '@/lib/useCoachEmailStatus';
import {
  fillTemplate, buildEmailContext, unresolvedTokens, emailBodyFor, canComposeStructured,
  DEFAULT_EMAIL_SUBJECT,
} from '@/lib/emailTemplate';
import { outreach } from '@/api/client';
import { useEvidence, evidenceForCollege } from '@/lib/useEvidence';
import EvidencePanel from '@/components/EvidencePanel';
import { RECOMMENDATION_DIALOG_HINT, PREPARE_EMAILS } from '@/lib/outreachLabels';
import HandoffSection, { handoffsFrom } from '@/components/HandoffSection';

/**
 * Whose name seeds the greeting in the editable draft. Every selected coach
 * gets their own email either way — the server re-personalises the greeting
 * per recipient — so this only decides what you read first.
 *
 * Uses the shared classifier rather than a local /head coach/i test, which
 * matched "Head Coach" and missed "Head Men's Soccer Coach": 35% of the head
 * coaches on file, every one of whom was being greeted by an assistant's name.
 */
function greetingSeed(coaches) {
  return pickBestContact(coaches) || coaches[0];
}

export default function EmailComposer({
  /**
   * WHETHER THIS SURFACE MAY ASK THRIV3 TO SEND — F7b.
   *
   * ---------------------------------------------------------------------------
   * DEFAULTS TRUE, AND THE DEFAULT IS THE POINT. This composer is shared by
   * three surfaces — the Top 100 match cards, the bulk composer and the
   * relationship dialog — and only the last of them is changing. A default of
   * false would have quietly removed a capability from two callers that never
   * asked, which is exactly the kind of change a shared component should not
   * make on anyone's behalf.
   *
   * Specific Search passes false explicitly. That workflow is deliberately
   * draft-only: Thriv3 opens the draft, a PERSON reviews and edits and presses
   * Send in Outlook, and then tells Thriv3 it went. The server refuses
   * `send: true` on that route regardless of what any screen offers, so this
   * prop is the courtesy and not the guarantee.
   * ---------------------------------------------------------------------------
   */
  allowImmediateSend = true,
  player, college, open, onOpenChange,
  /**
   * WHO ACTUALLY PERFORMS THE SEND. One injected function, not a mode.
   *
   * The default is the shared `/api/outreach/send` endpoint this composer has
   * always used. Manual, relationship-scoped outreach needs a different one —
   * its route reads the programme, the contact stance and the campaign from
   * the database instead of from a request body — and the difference is
   * entirely in which endpoint is called, not in how a message is composed.
   *
   * A `manualMode` boolean would have been the other way to do this, and it is
   * the way that ends with a component whose every paragraph is a conditional.
   * This composer still knows nothing about relationships.
   *
   * Receives what the operator decided: coaches, subject, body, greeting, the
   * send/draft choice and the evidence keys. It must resolve to the same
   * `{ results, reachable, from }` shape the endpoint returns.
   */
  onSend = null,
  /** Rendered above the recipients, for context the composer does not own. */
  context = null,
  /** One line under the title saying which kind of outreach this is. */
  subtitle = RECOMMENDATION_DIALOG_HINT,
}) {
  const validCoaches = useMemo(
    () => (college?.coaching_staff || []).filter((c) => c.email && c.email !== 'N/A'),
    [college]
  );
  // coaching_staff carries no provenance, so the address beside a coach's
  // name said nothing about whether it had ever been seen to work.
  const { statuses } = useCoachEmailStatus(player.sport || 'mens-soccer');

  const [selected, setSelected] = useState(() => new Set(validCoaches.map((c) => c.email)));
  const initialGreetingName = greetingSeed(validCoaches)?.name || 'Coach';

  // What the programme's own data supports saying. Fetched rather than
  // computed here: the strongest evidence spans five seasons of roster rows
  // the browser never loads. Absent until it arrives, and absent for good if
  // the request fails — buildEmailContext then renders exactly the email it
  // rendered before this existed.
  const collegeNames = useMemo(() => (college?.name ? [college.name] : []), [college?.name]);

  /**
   * The operator's own choice of angle and shape.
   *
   * Both are lists of KEYS — evidence kinds, and a structure key. Null until
   * they touch a control, which is what lets the panel show the engine's own
   * decision as the default rather than as a choice somebody made.
   *
   * They are sent BACK TO THE SERVER rather than applied here, and that is the
   * whole safety argument: the server regenerates the evidence, drops any kind
   * it did not produce, refuses a structure the surviving evidence does not
   * support, re-renders each sentence through the renderer its tier demands
   * and recomposes the body. The browser holds prose and keys, and has no
   * renderer to misuse.
   */
  const [selection, setSelection] = useState(null);
  const [structureChoice, setStructureChoice] = useState(null);
  useEffect(() => { setSelection(null); setStructureChoice(null); }, [college?.name]);

  const overrides = useMemo(() => {
    if (!college?.name) return null;
    if (!selection && !structureChoice) return null;
    return {
      prefer: selection ? { [college.name]: selection } : null,
      preferStructure: structureChoice ? { [college.name]: structureChoice } : null,
    };
  }, [college?.name, selection, structureChoice]);

  /**
   * WHICH CANONICAL COACHES THIS EMAIL IS CURRENTLY FOR - F9e.
   *
   * Wiring, and only wiring. Recipient selection, addresses, the greeting and
   * the submitted `coachIds` are all exactly as they were; this reads the same
   * selection a second time so the evidence request can ask what these people
   * have already been told.
   *
   * EMPTY ON THE TOP 100 PATH, AND CORRECTLY SO. A match card's
   * `coaching_staff` comes from the matching blob and carries no `coach_id`;
   * only the relationship dialog supplies canonical `coaches` rows. So the
   * ranked and bulk composers send no coach ids, receive no history, and
   * behave precisely as before.
   */
  const selectedCoachIds = useMemo(
    () => validCoaches.filter((c) => selected.has(c.email) && c.coach_id).map((c) => c.coach_id),
    [validCoaches, selected],
  );

  const { evidence: evidenceMap, loading: evidenceLoading, failed: evidenceFailed } =
    useEvidence(player.id, collegeNames, overrides, selectedCoachIds);
  const evidence = evidenceForCollege(evidenceMap, college?.name);

  /**
   * Whether this athlete's email is assembled from the structure at all.
   *
   * Only when their saved template is the shipped default. A customised
   * template is their own voice and is rendered as it always was — see
   * canComposeStructured — which means an operator who has edited their
   * template gets no structural variety until they reset it, and needs to be
   * told that rather than left to notice.
   */
  const structuredAvailable = canComposeStructured(player);

  // Fall back to the defaults rather than opening an empty compose window for
  // an athlete who has no saved template.
  const [subject, setSubject] = useState(() => fillTemplate(
    player.email_subject || DEFAULT_EMAIL_SUBJECT,
    buildEmailContext(player, college, initialGreetingName)
  ));
  const [body, setBody] = useState(() => emailBodyFor(
    player, college, initialGreetingName
  ).body);
  // Which route produced the body now on screen. Logged with the send so a
  // later analysis can separate an assembled email from a templated one.
  const [bodySource, setBodySource] = useState(null);

  /**
   * Re-fills the draft once evidence arrives — but only if nobody has typed.
   *
   * The dialog opens before the request returns, so the first body is rendered
   * without evidence and has to be replaced. Overwriting unconditionally would
   * silently discard an operator's edits a second after they made them, which
   * is the worse failure of the two: a lost evidence sentence is visible in the
   * panel below, and lost typing is not.
   *
   * "Has anyone typed" is an EXPLICIT flag rather than a comparison against
   * the last auto-generated text, and that is a bug fix rather than a
   * preference. The comparison version kept a ref of what it had last written
   * and updated it immediately, while `setBody`'s updater had not yet run —
   * and React re-invokes both the effect and the updater in development, so
   * the second pass saw a ref that already held the new text and a `current`
   * that still held the old, concluded the operator must have typed, and kept
   * the old. The visible symptom was every draft coming out as the plain
   * template while the panel above it described a structure.
   */
  const [bodyEdited, setBodyEdited] = useState(false);
  const [subjectEdited, setSubjectEdited] = useState(false);
  useEffect(() => { setBodyEdited(false); setSubjectEdited(false); }, [college?.name]);

  useEffect(() => {
    if (!evidence) return;
    // The whole body, not just the evidence paragraph: with a structure the
    // evidence is placed THROUGH the email, so there is no one paragraph to
    // swap and re-rendering from the structure is the only correct answer.
    const composed = emailBodyFor(player, college, initialGreetingName, { evidence });
    setBodySource(composed.source);
    if (!bodyEdited) setBody(composed.body);
    if (!subjectEdited) {
      setSubject(fillTemplate(player.email_subject || DEFAULT_EMAIL_SUBJECT, composed.context));
    }
  }, [evidence, player, college, initialGreetingName, bodyEdited, subjectEdited]);
  const [results, setResults] = useState({}); // email -> { status, error, url, handoff }
  const [sending, setSending] = useState(false);
  const [sendImmediately, setSendImmediately] = useState(false);
  /**
   * The state above is per-surface and starts false everywhere, but a surface
   * that may not send must not be able to reach true by any route — a stale
   * value after a prop change, or a future control somebody adds. Derived once
   * here so every read below goes through the capability.
   */
  /**
   * THE COACHES WHOSE EMAIL WAS ACTUALLY PREPARED, IN THE ORDER THEY WERE.
   *
   * ---------------------------------------------------------------------------
   * DERIVED FROM `results`, SO IT CANNOT INCLUDE A COACH THE SERVER REFUSED.
   * `handoff` is set by the route on exactly one branch — a coach whose draft
   * composed AND persisted — and is absent on every other outcome:
   * suppressed, rate-capped, revoked, budget-refused, campaign-refused, or an
   * error. Filtering on its presence rather than on a list of statuses means
   * this cannot fall behind a guard that is added later: a new refusal
   * returns no handoff and no row appears, without this line being touched.
   * ---------------------------------------------------------------------------
   */
  const handoffs = useMemo(() => handoffsFrom(results), [results]);

  const immediate = allowImmediateSend && sendImmediately;
  const [error, setError] = useState(null);
  const [reachable, setReachable] = useState(true);
  const [from, setFrom] = useState(null);

  // Subject and body are already filled here, so anything still in {{braces}}
  // is a token nothing resolved — and it would be sent exactly like that.
  const unresolved = useMemo(() => {
    const context = buildEmailContext(player, college, initialGreetingName, { evidence });
    return [...new Set([...unresolvedTokens(subject, context), ...unresolvedTokens(body, context)])];
  }, [player, college, initialGreetingName, subject, body, evidence]);

  function toggle(email) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(email) ? next.delete(email) : next.add(email);
      return next;
    });
  }

  async function handleSend() {
    const selectedCoaches = validCoaches.filter((c) => selected.has(c.email));
    if (selectedCoaches.length === 0) return;

    setSending(true);
    setError(null);
    try {
      const composed = {
        coaches: selectedCoaches.map((c) => ({ name: c.name, email: c.email, title: c.title })),
        subject,
        body,
        greetingName: initialGreetingName,
        send: immediate,
        // Kinds and a structure key — never sentences, never facts. The server
        // validates each against the evidence it generated for this pairing,
        // refuses a structure that evidence does not support, and re-renders
        // from its own objects, so what is logged is what the engine actually
        // supports rather than what this tab was holding.
        evidenceSelection: selection,
        evidenceStructure: structureChoice,
        bodySource,
      };
      const response = onSend
        ? await onSend(composed)
        : await outreach.send({
          ...composed,
          athleteId: player.id,
          collegeName: college.name,
          division: college.division,
          // Ties this outreach back to the Tab 2 recommendation that produced
          // it, so Phase 5 can ask whether the matching actually works.
          matchId: college.name,
        });
      setResults(Object.fromEntries(response.results.map((r) => [r.email, r])));
      setReachable(response.reachable);
      setFrom(response.from);
    } catch (err) {
      setError(err.message);
    }
    setSending(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Email Coaches — {college?.name}</DialogTitle>
          {/*
            THE TWO COMPOSERS LOOK ALIKE ONCE OPEN, which is the point at which
            a wrong choice costs something. One muted line naming the context
            is cheaper than any amount of explanation on the card behind it.
            `subtitle` lets the relationship wrapper name its own.
          */}
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </DialogHeader>

        <div className="space-y-4">
          {context}

          <div>
            <Label>Recipients</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              One email per coach, each carrying that coach's own tracking link — a shared
              link would credit everyone's viewing to a single recipient.
            </p>
            <div className="mt-1.5 space-y-1.5">
              {validCoaches.map((c) => (
                <label key={c.email} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={selected.has(c.email)} onCheckedChange={() => toggle(c.email)} />
                  <span>{c.name} <span className="text-muted-foreground">({c.email})</span></span>
                  <EmailRiskBadge status={statusOf(statuses, c.email)} loaded={statuses !== null} />
                  {(results[c.email]?.status === 'sent' || results[c.email]?.status === 'drafted') && (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      {/*
                        NEUTRAL SINCE R2B. It said "draft open in Outlook",
                        which was true when AppleScript was the only transport
                        and is a guess about somebody else's machine now. What
                        Thriv3 knows is that it prepared the email and wrote
                        the row; the handoff section below says the rest.
                      */}
                      {results[c.email].status === 'sent' ? 'sent' : 'prepared'}
                    </span>
                  )}
                  {results[c.email]?.status === 'error' && (
                    <span className="inline-flex items-center gap-1 text-xs text-destructive" title={results[c.email].error}>
                      <XCircle className="h-4 w-4" /> failed
                    </span>
                  )}
                  {/*
                    A COACH WHO WAS SKIPPED, AND WHY.
                    Without this a refusal is a row with no tick and no cross:
                    the operator presses the button, one recipient silently
                    does not happen, and nothing on screen says so. Keyed on
                    the server's own `message` rather than on a list of
                    statuses, so the branch cannot fall behind the guards —
                    a refusal that carries an explanation shows it, and the
                    ones that do not are unchanged.
                  */}
                  {results[c.email]?.message && (
                    <span
                      className="inline-flex items-center gap-1 text-xs text-amber-400"
                      title={results[c.email].message}
                      role="status"
                    >
                      <XCircle className="h-4 w-4" /> not sent
                    </span>
                  )}
                </label>
              ))}
              {validCoaches.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No coaches with a verified email on file for this program.</p>
              )}
            </div>
          </div>

          <EvidencePanel
            evidence={evidence}
            loading={evidenceLoading}
            failed={evidenceFailed}
            body={body}
            selection={selection}
            onSelectionChange={setSelection}
            onStructureChange={structuredAvailable ? setStructureChoice : null}
          />

          {/* Said rather than left to be inferred. An operator whose template
              is customised would otherwise see a shape named in the panel and
              an email that ignores it, with nothing on screen explaining why. */}
          {!structuredAvailable && (
            <p className="rounded-md border border-dashed p-2.5 text-xs text-muted-foreground">
              This athlete has a customised email template, so the email is rendered from it
              and the structure above is advisory only. Evidence still goes in wherever the
              template puts <span className="font-mono">{'{{evidence_paragraph}}'}</span>. Reset
              the template to the default under{' '}
              <span className="text-foreground">Edit Profile → Placement preferences</span> to
              use the structures.
            </p>
          )}

          <div className="space-y-1.5">
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(e) => { setSubjectEdited(true); setSubject(e.target.value); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <Textarea
              rows={12}
              value={body}
              onChange={(e) => { setBodyEdited(true); setBody(e.target.value); }}
              className="text-sm"
            />
          </div>
        </div>

        {unresolved.length > 0 && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
            Nothing resolves {unresolved.map((t) => `{{${t}}}`).join(', ')} — {unresolved.length === 1 ? 'it' : 'they'} will
            reach the coach exactly like that.
          </p>
        )}

        {from?.mismatch && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
            Outlook composed these from <strong>{from.actual}</strong>, not {from.requested}. Add
            that account in Outlook and make it the default, or switch New Outlook off so the
            From address can be set per message.
          </p>
        )}

        {!reachable && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
            Tracking links point at localhost, which no coach can open. Set
            THRIV3_PUBLIC_BASE_URL before real outreach.
          </p>
        )}

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs">{error}</p>
        )}

        {/*
          WHAT TO DO NOW THE EMAILS ARE PREPARED — R2B.
          
          Present only on the hosted path: `handoff` is null when the server
          drove Outlook itself, because handing a macOS operator a clipboard
          as well would put two competing copies of one email on one screen.
          Rendered here, directly above the footer, so it appears where the
          operator's attention already is after pressing the button.
        */}
        <HandoffSection handoffs={handoffs} />

        {/*
          ABSENT RATHER THAN DISABLED where the surface may not send. A greyed
          checkbox reads as "this is how you would turn it on", and on Specific
          Search there is no turning it on — the server refuses it.
        */}
        {allowImmediateSend && (
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox
              className="mt-0.5 shrink-0"
              checked={sendImmediately}
              onCheckedChange={(v) => setSendImmediately(v === true)}
            />
            <span className="text-xs leading-relaxed">
              <span className="text-sm font-medium">Send immediately</span>
              <span className="text-muted-foreground">
                {' '}— leave this off and each message opens in Outlook for you to read and send yourself.
              </span>
            </span>
          </label>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={handleSend} disabled={sending || selected.size === 0}>
            <Send className="h-3.5 w-3.5 mr-1.5" />
            {sending
              ? 'Working…'
              : immediate
                ? `Send ${selected.size} email${selected.size === 1 ? '' : 's'}`
                /*
                  "Prepare" rather than "Open ... in Outlook", because on the
                  hosted path nothing opens until the operator clicks a row
                  below, and on no path does Thriv3 know which application
                  will. Preparing is the thing this button actually does: it
                  composes, validates and records the DRAFT.
                */
                : PREPARE_EMAILS(selected.size)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
