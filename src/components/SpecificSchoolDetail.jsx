import React, { useState } from 'react';
import { Eye, EyeOff, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ContactStanceControl from '@/components/ContactStanceControl';
import ProgrammeContactSummary from '@/components/ProgrammeContactSummary';
import { kindLabel } from '@shared/evidence/index.js';
import { PROGRAMME_EVIDENCE } from '@/lib/useProgrammeEvidence';
import {
  NOTE_LABEL, ADD_NOTE, EDIT_NOTE, SAVE_NOTE, NOTE_PLACEHOLDER,
  FLAG_REASON_LABEL, ADD_FLAG_REASON, EDIT_FLAG_REASON, SAVE_FLAG_REASON,
  FLAG_REASON_PLACEHOLDER, CONTEXT_HINT,
  KEEP_IN_TOP_100, REMOVE_FROM_TOP_100,
  ALL_CONTACTED_COACHES, ORIGIN_LABEL, ORIGIN_UNRECORDED,
  MANUAL_ONLY_HINT, ALREADY_IN_TOUCH_HINT, EXISTING_RELATIONSHIP, videoWatched,
  PROGRAMME_EVIDENCE_HEADING, PROGRAMME_EVIDENCE_HINT, PROGRAMME_EVIDENCE_LOADING,
  PROGRAMME_EVIDENCE_NONE, PROGRAMME_EVIDENCE_FAILED, PROGRAMME_EVIDENCE_RETRY,
  PROGRAMME_EVIDENCE_ALSO_KNOWN,
} from '@/lib/outreachLabels';

/**
 * EVERYTHING THE COLLAPSED ROW DELIBERATELY DOES NOT SAY — F8b.
 *
 * ===========================================================================
 * THE LIST IS FOR SCANNING; THIS IS FOR WORKING ON ONE SCHOOL.
 *
 * Before F8b the row carried up to ten stacked lines and eleven badges,
 * because every slice from F3 to F7 had one more true thing to add to it and
 * nowhere else to put it. Nothing here is new information — it is the same
 * facts, off the scanning surface and onto the one an operator opens
 * deliberately.
 * ===========================================================================
 *
 * AND THE CONTROLS THAT HAD NOWHERE TO LIVE. `ProgrammeRelationship` owns the
 * note editor, the flag reason and the Top 100 toggle, and it renders ONLY in
 * the match-card footer — so for a specific school outside the Top 100 there
 * was no path to any of them anywhere in the product. The handlers already
 * existed on the workspace and were passed nowhere. This is where they land.
 *
 * NOTHING IS COMPUTED HERE. Every value is read from the relationship row or
 * from the athlete-level contact summary the page already fetched; no request
 * is made when a row expands, which is what keeps expansion free and keeps the
 * page's request count independent of how many rows are open.
 */

function when(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * ONE EDITOR SHAPE FOR TWO DIFFERENT FIELDS, and they stay two fields.
 *
 * `flag_reason` answers a question asked once — why this school became
 * specifically important — and `note` is running context that changes as the
 * recruitment does. They are separate columns written by separate mutations,
 * and merging them on screen would let whatever happened most recently
 * overwrite the reason the school is here at all.
 */
function TextField({
  label, value, placeholder, addLabel, editLabel, saveLabel, busy, onSave, testId,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  const start = () => { setDraft(value ?? ''); setEditing(true); };

  if (!editing) {
    return (
      <div data-testid={testId}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {value
          ? <p className="text-xs">{value}</p>
          : <p className="text-xs text-muted-foreground">Not recorded</p>}
        <button type="button" className="text-xs underline text-muted-foreground" onClick={start}>
          {value ? editLabel : addLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid={testId}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <Input
        autoFocus
        value={draft}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="flex gap-2">
        {/*
          An empty value is not saved. Both fields mean something by being
          absent — an unflagged school has no reason and a school nobody has
          annotated has no note — and saving an empty string would replace
          "nothing recorded" with a recorded nothing.
        */}
        <Button size="sm" disabled={busy || !draft.trim()}
          onClick={() => { onSave(draft.trim()); setEditing(false); }}>
          {saveLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </div>
  );
}

/**
 * WHAT WE SENT EACH COACH, AND WHAT THEY DID — EVERY ONE OF THEM.
 *
 * ===========================================================================
 * THE ORDER IS THE PAYLOAD'S AND NOTHING RE-SORTS IT.
 *
 * Not alphabetical, not by recency, not by seniority. Deciding which coach
 * matters most, or which to write to next, is judgement — it belongs to the
 * Email Intelligence workstream, and any ordering this surface imposed would
 * be read as an answer to a question it was not asked. Alphabetising was
 * considered in the F8a audit and rejected for exactly that reason: a sort
 * order an operator can name is a claim, even when the claim is "none".
 * ===========================================================================
 *
 * WHY THE FULL LIST LIVES HERE. The collapsed row shows the first two and
 * "+N more", which is the right density for scanning but made the remaining
 * names reachable only by counting. Here every contacted coach is named, so
 * nothing essential is behind a tooltip or a truncation.
 */
function ContactedCoachDetail({ summary }) {
  const contacted = (summary?.coaches ?? []).filter((c) => c.has_confirmed_send);
  if (!contacted.length) return null;

  return (
    <div data-testid="contacted-coach-detail">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {ALL_CONTACTED_COACHES}
      </p>
      <ul className="space-y-0.5 mt-0.5">
        {contacted.map((c) => {
          const parts = [];
          const at = c.last_confirmed_send_at;
          parts.push(at ? `last sent ${when(at)}` : 'sent');
          if (c.confirmed_send_count > 1) parts.push(`${c.confirmed_send_count} sent`);

          /**
           * Origin where it is known and honestly where it is not. A null is
           * the record for every message written before the column existed and
           * means "not recorded" — inferring `manual` from it would
           * manufacture the provenance the column exists to stop
           * manufacturing.
           */
          const origins = [...new Set(c.origins ?? [])];
          const named = origins.filter(Boolean).map((o) => ORIGIN_LABEL[o] ?? o);
          if (named.length) parts.push(named.join(' and '));
          if (origins.includes(null)) parts.push(ORIGIN_UNRECORDED);
          if (c.revoked_at) parts.push('link revoked');

          const e = c.engagement;
          const did = [];
          if (e?.profile_visits > 0) {
            did.push(e.profile_visits > 1
              ? `profile visit recorded ${e.profile_visits}x`
              : 'profile visit recorded');
          }
          if (e?.best_coverage_pct > 0) did.push(`watched ${e.best_coverage_pct}% of the video`);
          if (e?.reply_recorded) did.push('reply recorded');

          return (
            <li key={c.coach_id} className="text-xs">
              <span className="font-medium">{c.coach_name}</span>
              {c.position_title && <span className="text-muted-foreground"> — {c.position_title}</span>}
              <span className="text-muted-foreground"> · {parts.join(' · ')}</span>
              {/*
                SEPARATE FROM THE LINE BEFORE IT, because they are different
                kinds of fact: one is what this product did, the other is what
                somebody else did. The passive is the honest voice — the token
                proves the athlete's page was opened through this link, not who
                opened it, and there is no email open or click in this build.
              */}
              {did.length > 0 && (
                <span className="text-emerald-400">{' · '}{did.join(' · ')}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The engagement facts in full, none of them inferred and none of them an open. */
function EngagementDetail({ summary }) {
  const e = summary?.engagement;
  if (!e) return null;
  const lines = [];
  if (e.profile_visits > 0) {
    lines.push(e.profile_visits > 1
      ? `Profile visit recorded ${e.profile_visits}x`
      : 'Profile visit recorded');
  }
  if (e.last_visit_at) lines.push(`Last visit ${when(e.last_visit_at)}`);
  if (e.best_coverage_pct > 0) lines.push(videoWatched(e.best_coverage_pct));
  if (e.reply_recorded) {
    lines.push(e.reply_recorded_at ? `Reply recorded ${when(e.reply_recorded_at)}` : 'Reply recorded');
  }
  if (!lines.length) return null;

  return (
    <div data-testid="engagement-detail">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Engagement
      </p>
      <p className="text-xs text-muted-foreground">{lines.join(' · ')}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  WHAT THRIV3 KNOWS - F9b                                                   */
/* -------------------------------------------------------------------------- */

/**
 * ONE FINDING, PRINTED AS THE SERVER WROTE IT.
 *
 * ===========================================================================
 * `text` IS THE CLAIM. THIS COMPONENT HAS NO RENDERER AND CANNOT ACQUIRE ONE.
 *
 * The wire carries the SERVER-RENDERED sentence and no `data`, which is the
 * whole safety argument: a SIGNAL arrives already hedged by the tier-aware
 * renderer and stays hedged whatever a screen does with it, and there is
 * nothing here from which a claim could be assembled, paraphrased or
 * strengthened.
 * ===========================================================================
 *
 * THE TIER IS THE PART TO KEEP. FACT is checkable against the programme's own
 * pages; SIGNAL is an interpretation. The registry's words, unrenamed - an
 * "Insight" or a "Prediction" badge would promote the weaker of the two into
 * something the engine never said.
 *
 * NO STRENGTH, IN ANY FORM. `strength` is an internal 0-100 priority and the
 * wire carries it; nothing here reads it. A number would be taken for a
 * percentage of something, and a bar for a ranking - and this surface ranks
 * nothing. The order is the server's.
 *
 * THE LABEL IS `kindLabel`, never the registry key: HISTORICAL_SAME_COUNTRY is
 * a grouping constant for a database, and an operator should not have to
 * decode it to learn we have recruited from this athlete's country before.
 */
function Finding({ ev, muted = false }) {
  return (
    <li className="py-0.5" data-testid="evidence-finding">
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <span className={muted ? 'text-xs text-muted-foreground' : 'text-xs font-medium'}>
          {kindLabel(ev.kind)}
        </span>
        {ev.tier && (
          <Badge variant={ev.tier === 'FACT' ? 'green' : 'amber'}>{ev.tier}</Badge>
        )}
      </span>
      {ev.text && (
        <p className={`text-xs ${muted ? 'text-muted-foreground/80' : 'text-muted-foreground'}`}>
          {ev.text}
        </p>
      )}
      {/*
        FRESHNESS ONLY WHERE IT ACTUALLY MOVED SOMETHING - and in the server's
        words. `downgraded` is present only when staleness changed the
        confidence; nothing here computes an age or decides what one means. A
        badge derived from a date in the browser would be this surface
        inventing a freshness verdict the engine owns.
      */}
      {ev.downgraded?.reason && (
        <p className="text-[11px] text-amber-700 dark:text-amber-500" data-testid="evidence-freshness">
          {ev.downgraded.reason}
        </p>
      )}
    </li>
  );
}

/**
 * WHAT THIS PROGRAMME'S OWN RECORD SUPPORTS SAYING - READ ONLY.
 *
 * ===========================================================================
 * FOUR ANSWERS, AND ONLY ONE OF THEM IS ABOUT THE SCHOOL.
 *
 *   IDLE     nobody has asked. Renders NOTHING - an absence claimed before a
 *            question was put is the one false statement available here.
 *   LOADING  the answer is coming. Says so, rather than showing an empty list.
 *   READY    the answer arrived. Findings, or the honest "nothing to say".
 *   FAILED   we could not find out. Never the sentence above it, and never
 *            beside it.
 * ===========================================================================
 *
 * A PREVIEW, NOT THE COMPOSER. No selection, no reordering, no structure
 * picker, no subject, no body, no coach list and no send. Deciding what this
 * email says is `EvidencePanel`'s job inside the draft, and duplicating its
 * controls here would give an operator two places to make one decision.
 */
function ProgrammeEvidence({ programmeEvidence }) {
  const { status, evidence, reason, reload } = programmeEvidence ?? {};

  /** Not asked yet. Nothing is known, and nothing is said. */
  if (!status || status === PROGRAMME_EVIDENCE.IDLE) return null;

  const heading = (
    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {PROGRAMME_EVIDENCE_HEADING}
    </p>
  );

  if (status === PROGRAMME_EVIDENCE.LOADING) {
    return (
      <div data-testid="programme-evidence">
        {heading}
        <p className="text-xs text-muted-foreground">{PROGRAMME_EVIDENCE_LOADING}</p>
      </div>
    );
  }

  if (status === PROGRAMME_EVIDENCE.FAILED) {
    return (
      <div data-testid="programme-evidence">
        {heading}
        <p className="text-xs text-amber-700 dark:text-amber-500" data-testid="evidence-failed">
          {PROGRAMME_EVIDENCE_FAILED}
          {/* The server's own sentence where it sent one. More actionable than
              a generic failure, and not an interpretation of it. */}
          {reason ? ` ${reason}` : ''}
        </p>
        {reload && (
          <Button size="sm" variant="outline" className="mt-1" onClick={() => reload()}>
            {PROGRAMME_EVIDENCE_RETRY}
          </Button>
        )}
      </div>
    );
  }

  /**
   * PRINTABLE MEANS THE SERVER RENDERED A SENTENCE FOR IT.
   *
   * A selected finding can legitimately arrive without one - the composer caps
   * a paragraph, so a claim may be chosen, logged and deliberately not carried
   * by the email. It is real, and there is nothing to print, so it is not
   * counted as something this surface can show.
   */
  const selected = (evidence?.selected ?? []).filter((e) => e.text);
  /**
   * `available` says of itself which entries were selected, so the split is
   * the wire's rather than this screen's. Dropped and internal-only findings
   * are deliberately NOT here: the full picture, with what could not be used
   * and why, belongs to the composer.
   */
  const alsoKnown = (evidence?.available ?? []).filter((e) => !e.selected && e.text);

  if (!selected.length && !alsoKnown.length) {
    return (
      <div data-testid="programme-evidence">
        {heading}
        <p className="text-xs text-muted-foreground" data-testid="evidence-none">
          {PROGRAMME_EVIDENCE_NONE}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="programme-evidence">
      {heading}
      <p className="text-[11px] text-muted-foreground">{PROGRAMME_EVIDENCE_HINT}</p>
      {selected.length > 0 && (
        <ul className="mt-1">
          {selected.map((ev) => <Finding key={ev.kind} ev={ev} />)}
        </ul>
      )}
      {alsoKnown.length > 0 && (
        <div className="mt-1.5" data-testid="evidence-also-known">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {PROGRAMME_EVIDENCE_ALSO_KNOWN}
          </p>
          <ul>
            {alsoKnown.map((ev) => <Finding key={ev.kind} ev={ev} muted />)}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function SpecificSchoolDetail({
  programme, rank = null, contact = null, contactUnavailable = false, contactKnown = false,
  busy = false, onRemove, onSaveNote = null, onFlag = null,
  onSetVisibility = null, onSetContactStance = null,
  /**
   * The programme-evidence read, owned by the ROW rather than by this
   * component - collapsing unmounts what is rendered here, and an answer that
   * died with it would be fetched again every time somebody looked twice.
   */
  programmeEvidence = null,
}) {
  const suppressed = programme.visibility === 'suppressed';

  /**
   * THE COLLEGE-SHAPED HANDLE THE FLAG WRITER TAKES.
   *
   * `flag()` on the workspace resolves its target through the registry id, so
   * a relationship whose `college_id` is null — the column is nullable, and a
   * relationship with no registry row is still a relationship — cannot be
   * flagged through it. The editor is therefore ABSENT rather than broken on
   * those rows: offering a control that would fail is worse than offering
   * none, and inventing a second write path to cover it would be a second
   * storage mechanism for one fact.
   */
  const college = programme.college_id
    ? { id: programme.college_id, name: programme.college_name }
    : null;

  return (
    <div className="mt-2 pt-2 border-t border-border space-y-3" data-testid="school-detail">
      {/* ---------------------------------------------------------------- */}
      {/* WHY THIS SCHOOL IS HERE                                          */}
      {/* ---------------------------------------------------------------- */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="purple">Specific Request</Badge>
          {/*
            THE RELATIONSHIP FACT, NEXT TO THE REASON THAT EXPLAINS IT — F8b.
            It is off the collapsed row on purpose: every row in this list is a
            specific request, so "somebody recorded a relationship here" is
            worth far more read beside `flag_reason` than as a fifth badge on a
            line being scanned. Same word as the match card and the dialog now.
          */}
          {programme.flagged && <Badge variant="amber">{EXISTING_RELATIONSHIP}</Badge>}
          {/*
            THE RANK IS READ, NEVER WRITTEN, AND NEVER INVENTED. A school is in
            this list because somebody asked for it; where it ALSO happens to
            be ranked, that position comes off the analysis already in memory.
            A school that is not ranked gets no line at all — a placeholder
            here would be read as a match score by the next person to look.
          */}
          {rank != null && (
            <span className="text-xs text-muted-foreground">
              Also ranked <span className="font-medium text-foreground">#{rank}</span> in
              this athlete&rsquo;s recommendations.
            </span>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">{CONTEXT_HINT}</p>

        {onFlag && college ? (
          <TextField
            testId="flag-reason-field"
            label={FLAG_REASON_LABEL}
            value={programme.flag_reason}
            placeholder={FLAG_REASON_PLACEHOLDER}
            addLabel={ADD_FLAG_REASON}
            editLabel={EDIT_FLAG_REASON}
            saveLabel={SAVE_FLAG_REASON}
            busy={busy}
            /*
              THE EXISTING MUTATION, USED TRUTHFULLY. `flag()` sets `flagged`
              and `flag_reason` together, which is what recording a reason
              means: a reason without a flag would be a sentence about a
              relationship the row does not claim to have. No second write
              path and no new column.
            */
            onSave={(text) => onFlag(college, text)}
          />
        ) : (
          programme.flag_reason && (
            <div data-testid="flag-reason-field">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {FLAG_REASON_LABEL}
              </p>
              <p className="text-xs">{programme.flag_reason}</p>
            </div>
          )
        )}

        {onSaveNote && (
          <TextField
            testId="note-field"
            label={NOTE_LABEL}
            value={programme.note}
            placeholder={NOTE_PLACEHOLDER}
            addLabel={ADD_NOTE}
            editLabel={EDIT_NOTE}
            saveLabel={SAVE_NOTE}
            busy={busy}
            onSave={(text) => onSaveNote(programme, text)}
          />
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* WHAT HAS ACTUALLY HAPPENED                                       */}
      {/* ---------------------------------------------------------------- */}
      <div className="space-y-2">
        {/*
          THE SAME COMPONENT THE MATCH CARDS USE, UNCHANGED AND WITH THE SAME
          GUARDS. `known` is what licenses "No contact recorded"; `withhold` is
          what silences everything when the athlete-level read failed. An
          expansion is not a licence to say more than the page knows.
        */}
        <ProgrammeContactSummary
          summary={contact}
          withhold={contactUnavailable}
          known={contactKnown}
        />
        <ContactedCoachDetail summary={contact} />
        <EngagementDetail summary={contact} />
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* WHAT WE COULD SAY - separate from what we DID, deliberately.      */}
      {/* Contact intelligence above is history; this is programme evidence, */}
      {/* and a profile visit is not a reason to write to a coach.          */}
      {/* ---------------------------------------------------------------- */}
      <ProgrammeEvidence programmeEvidence={programmeEvidence} />

      {/* ---------------------------------------------------------------- */}
      {/* THE DECISIONS                                                    */}
      {/* ---------------------------------------------------------------- */}
      {programme.contact_stance === 'manual_only' && (
        <p className="text-xs text-muted-foreground">{MANUAL_ONLY_HINT}</p>
      )}
      {/*
        THE CONSEQUENCE AS TEXT, NOT ONLY AS A TOOLTIP.
        `ContactStanceControl` carries the same sentence in a `title`, which is
        unreachable on touch and invisible to anyone not hovering. Here — where
        there is room — it is read before the button is pressed rather than
        discovered from `MANUAL_ONLY_HINT` afterwards.
      */}
      {programme.contact_stance === 'default' && onSetContactStance && (
        <p className="text-xs text-muted-foreground" data-testid="already-in-touch-hint">
          {ALREADY_IN_TOUCH_HINT}
        </p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {/*
          CONTACT POLICY AND RANKING DECISION, SIDE BY SIDE AND STILL SEPARATE.
          Whether the campaign may write is not whether the school is on the
          actionable hundred, and neither is whether somebody asked for it.
          Three columns, three controls, no synthetic status.
        */}
        <ContactStanceControl
          collegeId={programme.college_id}
          collegeName={programme.college_name}
          relationship={programme}
          busy={busy}
          onSetContactStance={onSetContactStance}
          onFlag={onFlag}
        />

        {onSetVisibility && (
          suppressed ? (
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => onSetVisibility(programme, 'default')}>
              <Eye className="h-3.5 w-3.5 mr-1" /> {KEEP_IN_TOP_100}
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => onSetVisibility(programme, 'suppressed')}>
              <EyeOff className="h-3.5 w-3.5 mr-1" /> {REMOVE_FROM_TOP_100}
            </Button>
          )
        )}

        {/*
          THE ONLY DESTRUCTIVE CONTROL, AND NO LONGER ONE GAP FROM A POLICY
          BUTTON ON A ROW BEING SCANNED. It withdraws the request; it does not
          delete the row, which also carries the flag, the note and the contact
          stance — none of which have anything to do with the request.
        */}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRemove(programme)}>
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
        </Button>
      </div>
    </div>
  );
}
