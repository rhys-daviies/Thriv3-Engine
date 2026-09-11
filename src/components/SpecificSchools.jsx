import React from 'react';
import { Loader2, Star, Handshake } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RELATIONSHIP_OUTREACH } from '@/lib/outreachLabels';
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

function SpecificSchoolRow({
  programme, rank, busy, onRemove, onManualOutreach, contact = null, contactUnavailable = false,
}) {
  return (
    <li className="flex items-start justify-between gap-3 p-3" data-testid="specific-school-row">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium truncate">{programme.college_name}</p>
          <Badge variant="purple">Specific Request</Badge>
          {programme.flagged && <Badge variant="amber">Flagged</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {[programme.division, programme.conference, where(programme)].filter(Boolean).join(' · ')
            || programme.sport}
        </p>
        {/*
          SUPPLEMENTAL, and only when the programme is genuinely ranked. No
          rank is invented for a school that is not: a placeholder here would
          be read as a match score by the next person to look at the screen.
        */}
        <ProgrammeContactSummary summary={contact} withhold={contactUnavailable} />
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
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRemove(programme)}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Remove'}
        </Button>
      </div>
    </li>
  );
}

export default function SpecificSchools({
  specific, recommendations, loading, failed, pending, error, onRemove, onManualOutreach = null,
  /** The athlete's whole history, fetched once by the workspace. */
  contactByProgramme = new Map(),
  /** The history could not be loaded; an absent entry means nothing. */
  contactUnavailable = false,
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
