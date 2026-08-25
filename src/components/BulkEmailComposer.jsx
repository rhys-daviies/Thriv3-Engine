import React, { useMemo, useState } from 'react';
import { CheckCircle2, XCircle, Mail, AlertTriangle, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { pickHeadCoach } from '@shared/coachRoles.js';
import {
  fillTemplate, buildEmailContext, DEFAULT_EMAIL_SUBJECT, DEFAULT_EMAIL_TEMPLATE,
} from '@/lib/emailTemplate';
import { outreach } from '@/api/client';

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
export default function BulkEmailComposer({ player, colleges, open, onOpenChange }) {
  // Worked out with the shared classifier rather than a local regex on the
  // title: /head coach/i misses "Head Men's Soccer Coach", which is 35% of
  // the head coaches on file.
  const { targets, missing } = useMemo(() => {
    const found = [];
    const none = [];
    for (const college of colleges || []) {
      const coach = pickHeadCoach(college.coaching_staff);
      if (coach) found.push({ college, coach });
      else none.push(college);
    }
    return { targets: found, missing: none };
  }, [colleges]);

  const [selected, setSelected] = useState(() => new Set(targets.map((t) => t.college.name)));
  // Left unfilled on purpose — these are templates, and each programme
  // resolves them differently at draft time.
  const [subject, setSubject] = useState(player.email_subject || DEFAULT_EMAIL_SUBJECT);
  const [body, setBody] = useState(player.email_template || DEFAULT_EMAIL_TEMPLATE);
  const [previewName, setPreviewName] = useState(targets[0]?.college.name || '');
  const [results, setResults] = useState({});   // college name -> { status, error }
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reachable, setReachable] = useState(true);
  const [from, setFrom] = useState(null);

  const previewTarget = targets.find((t) => t.college.name === previewName) || targets[0] || null;
  const preview = useMemo(() => {
    if (!previewTarget) return null;
    const context = buildEmailContext(player, previewTarget.college, previewTarget.coach.name || 'Coach');
    return { subject: fillTemplate(subject, context), body: fillTemplate(body, context) };
  }, [previewTarget, player, subject, body]);

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
      const context = buildEmailContext(player, college, coach.name || 'Coach');
      try {
        const response = await outreach.send({
          athleteId: player.id,
          coaches: [{ name: coach.name, email: coach.email, title: coach.title }],
          subject: fillTemplate(subject, context),
          body: fillTemplate(body, context),
          greetingName: coach.name || 'Coach',
          collegeName: college.name,
          division: college.division,
          matchId: college.name,
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
              The head coach at each programme on this page. One email each, carrying that
              coach's own tracking link.
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
                      {coach.role === 'associate-head' && (
                        <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] text-amber-500">
                          associate head — no head coach on file
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{coach.email}</span>
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
            <p className="text-xs text-muted-foreground">
              Tokens stay unresolved here — {'{{college_name}}'} and the graduating-senior counts
              fill differently for every programme. Read the preview below to see one rendered.
            </p>
            <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} className="text-sm" disabled={busy} />
          </div>

          {preview && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>Preview</Label>
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
