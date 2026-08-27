import React, { useMemo, useState } from 'react';
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
  fillTemplate, buildEmailContext, unresolvedTokens, DEFAULT_EMAIL_SUBJECT, DEFAULT_EMAIL_TEMPLATE,
} from '@/lib/emailTemplate';
import { outreach } from '@/api/client';

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

  // Fall back to the defaults rather than opening an empty compose window for
  // an athlete who has no saved template.
  const [subject, setSubject] = useState(() => fillTemplate(
    player.email_subject || DEFAULT_EMAIL_SUBJECT,
    buildEmailContext(player, college, initialGreetingName)
  ));
  const [body, setBody] = useState(() => fillTemplate(
    player.email_template || DEFAULT_EMAIL_TEMPLATE,
    buildEmailContext(player, college, initialGreetingName)
  ));
  const [results, setResults] = useState({}); // email -> { status, error, url }
  const [sending, setSending] = useState(false);
  const [sendImmediately, setSendImmediately] = useState(false);
  const [error, setError] = useState(null);
  const [reachable, setReachable] = useState(true);
  const [from, setFrom] = useState(null);

  // Subject and body are already filled here, so anything still in {{braces}}
  // is a token nothing resolved — and it would be sent exactly like that.
  const unresolved = useMemo(() => {
    const context = buildEmailContext(player, college, initialGreetingName);
    return [...new Set([...unresolvedTokens(subject, context), ...unresolvedTokens(body, context)])];
  }, [player, college, initialGreetingName, subject, body]);

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

          <div className="space-y-1.5">
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <Textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} className="text-sm" />
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
