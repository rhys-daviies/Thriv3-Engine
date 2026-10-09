import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { engagement } from '@/api/client';

/**
 * RECORD AN OPT-OUT — Phase 5, PR A (#2).
 *
 * Manual emails tell a coach "just reply and we'll take you off our list".
 * When that reply arrives, this is where it is honoured: the recipient's
 * address goes on THIS DATABASE's opt-out list (the same `suppress()` the CLI
 * uses), and no outreach prepared from this database will address it again.
 *
 * LOCAL, AND SAID SO. The opt-out is not pushed to the engagement edge service
 * or to any other environment (docs/hosting.md, "Opt-outs are local to the
 * database"), so the copy below never claims more than that.
 *
 * Two steps, not one click, because it cannot be undone from the screen. The
 * operator can note what they saw ("replied 9 Oct asking to be removed"), which
 * is kept with the record. Once recorded, the panel says so and when.
 */
const REASONS = [
  { value: 'unsubscribed', label: 'Asked not to be contacted' },
  { value: 'manual', label: 'Other operator decision' },
];

export default function OptOutControl({ outreachId, recipientLabel = 'this recipient', onRecorded = () => {} }) {
  const [status, setStatus] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('unsubscribed');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    engagement.optOutStatus(outreachId)
      .then((s) => { if (live) setStatus(s); })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [outreachId]);

  async function record() {
    setBusy(true);
    setError(null);
    try {
      const result = await engagement.recordOptOut(outreachId, { reason, note });
      setStatus(result);
      setConfirming(false);
      onRecorded(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 space-y-3" data-testid="opt-out-control">
      <h4 className="font-heading text-sm font-semibold">Opt-out</h4>
      {status?.optedOut ? (
        <p className="text-sm" data-testid="opt-out-recorded">
          Opted out
          {status.recordedAt ? ` since ${new Date(status.recordedAt).toLocaleDateString()}` : ''}.
          {' '}Outreach prepared from this Thriv3 database will not be addressed to it, for any athlete.
          {' '}It is not copied to other environments or to the engagement edge service.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            If {recipientLabel} replied asking not to be contacted, record it here. The address is added to the
            opt-out list in this Thriv3 database, so outreach prepared here will not be addressed to it, for any
            athlete. It is not copied to other environments or to the engagement edge service. This cannot be
            undone from the app.
          </p>
          {!confirming ? (
            <Button size="sm" variant="outline" onClick={() => setConfirming(true)} disabled={!status} data-testid="opt-out-start">
              Record opt-out
            </Button>
          ) : (
            <div className="space-y-2" data-testid="opt-out-confirm">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Reason
                <select
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  data-testid="opt-out-reason"
                >
                  {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Note (optional)
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} data-testid="opt-out-note" />
              </label>
              <div className="flex gap-2">
                <Button size="sm" onClick={record} disabled={busy} data-testid="opt-out-confirm-button">
                  {busy ? 'Recording…' : 'Confirm opt-out'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
              </div>
            </div>
          )}
        </>
      )}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </Card>
  );
}
