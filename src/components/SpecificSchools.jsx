import React, { useState } from 'react';
import {
  Loader2, Star, MailCheck, ChevronDown, ChevronRight, PenSquare,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CREATE_EMAIL_DRAFT, MANUAL_ONLY_BADGE, MANUAL_ONLY_HINT, moreCoaches,
  AWAITING_CONFIRMATION, MARK_AS_SENT, MARK_AS_SENT_HINT,
  DISCARD_DRAFT, DISCARD_DRAFT_HINT,
  CAMPAIGN_MAY_CONTACT, CAMPAIGN_MAY_CONTACT_HINT, DO_NOT_CONTACT_BADGE,
  NOT_IN_TOP_100, AWAITING_SECTION, SHOW_DETAILS, HIDE_DETAILS,
  contactStateShort, engagementShort, draftAge,
} from '@/lib/outreachLabels';
import SpecificSchoolDetail from '@/components/SpecificSchoolDetail';
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
 *
 * ---------------------------------------------------------------------------
 * COMPACT ROW, EXPANDABLE DETAIL — F8b.
 *
 * Every slice from F3 to F7 added one more true thing to this row and had
 * nowhere else to put it, until a fully-loaded row carried ten stacked lines
 * and eleven badges. Nothing was wrong; it had simply stopped being scannable,
 * which is the one job a list has.
 *
 * So the row now answers three questions at a glance — what is it, what is the
 * contact policy, what has happened — plus a fourth above them when there is
 * an outstanding action. Everything else moved to `SpecificSchoolDetail`,
 * unabridged and one click away. No request is made when a row expands.
 * ---------------------------------------------------------------------------
 */

function where(row) {
  return [row.city, row.state].filter(Boolean).join(', ');
}

/** Both reads are keyed the same way, so the two lookups cannot drift. */
const keyFor = (p) => contactIntelligenceKey(p.college_name, p.sport);

/**
 * A DRAFT THRIV3 OPENED AND HAS HEARD NOTHING ABOUT SINCE — F7b, F8b.
 *
 * ===========================================================================
 * THE ONE THING THE OPERATOR HAS TO DO, PUT WHERE THEY WILL SEE IT.
 *
 * Thriv3 hands the message to Outlook and receives no id and no handle back,
 * so it cannot tell whether Send was pressed. Until a person says so, the
 * school is not contacted, the campaign is still free to write to it, and
 * every reply-rate denominator ignores it.
 *
 * That confirmation has existed since long before this — as a terminal
 * command, `npm run confirm-sends`, which an operator working in a browser
 * will never run. An action nobody can see is an action nobody takes, which is
 * why this is a band at the top of the row rather than a better CLI.
 * ===========================================================================
 *
 * BOTH ANSWERS ARE OFFERED, and the second is not an afterthought. A draft the
 * operator deleted in Outlook would otherwise sit here for ever, and an
 * operator with no way to say "I did not send that" eventually confirms it to
 * clear the list — which is the one outcome that puts a message nobody
 * received into every denominator.
 *
 * NEITHER BUTTON CLAIMS AN OBSERVATION. "Mark as sent" records what the person
 * says; "Discard draft record" clears Thriv3's own expectation and touches
 * nothing in Outlook.
 *
 * TINTED, NOT ALARMED — F8b. The band is visually distinct because it is the
 * only thing on the row asking for an action, and deliberately not red: a
 * draft waiting three days is an ordinary state of this workflow, not a
 * failure, and an interface that treats routine work as an emergency teaches
 * operators to dismiss emergencies.
 */
