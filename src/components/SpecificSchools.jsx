import React from 'react';
import { Loader2, Star, Handshake } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  RELATIONSHIP_OUTREACH, MANUAL_ONLY_BADGE, MANUAL_ONLY_HINT, moreCoaches,
} from '@/lib/outreachLabels';
import ContactStanceControl from '@/components/ContactStanceControl';
import ProgrammeContactSummary from '@/components/ProgrammeContactSummary';
import { contactIntelligenceKey } from '@shared/contactIntelligenceKey.js';

/**
 * The schools this athlete asked for, kept apart from the ones we ranked.
 *
 * A SEPARATE LIST, NOT A MERGE. Specific Schools are not inserted into the
 * ranked recommendations and are not given a rank of their own: a school is in
 * this list because somebody asked for it, and dressing that up as a match
 * score would be a number the matching engine never produced. Where a
 * programme genuinely IS in the Top 100 its real rank is shown alongside — as
 * information read off the existing analysis, never written back to it.
 *
 * REMOVING WITHDRAWS, IT DOES NOT DELETE. The relationship row also carries
 * the flag, the note and the contact stance, none of which have anything to do
 * with the request; deleting the row to clear a request would take all of them
 * with it.
 */

function where(row) {
  return [row.city, row.state].filter(Boolean).join(', ');
}

/** How many names fit on a list row before it stops being scannable. */
const COACHES_SHOWN = 2;

/**
 * WHO WE HAVE ACTUALLY WRITTEN TO AT THIS SCHOOL — F6b.
 *
 * ===========================================================================
 * CONFIRMED SENDS ONLY, AND THAT IS THE WHOLE FILTER.
 *
 * A coach carrying a draft nobody confirmed has not heard from this athlete,
 * and listing them under "Contacted" would be the same lie the summary badge
 * above already refuses to tell by saying "Drafted" rather than "Sent". The
 * drafted state is reported there, once, for the programme; this line is only
 * about people who received something.
 * ===========================================================================
 *
 * NO RANKING AND NO RECOMMENDATION. The order is the one the shared
 * intelligence layer supplied and nothing re-sorts it. Deciding which coach
 * matters most, or which to write to next, is judgement — it belongs to the
 * Email Intelligence workstream, and a list row quietly implying an order
 * would be this surface answering a question it was not asked.
 *
 * Renders nothing when nobody has been confirmed, rather than "0 coaches
 * contacted": the programme-level summary beside it has already said whether
 * anything was sent, and a zero here would be a second way of saying it.
 */
function ContactedCoaches({ summary }) {
  const contacted = (summary?.coaches ?? []).filter((c) => c.has_confirmed_send);
  if (!contacted.length) return null;

  const shown = contacted.slice(0, COACHES_SHOWN);
  const remainder = contacted.length - shown.length;

  return (
    <p className="text-xs text-muted-foreground" data-testid="contacted-coaches">
      <span className="uppercase tracking-wide text-[10px] font-semibold">Contacted </span>
      {shown.map((c, i) => (
        <span key={c.coach_id}>
          {i > 0 && ', '}
          <span className="text-foreground">{c.coach_name}</span>
          {c.position_title ? ` — ${c.position_title}` : ''}
        </span>
      ))}
      {remainder > 0 && <span> · {moreCoaches(remainder)}</span>}
    </p>
  );
}

