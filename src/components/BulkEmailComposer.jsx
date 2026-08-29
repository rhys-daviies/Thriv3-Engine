import React, { useMemo, useState } from 'react';
import { CheckCircle2, XCircle, Mail, AlertTriangle, ShieldCheck, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { pickBestContact } from '@shared/coachRoles.js';
import { riskCounts, emailRisk } from '@shared/emailRisk.js';
import EmailRiskBadge from '@/components/EmailRiskBadge';
import { useCoachEmailStatus, statusOf } from '@/lib/useCoachEmailStatus';
import { useProfileUrl } from '@/lib/useProfileUrl';
import {
  fillTemplate, buildEmailContext, unresolvedTokens, emailBodyFor, canComposeStructured,
  DEFAULT_EMAIL_SUBJECT, DEFAULT_EMAIL_TEMPLATE,
} from '@/lib/emailTemplate';
import { outreach } from '@/api/client';
import { useEvidence, evidenceForCollege } from '@/lib/useEvidence';
import EvidencePanel from '@/components/EvidencePanel';

/**
 * One draft per programme on the page, addressed to its head coach.
 *
 * The per-school composer fills the template before you see it, because it
 * has exactly one school to fill it with. This one cannot: {{college_name}},
 * {{college_nickname}} and the graduating-senior counts resolve differently
 * for all twenty. So the editable thing here is the *template*, and the
 * preview below it shows one chosen programme rendered — pick another from
 * the dropdown to read what that coach will get.
 *
 * Drafts only, never send. Twenty messages leaving an inbox in one burst is
 * the thing most likely to get the address filtered, and reading them in
 * Outlook before pressing send is the whole point of drafting.
 */
/**
 * Said plainly on the row, because "who am I actually writing to" is the one
 * thing the operator cannot get from a name and an address alone.
 */
const ROLE_NOTE = {
  'associate-head': 'associate head — no head coach listed',
  assistant: 'assistant — no head coach listed',
  goalkeeper: 'goalkeeper coach — no other staff listed',
  'team-email': 'shared team inbox — no named coach listed',
};

export default function BulkEmailComposer({ player, colleges, open, onOpenChange }) {
  // Worked out with the shared classifier rather than a local regex on the
  // title: /head coach/i misses "Head Men's Soccer Coach", which is 35% of
  // the head coaches on file.
  const { targets, missing } = useMemo(() => {
    const found = [];
    const none = [];
    for (const college of colleges || []) {
      const coach = pickBestContact(college.coaching_staff);
      if (coach) found.push({ college, coach });
      else none.push(college);
    }
    return { targets: found, missing: none };
  }, [colleges]);

  // Fetched rather than read off the recommendation: coaching_staff is the
  // pre-promotion source and carries no provenance, so without this the
  // dialog can show a coach without being able to say the address has never
  // been seen to work.
  const { statuses, failed: statusFailed } = useCoachEmailStatus(player.sport || 'mens-soccer');
  // Preview only. The link that actually ships is built per coach on the
  // server; this is the same address with a stand-in where the token goes,
  // so the preview does not read as though the link failed to resolve.
  const previewProfileUrl = useProfileUrl(player.id);
  const statusLoaded = statuses !== null;

  const [selected, setSelected] = useState(() => new Set(targets.map((t) => t.college.name)));
  // Left unfilled on purpose — these are templates, and each programme
  // resolves them differently at draft time.
  const [subject, setSubject] = useState(player.email_subject || DEFAULT_EMAIL_SUBJECT);
  const [body, setBody] = useState(player.email_template || DEFAULT_EMAIL_TEMPLATE);
  const [previewName, setPreviewName] = useState(targets[0]?.college.name || '');

  // One batched request for the whole page rather than one per programme.
  // Absent until it lands and absent for good if it fails, in which case every
  // draft is the plain template — the same email this composer sent before the
  // evidence engine existed, rather than a wrong one.
  const collegeNames = useMemo(() => targets.map((t) => t.college.name), [targets]);
  const { evidence: evidenceMap, loading: evidenceLoading, failed: evidenceFailed } =
    useEvidence(player.id, collegeNames);
  const [results, setResults] = useState({});   // college name -> { status, error }
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reachable, setReachable] = useState(true);
  const [from, setFrom] = useState(null);

  const previewTarget = targets.find((t) => t.college.name === previewName) || targets[0] || null;

  /**
   * Whether each programme gets its own assembled body, or all of them share
   * the one in the textarea.
   *
   * The textarea holds ONE template for the whole page, which was right when
   * every email had the same shape and is not once structures exist: two
   * programmes on the same page can now honestly want different argument
   * orders. So while the template is untouched, each draft is composed from
   * its own structure; the moment the operator edits it, their version wins
   * for every programme — an edit is an instruction, and quietly ignoring it
   * on nineteen of twenty programmes would be the worse surprise.
   */
  const pristineTemplate = player.email_template || DEFAULT_EMAIL_TEMPLATE;
  const perProgramme = canComposeStructured(player) && body === pristineTemplate;

  /**
   * The body for one programme, by whichever route is active.
   *
   * One function, used by both the preview and the send loop, so what is shown
   * and what is drafted cannot diverge — which is exactly how an operator ends
   * up approving one email and sending another.
   */
  const bodyFor = (college, coachName, profileUrl = null) => {
    const evidence = evidenceForCollege(evidenceMap, college.name);
    if (perProgramme) {
      return emailBodyFor(player, college, coachName, { evidence, profileUrl });
    }
    const context = buildEmailContext(player, college, coachName, { profileUrl, evidence });
    return { body: fillTemplate(body, context), context, source: 'TEMPLATE', structure: null };
  };

  // A token nothing resolves is left exactly as written, so a typo reaches
  // the coach intact. Checked against a real context rather than by looking
  // for braces, because a template legitimately still holds its tokens here.
  const unresolved = useMemo(() => {
    if (!previewTarget) return [];
    const context = buildEmailContext(player, previewTarget.college, 'Coach', {
      evidence: evidenceForCollege(evidenceMap, previewTarget.college.name),
    });
    return [...new Set([
      ...unresolvedTokens(subject, context),
      ...unresolvedTokens(body, context),
    ])];
  }, [previewTarget, player, subject, body, evidenceMap]);
  const previewEvidence = evidenceForCollege(evidenceMap, previewTarget?.college.name);
  const preview = useMemo(() => {
    if (!previewTarget) return null;
    const composed = bodyFor(
      previewTarget.college, previewTarget.coach.name || 'Coach', previewProfileUrl,
    );
    return {
      subject: fillTemplate(subject, composed.context),
      body: composed.body,
      structure: composed.structure,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewTarget, player, subject, body, previewProfileUrl, previewEvidence, perProgramme]);

  function toggle(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  const allSelected = targets.length > 0 && selected.size === targets.length;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(targets.map((t) => t.college.name)));
  }

  // Counted over what is actually selected, not over the whole page, so
  // unticking the inferred ones visibly clears the warning.
  const selectedTargets = targets.filter((t) => selected.has(t.college.name));
  const risk = statusLoaded
    ? riskCounts(selectedTargets.map((t) => statusOf(statuses, t.coach.email)))
    : null;

  /** Unticks every address that has never been observed to work. */
  function clearInferred() {
    setSelected(new Set(
      targets
        .filter((t) => emailRisk(statusOf(statuses, t.coach.email))?.status !== 'inferred')
        .filter((t) => selected.has(t.college.name))
        .map((t) => t.college.name)
    ));
  }

  /**
   * One request per programme, in sequence.
   *
   * Sequential because each one drives Outlook through AppleScript and twenty
   * at once is twenty compose windows racing each other. The per-row status
   * fills in as it goes, so a run that stalls is visibly stalled.
   */
  async function handleDraft() {
    const queue = targets.filter((t) => selected.has(t.college.name));
    if (!queue.length) return;

    setBusy(true);
    setError(null);
    setResults({});
    setProgress({ done: 0, total: queue.length });

    for (const { college, coach } of queue) {
      // Each programme's own evidence AND its own structure. A programme the
      // lookup could not read drafts the plain template rather than borrowing
      // another school's evidence or another school's shape.
      const composed = bodyFor(college, coach.name || 'Coach');
      try {
        const response = await outreach.send({
          athleteId: player.id,
          coaches: [{ name: coach.name, email: coach.email, title: coach.title }],
          subject: fillTemplate(subject, composed.context),
          body: composed.body,
          greetingName: coach.name || 'Coach',
          collegeName: college.name,
          division: college.division,
          matchId: college.name,
          bodySource: composed.source,
          send: false,   // never from here; you press send in Outlook
        });
        setResults((prev) => ({ ...prev, [college.name]: response.results[0] }));
        setReachable(response.reachable);
        if (response.from?.mismatch) setFrom(response.from);
      } catch (err) {
        // sendOutreach throws only for whole-run conditions — no Outlook, a
        // missing compliance footer, a profile that cannot be generated. Every
        // remaining programme would fail the same way, so stop rather than
        // print the same error twenty times.
        setResults((prev) => ({ ...prev, [college.name]: { status: 'error', error: err.message } }));
        setError(err.message);
        break;
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    setBusy(false);
  }

  const drafted = Object.values(results).filter((r) => r?.status === 'drafted').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Message all head coaches — {player.full_name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <Label>Recipients</Label>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={toggleAll} disabled={busy}>
                {allSelected ? 'Clear all' : 'Select all'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              The head coach at each programme on this page — or, where none is listed, the
              most senior contact there is. One email each, carrying that coach's own
              tracking link. Anyone who is not the head coach is labelled.
            </p>

            <div className="mt-2 max-h-60 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {targets.map(({ college, coach }) => {
                const result = results[college.name];
                return (
                  <label key={college.name} className="flex items-center gap-2.5 px-2.5 py-1.5 text-sm">
                    <Checkbox
                      checked={selected.has(college.name)}
                      onCheckedChange={() => toggle(college.name)}
                      disabled={busy}
                    />
                    <span className="w-8 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {college.match_score}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{college.name}</span>
                      <span className="text-muted-foreground"> — {coach.name || 'Coach'}</span>
                      {coach.role !== 'head' && (
                        <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] text-amber-500">
                          {ROLE_NOTE[coach.role] || coach.role}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{coach.email}</span>
                    <EmailRiskBadge status={statusOf(statuses, coach.email)} loaded={statusLoaded} />
                    {result?.status === 'drafted' && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />}
                    {result?.status === 'suppressed' && (
                      <span className="shrink-0 text-xs text-muted-foreground" title="This coach opted out">opted out</span>
                    )}
                    {result?.status === 'error' && (
                      <XCircle className="h-4 w-4 shrink-0 text-destructive" title={result.error} />
                    )}
                  </label>
                );
              })}
              {targets.length === 0 && (
                <p className="px-2.5 py-3 text-xs italic text-muted-foreground">
                  No head coach on file for any programme on this page.
                </p>
              )}
            </div>

            {statusFailed && (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span>Could not check where these addresses came from. Nothing here says they work.</span>
              </p>
            )}

            {!statusLoaded && !statusFailed && (
              <p className="mt-1.5 text-xs text-muted-foreground">Checking where these addresses came from…</p>
            )}

            {risk && risk.risky === 0 && selectedTargets.length > 0 && (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span>All {selectedTargets.length} addresses were read off a programme's own staff page.</span>
              </p>
            )}

            {risk && risk.risky > 0 && (
              <p className="mt-1.5 flex flex-wrap items-start gap-1.5 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                <span className="text-muted-foreground">
                  {risk.risky} of {selectedTargets.length} selected {risk.risky === 1 ? 'address carries' : 'addresses carry'} a warning:{' '}
                  {[
                    risk.inferred && `${risk.inferred} inferred`,
                    risk.generic && `${risk.generic} shared ${risk.generic === 1 ? 'inbox' : 'inboxes'}`,
                    risk.unknown && `${risk.unknown} with no recorded provenance`,
                  ].filter(Boolean).join(', ')}.
                  {risk.inferred > 0 && ` Inferred addresses were guessed from the institution's address pattern and have never been observed to work — expect ${risk.inferred === 1 ? 'it' : 'them'} to bounce, and a bounce on cold outreach costs sender reputation rather than just the email.`}
                </span>
                {risk.inferred > 0 && (
                  <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[11px]" onClick={clearInferred} disabled={busy}>
                    Untick the {risk.inferred} inferred
                  </Button>
                )}
              </p>
            )}

            {missing.length > 0 && (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span>
                  {missing.length} programme{missing.length === 1 ? '' : 's'} on this page {missing.length === 1 ? 'has' : 'have'} no
                  head coach on file and {missing.length === 1 ? 'is' : 'are'} not listed:{' '}
                  {missing.map((c) => c.name).join(', ')}. Use Email Coaches on the card to write to their assistants.
                </span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Subject template</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label>Body template</Label>
            {/* Two modes, and which one is active depends on whether this box
                has been touched. Said plainly rather than left to be worked
                out from the previews, because the consequence of an edit here
                is that nineteen other programmes stop being individually
                shaped — which is a reasonable thing to want and a bad thing
                to discover afterwards. */}
            <p className="text-xs text-muted-foreground">
              {perProgramme
                ? <>Each programme is built from its own structure and its own evidence, so the
                    drafts genuinely differ — switch programmes in the preview to see. Editing
                    this box replaces that with one shared template for every programme.</>
                : <>One shared template for every programme. Tokens stay unresolved here —{' '}
                    {'{{college_name}}'} and the graduating-senior counts fill differently for
                    each. Read the preview below to see one rendered.</>}
            </p>
            <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} className="text-sm" disabled={busy} />
            {!perProgramme && canComposeStructured(player) && body !== pristineTemplate && (
              <button
                type="button"
                onClick={() => setBody(pristineTemplate)}
                className="text-[11px] text-muted-foreground underline underline-offset-2"
                disabled={busy}
              >
                Discard these edits and go back to per-programme structures
              </button>
            )}
          </div>

          {unresolved.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span>
                Nothing resolves {unresolved.map((t) => `{{${t}}}`).join(', ')} — {unresolved.length === 1 ? 'it' : 'they'} will
                reach the coach exactly like that. Fix or delete {unresolved.length === 1 ? 'it' : 'them'} above.
              </span>
            </p>
          )}

          {preview && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>
                  Preview
                  {preview.structure && (
                    <span className="ml-1.5 font-normal text-[11px] text-muted-foreground">
                      · {preview.structure}
                    </span>
                  )}
                </Label>
                <select
                  className="h-8 max-w-[60%] truncate rounded-md border border-border bg-background px-2 text-xs"
                  value={previewTarget.college.name}
                  onChange={(e) => setPreviewName(e.target.value)}
                >
                  {targets.map(({ college }) => (
                    <option key={college.name} value={college.name}>{college.name}</option>
                  ))}
                </select>
              </div>
              <EvidencePanel
                evidence={previewEvidence}
                loading={evidenceLoading}
                failed={evidenceFailed}
                body={preview.body}
              />
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <p className="text-xs font-medium">{preview.subject}</p>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-muted-foreground">{preview.body}</pre>
                <p className="mt-2 text-[11px] italic text-muted-foreground">
                  The tracking link and the compliance footer are added per coach when the draft is created.
                </p>
              </div>
            </div>
          )}
        </div>

        {busy && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Drafting {progress.done + 1} of {progress.total}… leave Outlook alone until this finishes.
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </div>
        )}

        {!busy && drafted > 0 && (
          <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs">
            {drafted} draft{drafted === 1 ? '' : 's'} waiting in Outlook. Nothing has been sent — read them and press send yourself.
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
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
            Stopped after {progress.done} of {progress.total}: {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
          <Button onClick={handleDraft} disabled={busy || selected.size === 0}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Mail className="mr-1.5 h-3.5 w-3.5" />}
            {busy ? 'Drafting…' : `Open ${selected.size} draft${selected.size === 1 ? '' : 's'} in Outlook`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
