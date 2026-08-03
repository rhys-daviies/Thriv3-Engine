import React, { useMemo, useState } from 'react';
import { CheckCircle2, XCircle, Send } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { fillTemplate, buildEmailContext } from '@/lib/emailTemplate';
import { integrations } from '@/api/client';

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// "Head Coach" / "Wicks-Street Head Men's Soccer Coach (Head Coach)" match;
// "Associate Head Coach" / "Assistant Head Coach" do not — those are CC'd,
// not the primary recipient.
function isPrimaryHeadCoach(title) {
  return /head coach/i.test(title || '') && !/assistant|associate/i.test(title || '');
}

/** Picks the primary head coach from a list, falling back to the first entry. */
function pickHeadCoach(coaches) {
  return coaches.find((c) => isPrimaryHeadCoach(c.title)) || coaches[0];
}

export default function EmailComposer({ player, college, open, onOpenChange }) {
  const validCoaches = useMemo(
    () => (college?.coaching_staff || []).filter((c) => c.email && c.email !== 'N/A'),
    [college]
  );
  const [selected, setSelected] = useState(() => new Set(validCoaches.map((c) => c.email)));
  const initialGreetingName = (pickHeadCoach(validCoaches)?.name) || 'Coach';

  const [subject, setSubject] = useState(() => fillTemplate(player.email_subject, buildEmailContext(player, college, initialGreetingName)));
  const [body, setBody] = useState(() => fillTemplate(player.email_template, buildEmailContext(player, college, initialGreetingName)));
  const [results, setResults] = useState({}); // email -> 'sent' | 'error'
  const [sending, setSending] = useState(false);

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
    const headCoach = pickHeadCoach(selectedCoaches);
    const ccCoaches = selectedCoaches.filter((c) => c.email !== headCoach.email);

    const greetingRegex = new RegExp(`Dear\\s+${escapeRegExp(initialGreetingName)},`, 'i');
    const personalizedBody = body.replace(greetingRegex, `Dear ${headCoach.name},`);

    try {
      const result = await integrations.Core.SendEmail({
        to: headCoach.email,
        cc: ccCoaches.map((c) => c.email),
        subject,
        body: personalizedBody,
      });
      if (result?.mailto) window.location.href = result.mailto;
      setResults(Object.fromEntries(selectedCoaches.map((c) => [c.email, 'sent'])));
    } catch {
      setResults(Object.fromEntries(selectedCoaches.map((c) => [c.email, 'error'])));
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
            <p className="text-xs text-muted-foreground mt-0.5">Sent as one email — head coach in To, everyone else CC'd.</p>
            <div className="mt-1.5 space-y-1.5">
              {validCoaches.map((c) => (
                <label key={c.email} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={selected.has(c.email)} onCheckedChange={() => toggle(c.email)} />
                  <span>{c.name} <span className="text-muted-foreground">({c.email})</span></span>
                  {results[c.email] === 'sent' && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                  {results[c.email] === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={handleSend} disabled={sending || selected.size === 0}>
            <Send className="h-3.5 w-3.5 mr-1.5" /> {sending ? 'Sending…' : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
