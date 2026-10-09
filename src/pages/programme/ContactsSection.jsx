import React from 'react';
import { Badge } from '@/components/ui/badge';
import { programmes as api } from '@/api/client';
import { useSection } from './useSection';

/**
 * COACHES & CONTACTS — Phase 4. A read of the two existing per-programme
 * routes, with their safeguards unchanged:
 *
 *   /api/colleges/:id/coaches              coaches passing the send floor NOW
 *   /api/colleges/:id/programme-contacts   the programme's verified inbox(es),
 *                                          each sendable:false
 *
 * Nothing here composes, sends or selects. Addresses are shown as text with no
 * email link: outreach starts from an athlete's workspace, where every send
 * safeguard runs.
 */
export default function ContactsSection({ id }) {
  const coaches = useSection(() => api.coaches(id), [id]);
  const inboxes = useSection(() => api.contacts(id), [id]);

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        Read only. Outreach to these contacts is started from an athlete's workspace, where eligibility, suppressions and send safeguards are applied.
      </p>

      <div className="rounded-lg border border-border p-4 space-y-2" data-testid="contacts-coaches">
        <h3 className="text-sm font-semibold">Coaches</h3>
        {coaches.loading && <p className="text-xs text-muted-foreground">Loading coaches…</p>}
        {coaches.error && <p className="text-xs text-destructive">{coaches.error}</p>}
        {coaches.data && (coaches.data.coaches.length
          ? (
            <ul className="divide-y divide-border text-sm">
              {coaches.data.coaches.map((c) => (
                <li key={c.coach_id} className="py-1.5 flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  {c.title && <span className="text-muted-foreground text-xs">{c.title}</span>}
                  <span className="text-xs text-muted-foreground ml-auto select-all">{c.email}</span>
                  {c.email_status && <Badge variant={c.email_status === 'verified' ? 'green' : 'muted'}>{c.email_status}</Badge>}
                </li>
              ))}
            </ul>
          )
          : <p className="text-xs text-muted-foreground" data-testid="no-coaches">No coach for this programme currently passes the outreach eligibility floor.</p>)}
        {coaches.data?.optedOut?.length > 0 && (
          <p className="text-[11px] text-muted-foreground" data-testid="coaches-opted-out">
            Not listed - opted out of Thriv3 email: {coaches.data.optedOut.map((c) => c.name || 'Coach').join(', ')}.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border p-4 space-y-2" data-testid="contacts-inboxes">
        <h3 className="text-sm font-semibold">Programme inboxes</h3>
        {inboxes.loading && <p className="text-xs text-muted-foreground">Loading programme inboxes…</p>}
        {inboxes.error && <p className="text-xs text-destructive">{inboxes.error}</p>}
        {inboxes.data && (
          <>
            {inboxes.data.contacts.length
              ? (
                <ul className="divide-y divide-border text-sm">
                  {inboxes.data.contacts.map((c) => (
                    <li key={c.contact_id} className="py-1.5 flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.label}</span>
                      <span className="text-xs text-muted-foreground">{c.contact_role === 'RECRUITING_INBOX' ? 'recruiting inbox' : 'team inbox'}</span>
                      <span className="text-xs text-muted-foreground ml-auto select-all">{c.email}</span>
                      {c.provenance?.freshness && <Badge variant="muted">{String(c.provenance.freshness).toLowerCase()}</Badge>}
                    </li>
                  ))}
                </ul>
              )
              : <p className="text-xs text-muted-foreground" data-testid="no-inboxes">No verified programme inbox on file.</p>}
            {inboxes.data.optedOut > 0 && (
              <p className="text-[11px] text-muted-foreground" data-testid="inboxes-opted-out">
                {inboxes.data.optedOut} programme inbox{inboxes.data.optedOut === 1 ? ' has' : 'es have'} opted out and {inboxes.data.optedOut === 1 ? 'is' : 'are'} not listed.
              </p>
            )}
            {inboxes.data.withheld > 0 && (
              <p className="text-[11px] text-muted-foreground" data-testid="inboxes-withheld">
                {inboxes.data.withheld} recorded inbox{inboxes.data.withheld === 1 ? ' is' : 'es are'} withheld: no longer current or ownership not established.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