function SpecificSchoolRow({
  programme, rank, busy, onRemove, onManualOutreach, contact = null, contactUnavailable = false,
  contactKnown = false, onSetContactStance = null, onFlag = null,
}) {
  return (
    <li className="flex items-start justify-between gap-3 p-3" data-testid="specific-school-row">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium truncate">{programme.college_name}</p>
          <Badge variant="purple">Specific Request</Badge>
          {programme.flagged && <Badge variant="amber">Flagged</Badge>}
          {programme.contact_stance === 'manual_only'
            && <Badge variant="blue">{MANUAL_ONLY_BADGE}</Badge>}
          {programme.contact_stance === 'do_not_contact'
            && <Badge variant="red">Do not contact</Badge>}
          {/*
            A RANKING DECISION, SHOWN BESIDE THE OTHERS AND NOT INSTEAD OF THEM.
            The row stays in this list either way — a school taken out of the
            Top 100 is very often the one somebody asked for by name — so the
            badge explains why it is absent from the ranked view rather than
            removing it from this one. Same wording as the match card.
          */}
          {programme.visibility === 'suppressed'
            && <Badge variant="muted">Not in Top 100</Badge>}
        </div>
        {/*
          THE BADGE ALONE WOULD BE READ AS A CLOSURE. "Manual outreach only"
          says what stops; this says what does not — the school is still here,
          still ranked where it was ranked, and still ours to write to by hand.
        */}
        {programme.contact_stance === 'manual_only' && (
          <p className="text-xs text-muted-foreground">{MANUAL_ONLY_HINT}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {[programme.division, programme.conference, where(programme)].filter(Boolean).join(' · ')
            || programme.sport}
        </p>
        {/*
          WHY THIS SCHOOL IS HERE — F6b.
          `flag_reason` is mandatory when a relationship is flagged, precisely
          so this question has an answer; it was being collected and never
          shown on this surface. The note is the operator's own running
          context. Both render only when present: an empty "Reason —" line on
          every unflagged row would be a placeholder claiming a field exists
          where nobody filled one in.
        */}
        {programme.flagged && programme.flag_reason && (
          <p className="text-xs text-muted-foreground">{programme.flag_reason}</p>
        )}
        {programme.note && (
          <p className="text-xs">
            <span className="text-muted-foreground">Note: </span>{programme.note}
          </p>
        )}
        {/*
          SUPPLEMENTAL, and only when the programme is genuinely ranked. No
          rank is invented for a school that is not: a placeholder here would
          be read as a match score by the next person to look at the screen.
        */}
        <ProgrammeContactSummary
          summary={contact}
          withhold={contactUnavailable}
          known={contactKnown}
        />
        <ContactedCoaches summary={contact} />
        {rank != null && (
          <p className="text-xs text-muted-foreground">
            Also ranked <span className="font-medium text-foreground">#{rank}</span> in this
            athlete&rsquo;s recommendations.
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {/*
          THE POINT OF A SPECIFIC REQUEST. Somebody asked for this school, so
          the next thing an operator wants is to write to it.
          Deliberately offered on EVERY row, including one whose programme has
          been taken out of the Top 100: a ranking decision is not a contact
          decision, and `contact_stance` is the only thing that stops this —
          server-side, inside the dialog and again inside the send path.
        */}
        {onManualOutreach && (
          <Button size="sm" variant="outline" onClick={() => onManualOutreach(programme)}>
            <Handshake className="h-3.5 w-3.5 mr-1" /> {RELATIONSHIP_OUTREACH}
          </Button>
        )}
        {/*
          Offered on every row for the same reason the outreach button above
          it is: a ranking decision is not a contact decision, and a school
          taken out of the Top 100 is very often the one somebody has already
          spoken to.
        */}
        <ContactStanceControl
          collegeId={programme.college_id}
          collegeName={programme.college_name}
          relationship={programme}
          busy={busy}
          onSetContactStance={onSetContactStance}
          onFlag={onFlag}
        />
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRemove(programme)}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Remove'}
        </Button>
      </div>
    </li>
  );
}

export default function SpecificSchools({
  specific, recommendations, loading, failed, pending, error, onRemove, onManualOutreach = null,
  onSetContactStance = null, onFlag = null,
  /** The athlete's whole history, fetched once by the workspace. */
  contactByProgramme = new Map(),
  /** The history could not be loaded; an absent entry means nothing. */
  contactUnavailable = false,
  /**
   * The history HAS loaded, so an absent entry means "nobody has written to
   * them" rather than "we have not asked yet". Only with this may a row say
   * so out loud — see `known` in ProgrammeContactSummary.
   */
  contactKnown = false,
}) {
  /**
   * Rank by name, from the analysis already in memory. ARRAY ORDER IS THE
   * RANKING everywhere in this product, so position + 1 is the rank; nothing
   * is recomputed and nothing is stored.
   */
  const rankOf = (name) => {
    if (!recommendations) return null;
    const i = recommendations.findIndex((r) => r.name === name);
    return i === -1 ? null : i + 1;
  };

  if (loading) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1.5 py-6 justify-center">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading this athlete&rsquo;s specific schools...
      </p>
    );
  }

  if (failed) {
    // An empty list and a list that failed to load look identical on screen,
    // and one of them means "nothing was asked for" while the other means
    // "we do not know what was asked for".
    return (
      <p className="text-sm text-destructive py-6 text-center" role="alert">
        This athlete&rsquo;s specific schools could not be loaded. Reload before assuming there are none.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && !error.collegeId && (
        <p className="text-xs text-destructive" role="alert">{error.message}</p>
      )}

      {specific.length === 0 ? (
        <div className="text-center py-16">
          <Star className="h-9 w-9 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            No specific schools yet. Use Specific Search to add a programme this athlete has asked
            about.
          </p>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {specific.map((p) => (
              <SpecificSchoolRow
                key={p.id}
                programme={p}
                rank={rankOf(p.college_name)}
                busy={pending === (p.college_id || p.id)}
                onRemove={onRemove}
                onManualOutreach={onManualOutreach}
                contact={contactByProgramme.get(contactIntelligenceKey(p.college_name, p.sport))}
                contactUnavailable={contactUnavailable}
                contactKnown={contactKnown}
                onSetContactStance={onSetContactStance}
                onFlag={onFlag}
              />
            ))}
          </ul>
        </Card>
      )}

      {error && error.collegeId && (
        <p className="text-xs text-destructive" role="alert">{error.message}</p>
      )}
    </div>
  );
}
