import React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  ACTIVITY_LABEL, ENGAGEMENT_HINT, DRAFT_ONLY_HINT,
  NO_CONTACT_RECORDED, NO_CONTACT_RECORDED_HINT,
  ORIGIN_SHORT, ORIGIN_UNRECORDED_SHORT,
  videoWatched, VIDEO_HINT,
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
   * TRUE ONLY WHEN THE ATHLETE'S HISTORY HAS ACTUALLY ARRIVED — F6b.
   *
   * ---------------------------------------------------------------------------
   * THE ONE PROP THAT EXISTS TO PREVENT A FALSE STATEMENT.
   *
   * A programme nobody has written to is ABSENT from the map rather than
   * present and empty, so absence is the fact — but only once the map is known
   * to be complete. While the request is in flight, or before it starts, the
   * map is also empty, and every programme in the product is momentarily
   * indistinguishable from one nobody has ever contacted.
   *
   * So this defaults to FALSE and the no-history sentence is rendered only when
   * a caller positively says the answer is settled. A surface that has not
   * threaded the status through gets silence, which is what it had before and
   * is never wrong. `withhold` remains the separate, stronger signal for a
   * request that FAILED — there the page carries CONTACT_UNAVAILABLE_NOTICE and
   * cards render nothing at all.
   * ---------------------------------------------------------------------------
   */
  known = false,
  /**
   * TRUE WHEN THE HISTORY COULD NOT BE LOADED, AND THEN THIS RENDERS NOTHING.
   *
   * Not a badge saying so. The request is athlete-level, so its failure is one
   * fact about the page, carried by one notice there; a marker on every card
   * would claim twenty separate programme-level failures. What this flag buys
   * is the guarantee that no card falls back to LOOKING contacted-or-not while
   * the answer is unknown — a stale or partially populated map cannot leak a
   * summary past it, and "nothing rendered" never becomes an assertion,
   * because the page notice is what explains the silence.
   */
  withhold = false,
}) {
  if (withhold) return null;

  /**
   * A MISS IS THE ANSWER — WHERE THE ANSWER IS KNOWN.
   *
   * On the Top 100 this still renders nothing: "No contact recorded" under
   * ninety cards would be ninety assertions of the same non-fact, and the
   * absence of a badge already reads as "nothing yet" on a ranked list nobody
   * has worked through.
   *
   * On a SPECIFIC SCHOOL it is said out loud, because the question there is
   * different. Somebody asked for that school, or marked it as one we are
   * handling by hand, and "what have we actually done about it" is the reason
   * the row is being read. Silence answers that question badly — and since F5b
   * it answers it ambiguously, because `manual_only` can now stand on a
   * relationship with nothing in `outreach` behind it.
   *
   * `known` is what separates the two, and it never defaults to true.
   */
  if (!summary?.contacted) {
    if (!known) return null;
    return (
      <div className={`flex items-center gap-1.5 flex-wrap ${className}`} data-testid="contact-summary">
        <span className="text-xs text-muted-foreground" title={NO_CONTACT_RECORDED_HINT}>
          {NO_CONTACT_RECORDED}
        </span>
      </div>
    );
  }

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

  /**
   * HOW FAR THROUGH THE VIDEO ANYONE GOT — F6b.
   *
   * Already on the summary and already shown per coach in the relationship
   * dialog; it was simply never rendered here. `best_coverage_pct` is the
   * furthest a SINGLE session reached, so the wording is "watched N%" and not a
   * total across visits — the shared helper keeps this line and the dialog's
   * identical, because the same fact worded two ways reads as two facts.
   *
   * Zero renders nothing. A programme with a visit and no video play is a real
   * and common state, and "Watched 0%" would put a number where there is none.
   */
  if (engagement.best_coverage_pct > 0) {
    facts.push({
      key: 'video',
      text: videoWatched(engagement.best_coverage_pct),
      title: VIDEO_HINT,
      tone: 'green',
    });
  }

  if (engagement.reply_recorded) {
    facts.push({ key: 'reply', text: 'Reply recorded', title: ENGAGEMENT_HINT.reply, tone: 'green' });
  }

  /**
   * WHICH PART OF THE PRODUCT WROTE TO THEM — F6b.
   *
   * ---------------------------------------------------------------------------
   * EVERY ORIGIN ON FILE, NEVER COLLAPSED TO ONE.
   *
   * `origins` is a SET across the relationship's messages, so a coach reached
   * by a campaign in March and by hand in June carries both — and both are
   * true. Picking one would be choosing which half of the history to hide, and
   * the half that matters depends on the question being asked.
   *
   * NULL IS RENDERED, NOT DROPPED AND NOT GUESSED. It is the honest record for
   * every message written before the origin column existed, and it means "not
   * recorded", which is different from either named value. Inferring `manual`
   * from it would manufacture exactly the provenance the column was added to
   * stop being manufactured.
   * ---------------------------------------------------------------------------
   */
  const origins = summary.origins ?? [];
  const namedOrigins = origins.filter(Boolean).map((o) => ORIGIN_SHORT[o]).filter(Boolean);
  for (const label of [...new Set(namedOrigins)].sort()) {
    facts.push({ key: `origin-${label}`, text: label });
  }
  if (origins.includes(null)) {
    facts.push({ key: 'origin-unrecorded', text: ORIGIN_UNRECORDED_SHORT });
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