function PendingDrafts({ drafts, busy, error, onConfirm, onDiscard }) {
  if (!drafts?.length) return null;
  return (
    <div
      className="rounded-md border border-border bg-muted/40 p-2 space-y-1.5 mb-2"
      data-testid="pending-drafts"
    >
      {drafts.map((d) => {
        const age = draftAge(d.drafted_at);
        return (
          <div key={d.send_id} className="space-y-1">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <p className="text-xs text-muted-foreground min-w-0">
                <span className="text-foreground font-medium">{AWAITING_CONFIRMATION}</span>
                {d.coach_name ? ` — ${d.coach_name}` : ''}
                {d.position_title ? ` (${d.position_title})` : ''}
                {/*
                  AGE, NOT URGENCY. Stated as flatly at nine days as at nine
                  minutes — Thriv3 does not know whether the message was sent,
                  so it cannot know whether anything is wrong. What age buys is
                  discrimination between the draft the operator is mid-way
                  through and one they have plainly forgotten.
                */}
                {age && <span className="ml-1">· {age}</span>}
              </p>
              <div className="flex items-center gap-1 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  title={MARK_AS_SENT_HINT}
                  onClick={() => onConfirm(d)}
                >
                  <MailCheck className="h-3.5 w-3.5 mr-1" /> {MARK_AS_SENT}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  title={DISCARD_DRAFT_HINT}
                  onClick={() => onDiscard(d)}
                >
                  {DISCARD_DRAFT}
                </Button>
              </div>
            </div>
            {/*
              THE FAILURE STAYS WITH THE MESSAGE IT IS ABOUT — F8b.
              Nothing was removed optimistically, so the draft is still here
              beneath this sentence, still offering both answers. Unlike the
              page-level load notice, this is a fact about ONE message.
            */}
            {error?.sendId === d.send_id && (
              <p className="text-xs text-destructive" role="alert" data-testid="draft-action-error">
                {error.message}
              </p>
            )}
          </div>
        );
      })}
      {/* Said once per row group, because the action is an assertion. */}
      <p className="text-[11px] text-muted-foreground">{MARK_AS_SENT_HINT}</p>
    </div>
  );
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
 * above already refuses to tell by saying "Drafted" rather than "Sent".
 * ===========================================================================
 *
 * NO RANKING AND NO RECOMMENDATION. The order is the one the shared
 * intelligence layer supplied and nothing re-sorts it — not alphabetically
 * either, which F8a proposed and F8b deliberately reversed. A sort order an
 * operator can name is a claim about which coach matters, even when the claim
 * is "none"; that judgement belongs to Email Intelligence.
 *
 * "+N more" IS NO LONGER THE ONLY WAY TO REACH THE REST — F8b. The expansion
 * lists every contacted coach, so the truncation here is a density choice
 * rather than the boundary of what is discoverable.
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

/**
 * THE CONTACT POLICY, AS EXACTLY ONE BADGE — F8b.
 *
 * ===========================================================================
 * INCLUDING WHEN THE POLICY PERMITS EVERYTHING.
 *
 * `manual_only` and `do_not_contact` each had a badge and `default` had
 * nothing, so the most permissive state in the product was indistinguishable
 * from a row nobody had thought about. Absence-as-a-state is the ambiguity
 * this product refuses everywhere else, and on a workspace built for
 * deliberate contact it is the one that most needs saying out loud.
 * ===========================================================================
 *
 * ONE OF THREE, NEVER TWO. They are values of a single column, not flags.
 */
function ContactPolicyBadge({ stance }) {
  if (stance === 'do_not_contact') {
    return <Badge variant="red">{DO_NOT_CONTACT_BADGE}</Badge>;
  }
  if (stance === 'manual_only') {
    return <Badge variant="blue">{MANUAL_ONLY_BADGE}</Badge>;
  }
  return (
    <Badge variant="muted" title={CAMPAIGN_MAY_CONTACT_HINT}>{CAMPAIGN_MAY_CONTACT}</Badge>
  );
}

function SpecificSchoolRow({
  programme, rank, busy, onRemove, onManualOutreach, contact = null, contactUnavailable = false,
  contactKnown = false, onSetContactStance = null, onFlag = null,
  onSaveNote = null, onSetVisibility = null,
  pendingDrafts = [], draftError = null, onConfirmSent = null, onDiscardDraft = null,
}) {
  const [open, setOpen] = useState(false);

  /**
   * UNKNOWN IS NOT NONE, AND THE COMPRESSION DOES NOT GET TO FORGET THAT.
   *
   * `contactStateShort` returns null unless the athlete-level history is known
   * to have ARRIVED, and a failed read silences it outright — the page carries
   * one notice explaining the silence. A collapsed row is a smaller surface,
   * not a licence to assert an absence nobody established.
   */
  const historyText = contactUnavailable ? null : contactStateShort(contact, contactKnown);
  const engagementText = contactUnavailable ? null : engagementShort(contact);

  return (
    <li className="p-3" data-testid="specific-school-row">
      {/* LEVEL 0 — the outstanding action, above everything it is about. */}
      {onConfirmSent && onDiscardDraft && (
        <PendingDrafts
          drafts={pendingDrafts}
          busy={busy}
          error={draftError}
          onConfirm={onConfirmSent}
          onDiscard={onDiscardDraft}
        />
      )}

      {/*
        LEVEL 1 — THE GLANCE.
        `flex-wrap` and no `shrink-0` on the action cluster: before F8b the
        three buttons occupied roughly 440px that could neither shrink nor
        wrap, so at tablet width they crushed the name column and at phone
        width the row overflowed its card. Two buttons now, and they drop to
        their own line rather than winning a fight with the school's name.
      */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate" data-testid="school-name">{programme.college_name}</p>
            {/* POLICY — exactly one, always present. */}
            <ContactPolicyBadge stance={programme.contact_stance} />
            {/* FACT — what has actually gone to this programme, in one phrase. */}
            {historyText && (
              <Badge variant="muted" data-testid="contact-state">{historyText}</Badge>
            )}
            {/* FACT — the strongest single thing a coach did, if anything. */}
            {engagementText && <Badge variant="green">{engagementText}</Badge>}
            {/*
              DECISION — a ranking decision, not a contact one. The row stays
              in this list either way: a school taken out of the Top 100 is
              very often the one somebody asked for by name, so the badge
              explains its absence from the ranked view rather than removing it
              from this one. The control to reverse it is in the expansion.
            */}
            {programme.visibility === 'suppressed'
              && <Badge variant="muted">{NOT_IN_TOP_100}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            {[programme.division, programme.conference, where(programme)].filter(Boolean).join(' · ')
              || programme.sport}
          </p>
          {/*
            THE BADGE ALONE WOULD BE READ AS A CLOSURE. "Manual outreach only"
            says what stops; this says what does not — the school is still
            here, still ranked where it was ranked, and still ours to write to
            by hand. Kept at level 1 because a policy that restricts must never
            be one click further away than the badge announcing it.
          */}
          {programme.contact_stance === 'manual_only' && (
            <p className="text-xs text-muted-foreground">{MANUAL_ONLY_HINT}</p>
          )}
          <ContactedCoaches summary={contact} />
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {/*
            THE POINT OF A SPECIFIC REQUEST. Somebody asked for this school, so
            the next thing an operator wants is to write to it. Offered on
            EVERY row, including one taken out of the Top 100: a ranking
            decision is not a contact decision, and `contact_stance` is the
            only thing that stops this — server-side, inside the dialog and
            again inside the send path.
          */}
          {onManualOutreach && (
            <Button size="sm" variant="outline" onClick={() => onManualOutreach(programme)}>
              <PenSquare className="h-3.5 w-3.5 mr-1" /> {CREATE_EMAIL_DRAFT}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open
              ? <><ChevronDown className="h-3.5 w-3.5 mr-1" /> {HIDE_DETAILS}</>
              : <><ChevronRight className="h-3.5 w-3.5 mr-1" /> {SHOW_DETAILS}</>}
          </Button>
        </div>
      </div>

      {/* LEVEL 2 — context, history and the secondary decisions. */}
      {open && (
        <SpecificSchoolDetail
          programme={programme}
          rank={rank}
          contact={contact}
          contactUnavailable={contactUnavailable}
          contactKnown={contactKnown}
          busy={busy}
          onRemove={onRemove}
          onSaveNote={onSaveNote}
          onFlag={onFlag}
          onSetVisibility={onSetVisibility}
          onSetContactStance={onSetContactStance}
        />
      )}
    </li>
  );
}

/**
 * THE OLDEST DRAFT THIS PROGRAMME IS WAITING ON, or null if it is waiting on
 * none. A missing timestamp sorts LAST rather than first — an unknown age is
 * not evidence of urgency, and sorting it to the top would put the one draft
 * nobody can date above every draft they can.
 */
function oldestPendingAt(drafts) {
  if (!drafts?.length) return null;
  return drafts.reduce((oldest, d) => {
    const at = d.drafted_at || '￿';
    return oldest === null || at < oldest ? at : oldest;
  }, null);
}

export default function SpecificSchools({
  specific, recommendations, loading, failed, pending, error, onRemove, onManualOutreach = null,
  onSetContactStance = null, onFlag = null, onSaveNote = null, onSetVisibility = null,
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
  /**
   * Manual drafts awaiting confirmation, keyed by programme. ONE athlete-level
   * request feeds every row — a per-card lookup would be an N+1 that grows with
   * exactly the athletes who have the most outreach.
   */
  pendingByProgramme = new Map(),
  /** A confirm or discard that failed, attached to the message it was about. */
  draftError = null,
  onConfirmSent = null,
  onDiscardDraft = null,
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

  /**
   * TWO SECTIONS, AND ONLY STATES THAT ARE ACTUALLY KNOWN DECIDE WHICH — F8b.
   *
   * ===========================================================================
   * A PENDING DRAFT IS THE ONLY THING THAT PROMOTES A SCHOOL.
   *
   * It is the one state on this screen that names an OUTSTANDING ACTION by a
   * specific person: Thriv3 composed something, a human has it, and nobody has
   * said what happened to it. Everything else is a fact or a policy.
   *
   * A reply is a fact, not a task — deciding that it needs answering is
   * judgement, and judgement here belongs to Email Intelligence. `manual_only`
   * and `do_not_contact` are policies; a policy is not a priority, and sorting
   * by one would quietly turn a contact rule into a work queue.
   * ===========================================================================
   *
   * DETERMINISTIC, AND STABLE ACROSS RENDERS. Oldest waiting draft first, ties
   * broken by name; everything else alphabetical. The data only changes on the
   * page's own bounded refetches, so a list cannot reorder under a cursor for
   * any other reason.
   */
  const awaiting = [];
  const rest = [];
  for (const p of specific) {
    const drafts = pendingByProgramme.get(keyFor(p)) ?? [];
    if (drafts.length) awaiting.push([p, oldestPendingAt(drafts)]);
    else rest.push(p);
  }
  awaiting.sort(([a, atA], [b, atB]) => (
    atA < atB ? -1 : atA > atB ? 1 : a.college_name.localeCompare(b.college_name)
  ));
  rest.sort((a, b) => a.college_name.localeCompare(b.college_name));

  const row = (p) => (
    <SpecificSchoolRow
      key={p.id}
      programme={p}
      rank={rankOf(p.college_name)}
      busy={pending === (p.college_id || p.id)}
      onRemove={onRemove}
      onManualOutreach={onManualOutreach}
      contact={contactByProgramme.get(keyFor(p))}
      contactUnavailable={contactUnavailable}
      contactKnown={contactKnown}
      pendingDrafts={pendingByProgramme.get(keyFor(p)) ?? []}
      draftError={draftError}
      onConfirmSent={onConfirmSent}
      onDiscardDraft={onDiscardDraft}
      onSetContactStance={onSetContactStance}
      onFlag={onFlag}
      onSaveNote={onSaveNote}
      onSetVisibility={onSetVisibility}
    />
  );

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
        <>
          {/*
            ABSENT RATHER THAN EMPTY. A heading reading "Awaiting your
            confirmation (0)" would be a standing reminder of an obligation
            nobody has, which is how a real one comes to be scrolled past.
          */}
          {awaiting.length > 0 && (
            <div className="space-y-1.5" data-testid="awaiting-section">
              <p className="text-xs font-semibold">{AWAITING_SECTION(awaiting.length)}</p>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-border">{awaiting.map(([p]) => row(p))}</ul>
              </Card>
            </div>
          )}

          {rest.length > 0 && (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-border">{rest.map(row)}</ul>
            </Card>
          )}
        </>
      )}

      {error && error.collegeId && (
        <p className="text-xs text-destructive" role="alert">{error.message}</p>
      )}
    </div>
  );
}
