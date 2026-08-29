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

export default function EmailComposer({ player, college, open, onOpenChange }) {
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

  const { evidence: evidenceMap, loading: evidenceLoading, failed: evidenceFailed } =
    useEvidence(player.id, collegeNames, overrides);
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
  const [results, setResults] = useState({}); // email -> { status, error, url }
  const [sending, setSending] = useState(false);
  const [sendImmediately, setSendImmediately] = useState(false);
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
      const response = await outreach.send({
        athleteId: player.id,
        coaches: selectedCoaches.map((c) => ({ name: c.name, email: c.email, title: c.title })),
        subject,
        body,
        greetingName: initialGreetingName,
        collegeName: college.name,
        division: college.division,
        // Ties this outreach back to the Tab 2 recommendation that produced
        // it, so Phase 5 can ask whether the matching actually works.
        matchId: college.name,
        send: sendImmediately,
        // Kinds and a structure key — never sentences, never facts. The server
        // validates each against the evidence it generated for this pairing,
        // refuses a structure that evidence does not support, and re-renders
        // from its own objects, so what is logged is what the engine actually
        // supports rather than what this tab was holding.
        evidenceSelection: selection,
        evidenceStructure: structureChoice,
        bodySource,
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
        </DialogHeader>

        <div className="space-y-4">
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
                      {results[c.email].status === 'sent' ? 'sent' : 'draft open in Outlook'}
                    </span>
                  )}
                  {results[c.email]?.status === 'error' && (
                    <span className="inline-flex items-center gap-1 text-xs text-destructive" title={results[c.email].error}>
                      <XCircle className="h-4 w-4" /> failed
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={handleSend} disabled={sending || selected.size === 0}>
            <Send className="h-3.5 w-3.5 mr-1.5" />
            {sending
              ? 'Working…'
              : sendImmediately
                ? `Send ${selected.size} email${selected.size === 1 ? '' : 's'}`
                : `Open ${selected.size} draft${selected.size === 1 ? '' : 's'} in Outlook`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
