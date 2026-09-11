import React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  ACTIVITY_LABEL, ENGAGEMENT_HINT, DRAFT_ONLY_HINT,
  CONTACT_UNAVAILABLE, CONTACT_UNAVAILABLE_HINT,
} from '@/lib/outreachLabels';

/**
 * HAS ANYONE WRITTEN TO THIS PROGRAMME, AND DID THE COACH DO ANYTHING?
 *
 * One compact, read-only formatter over the derived summary. It performs no
 * action, fetches nothing and owns no state — the athlete's whole history
 * arrives in one request and every card reads its own entry out of a map.
 *
 * ---------------------------------------------------------------------------
 * THREE SIGNALS, KEPT APART, because collapsing any pair of them would assert
 * something nobody established:
 *
 *   PRIOR OUTREACH   we wrote something. It says nothing about whether a coach
 *                    read it, and a draft says nothing about whether one was
 *                    even sent.
 *   ENGAGEMENT       the coach did something we can observe.
 *   RELATIONSHIP     an operator recorded context — a flag, a note, a request.
 *                    That lives on `athlete_programmes` and is rendered
 *                    elsewhere, because a sent email is not a relationship and
 *                    a profile visit is not one either.
 * ---------------------------------------------------------------------------
 *
 * NOTHING HERE SAYS "opened" OR "clicked" ABOUT AN EMAIL. There is no pixel
 * and no email click tracking in this product. What is recorded is a visit to
 * the athlete's profile page through the coach's own tracked link, which is a
 * stronger fact than an open and a different one.
 */

function when(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function ProgrammeContactSummary({
  summary, className = '',
  /**
   * TRUE WHEN THE HISTORY COULD NOT BE LOADED, which is a different thing from
   * a programme having none. Both render nothing by default, so without this
   * an operator glancing at a card after a failed request would read the
   * absence of a marker as "never contacted" — the one conclusion the data
   * does not support.
   */
  unavailable = false,
}) {
  if (unavailable) {
    return (
      <div className={`flex items-center gap-1.5 flex-wrap ${className}`} data-testid="contact-unavailable">
        <Badge variant="muted" title={CONTACT_UNAVAILABLE_HINT}>{CONTACT_UNAVAILABLE}</Badge>
      </div>
    );
  }

  /**
   * A MISS IS THE ANSWER. Programmes nobody has written to are absent from the
   * map rather than present and empty, and this renders nothing for them —
   * "Not contacted" on ninety cards would be ninety assertions of the same
   * non-fact.
   */
  if (!summary?.contacted) return null;

  const { engagement } = summary;
  const facts = [];

  if (summary.draft_only) {
    facts.push({ key: 'draft', text: `Drafted ${when(summary.last_drafted_at)}`, title: DRAFT_ONLY_HINT });
  } else if (summary.has_confirmed_send) {
    const count = summary.confirmed_send_count;
    facts.push({
      key: 'sent',
      text: count > 1
        ? `Sent ${count}x, last ${when(summary.last_confirmed_send_at)}`
        : `Sent ${when(summary.last_confirmed_send_at)}`,
    });
  }

  if (engagement.profile_visits > 0) {
    facts.push({
      key: 'visit',
      // A count is safe here ONLY because the rollup collapses sessions and
      // excludes scanner traffic. A raw event total would not be.
      text: engagement.profile_visits > 1
        ? `Profile visit recorded ${engagement.profile_visits}x`
        : 'Profile visit recorded',
      title: ENGAGEMENT_HINT.profile_visit,
      tone: 'green',
    });
  }

  if (engagement.reply_recorded) {
    facts.push({ key: 'reply', text: 'Reply recorded', title: ENGAGEMENT_HINT.reply, tone: 'green' });
  }

  if (summary.revoked_count > 0) {
    facts.push({
      key: 'revoked',
      text: summary.revoked_count > 1 ? `${summary.revoked_count} links revoked` : 'Link revoked',
      tone: 'muted',
    });
  }

  if (!facts.length) return null;

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`} data-testid="contact-summary">
      {facts.map((f) => (
        <Badge key={f.key} variant={f.tone ?? 'muted'} title={f.title}>{f.text}</Badge>
      ))}
      {/*
        The strongest thing on file, named. Ordered by what it says about the
        COACH rather than by recency — a visit last month means more than a
        draft this morning.
      */}
      {summary.last_activity_kind && (
        <span className="text-xs text-muted-foreground">
          {ACTIVITY_LABEL[summary.last_activity_kind]} {when(summary.last_activity_at)}
        </span>
      )}
    </div>
  );
}
