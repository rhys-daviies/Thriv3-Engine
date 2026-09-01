import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { kindLabel } from '@shared/evidence/index.js';

/**
 * Why this email says what it says — and, where the operator disagrees, a way
 * to say something else.
 *
 * The argument for an evidence engine over a mail merge is that every claim
 * traces to a roster or a result. That argument is worth nothing to an operator
 * who cannot see the trace before pressing send, so this shows what was
 * selected and in what order, what else was available, what was dropped and
 * WHY it was dropped, and what we know but may not write.
 *
 * The tier badge is the part to keep. FACT is checkable against the programme's
 * own pages; SIGNAL is an interpretation and is written hedged. An operator who
 * knows which is which can spot a wrong one.
 *
 * SELECTION SAFETY. Every control here emits a list of evidence KINDS and a
 * structure KEY — never a sentence, never a fact. The server regenerates the
 * evidence, validates each kind against what it produced, validates the
 * structure against what that evidence supports, re-renders through the
 * tier-appropriate renderer and recomposes the body. So an operator can change
 * WHICH true thing is said and in what ORDER, and cannot introduce an untrue
 * one, promote a SIGNAL, reach a kind that failed its confidence floor, reach
 * one suppressed for staleness, or reach the internal-only intelligence at the
 * bottom. That is enforced in shared/evidence/select.js and
 * shared/evidence/structures.js, not here.
 *
 * Reordering in particular goes through the server rather than being done in
 * the browser, because order is not cosmetic: the structure decides which
 * paragraph each claim lands in, and moving an item between slots is a
 * different email, not a different sort.
 */

/** Falls back to the old ceiling if an older server did not send one. */
const DEFAULT_MAX = 4;

/**
 * The three groups, derived once and shared by both presentations.
 *
 * Extracted when the match card gained an evidence section. The card and the
 * composer show the same evidence in very different shapes — one is a
 * half-width read-only summary, the other a working surface with reordering
 * controls — but they must never disagree about WHICH group a finding is in.
 * Two copies of the non-overlap rule below would eventually drift, and the
 * drift would read as the card and the composer describing different
 * programmes.
 *
 * This is grouping, not evidence logic: every decision it reflects — what was
 * selected, what was suppressed and why, what may not be emailed — was made on
 * the server and arrives already made. Nothing here ranks, re-renders or
 * re-classifies anything.
 */
export function groupEvidence(wire, chosenKinds = null) {
  const {
    selected = [], available = [], internal = [], otherKnown = [],
  } = wire ?? {};

  const chosen = chosenKinds ?? selected.map((e) => e.kind);
  const chosenSet = new Set(chosen);

  /**
   * The two lists must not overlap.
   *
   * An item that lost to the slot floor is in BOTH `available` (it survived
   * dedupe, so it is in the ranking) and `otherKnown` (it is below threshold).
   * Listing it in both places showed the same evidence twice on screen — once
   * as a strong option and once as too weak to use — which is exactly the kind
   * of self-contradiction that makes an operator stop trusting the panel.
   * `available` is therefore narrowed to what genuinely cleared every gate.
   */
  const droppedKinds = new Set(otherKnown.map((e) => e.kind));
  const others = available.filter((e) => !chosenSet.has(e.kind) && !droppedKinds.has(e.kind));
  const dropped = otherKnown.filter((e) => !chosenSet.has(e.kind));

  return {
    chosen,
    chosenSet,
    others,
    dropped,
    internal,
    // Everything the engine knows and did not lead with, closest-to-selected
    // first: an item that cleared dedupe and lost only to the slot floor is a
    // nearer miss than one suppressed as redundant.
    otherAvailable: [...others, ...dropped],
    byKind: new Map([
      ...available.map((e) => [e.kind, e]),
      ...otherKnown.filter((e) => e.text).map((e) => [e.kind, e]),
      ...selected.map((e) => [e.kind, e]),
    ]),
    hasEmailable: selected.length > 0 || available.length > 0 || dropped.length > 0,
  };
}

function TierBadge({ tier }) {
  return <Badge variant={tier === 'FACT' ? 'green' : 'amber'}>{tier}</Badge>;
}

/** Where in the email a claim sits, in words an operator reads rather than a key. */
const SLOT_WORDS = {
  HOOK: 'opens the email',
  RELEVANCE: 'after the introduction',
  RECOGNITION: 'programme recognition, near the end',
};

/**
 * Selected, and deliberately not in this email.
 *
 * The composer caps a paragraph at two gathered clauses, so a fourth piece of
 * evidence can be chosen, logged and shown here without being sent. Saying so
 * is the point: the panel must never imply a coach read something they did
 * not.
 */
const NOT_SHOWN = 'kept for the record — not in this email';

function Meta({ ev }) {
  return (
    <span className="text-[11px] text-muted-foreground">
      {ev.confidence?.toLowerCase()} confidence
      {ev.season ? ` · ${ev.season}` : ''}
    </span>
  );
}

/**
 * One line of the panel.
 *
 * `actions` is rendered rather than assumed, because the three lists want
 * different ones — a selected item can be removed and moved, an available one
 * can only be added — and a single control that changes meaning by position is
 * how an operator ends up removing something they meant to promote.
 */
function EvidenceLine({ ev, index = null, reason = null, slot = null, actions = null }) {
  return (
    <div className="flex gap-2 rounded px-1.5 py-1 text-xs">
      {index !== null && (
        <span className="mt-px w-3 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
          {index + 1}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{kindLabel(ev.kind)}</span>
          {ev.tier && <TierBadge tier={ev.tier} />}
          <Meta ev={ev} />
          {slot && (
            <span className="text-[11px] text-muted-foreground">· {SLOT_WORDS[slot] ?? slot}</span>
          )}
          {ev.displayed === false && (
            <span className="text-[11px] text-amber-700 dark:text-amber-500">· {NOT_SHOWN}</span>
          )}
        </span>
        {ev.text && <span className="mt-0.5 block text-muted-foreground">{ev.text}</span>}
        {reason && <span className="mt-0.5 block text-[11px] text-muted-foreground">{reason}</span>}
        {/* Shown per item only where freshness actually changed something —
            a timestamp beside every current fact would be noise on the
            programmes whose roster was read this week. */}
        {ev.downgraded && (
          <span className="mt-0.5 block text-[11px] text-amber-700 dark:text-amber-500">
            Confidence lowered from {ev.downgraded.from.toLowerCase()} — {ev.downgraded.reason}
          </span>
        )}
      </span>
      {actions && <span className="flex shrink-0 items-start gap-0.5">{actions}</span>}
    </div>
  );
}

function IconButton({ title, onClick, disabled, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function Section({ title, note, children }) {
  return (
    <div>
      <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {note && <p className="mb-1 px-1.5 text-[11px] text-muted-foreground">{note}</p>}
      {children}
    </div>
  );
}

export default function EvidencePanel({
  evidence, loading, failed, body = null,
  selection = null, onSelectionChange = null,
  onStructureChange = null,
  className = '',
}) {
  const [showInternal, setShowInternal] = useState(false);
  const [showOther, setShowOther] = useState(false);

  if (loading) {
    return (
      <p className={`text-xs text-muted-foreground ${className}`}>
        Checking what we can say about this programme…
      </p>
    );
  }

  // Said plainly rather than shown as "no evidence". A failed lookup and a
  // programme with nothing to say produce the same empty email, and conflating
  // them would let a server problem read as a fact about the school.
  if (failed) {
    return (
      <p className={`text-xs text-amber-700 dark:text-amber-500 ${className}`}>
        Could not load programme evidence — this draft is the plain template. The email is
        still correct, just not personalised to the programme.
      </p>
    );
  }

  if (!evidence) return null;

  const {
    selected = [], available = [], internal = [], otherKnown = [],
    structure, structureLabel, structureOptions = [], structureSource, structureRefused,
    programme, paragraph, operatorSelected, maxEvidence = DEFAULT_MAX,
  } = evidence;

  // The operator's working order when they have one, the server's otherwise.
  // Both are lists of kinds; the SERVER decides what those kinds mean.
  const {
    chosen, byKind, others, dropped,
  } = groupEvidence(evidence, selection ?? null);
  const slotByKind = new Map(selected.map((e) => [e.kind, e.slot]));
  const atLimit = chosen.length >= maxEvidence;
  const editable = typeof onSelectionChange === 'function';

  const emit = (next) => onSelectionChange(next);
  const remove = (kind) => emit(chosen.filter((k) => k !== kind));
  const add = (kind) => { if (!atLimit) emit([...chosen, kind]); };
  const move = (from, to) => {
    if (to < 0 || to >= chosen.length) return;
    const next = [...chosen];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    emit(next);
  };

  /**
   * Why a current-roster fact is missing or softened.
   *
   * Surfaced only when it needs attention: a roster read this week says
   * nothing an operator has to act on. When it is old, the operator has to be
   * able to see that the absence of a roster claim is our caution rather than
   * the programme having nothing to say.
   */
  const fresh = programme?.freshness;
  const freshnessNotice = fresh && fresh.state !== 'CURRENT' && programme?.hasSquad
    ? (fresh.state === 'STALE'
      ? `Current-roster claims are suppressed here: ${fresh.reason}. Historical evidence is unaffected — it names its own seasons.`
      : `Current roster last verified ${fresh.ageDays} days ago, so present-tense claims are held at lower confidence.`)
    : null;

  if (!selected.length && !available.length && !dropped.length) {
    const why = freshnessNotice
      || (programme?.hasSquad || programme?.hasHistory
        ? 'We have this programme’s roster but nothing specific enough to say about it.'
        : 'No roster data on file for this programme yet.');
    return (
      <div className={`rounded-md border border-dashed p-2.5 ${className}`}>
        <p className="text-xs text-muted-foreground">{why} The email leads with the athlete instead.</p>
      </div>
    );
  }

  const inBody = body == null || !paragraph
    ? null
    : selected.some((e) => e.text && String(body).toLowerCase().includes(e.text.toLowerCase()));

  return (
    <div className={`space-y-2.5 rounded-md border p-2.5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium">Why this email is personalised this way</span>
        {/* Only the shapes this evidence can honestly carry. A structure whose
            requirement is not met is not in the list at all, rather than
            offered and refused — the server would refuse it either way, and a
            menu of options that do not work is not a choice. */}
        {typeof onStructureChange === 'function' && structureOptions.length > 1 ? (
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Shape
            <select
              value={structure}
              onChange={(e) => onStructureChange(e.target.value)}
              className="rounded border bg-background px-1.5 py-0.5 text-[11px] text-foreground"
            >
              {structureOptions.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <span className="font-mono text-[11px] text-muted-foreground">
            {structureLabel || structure}
          </span>
        )}
      </div>

      {structureRefused && (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-400">
          {kindLabel(structureRefused.key)} was not used — {structureRefused.reason}. Showing{' '}
          {structureLabel || structure} instead.
        </p>
      )}

      {freshnessNotice && (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-400">
          {freshnessNotice}
        </p>
      )}

      <Section
        title={(
          <>
            Used in email
            {(operatorSelected || structureSource === 'OPERATOR')
              && <span className="ml-1 normal-case font-normal">· your choice</span>}
          </>
        )}
      >
        {chosen.length === 0 ? (
          <p className="px-1.5 text-xs text-muted-foreground">
            Nothing selected — the email leads with the athlete.
          </p>
        ) : (
          chosen.map((kind, i) => {
            const ev = byKind.get(kind);
            if (!ev) return null;
            return (
              <EvidenceLine
                key={kind}
                ev={ev}
                index={i}
                slot={slotByKind.get(kind)}
                actions={editable ? (
                  <>
                    <IconButton title="Move up" onClick={() => move(i, i - 1)} disabled={i === 0}>
                      <ArrowUp className="h-3 w-3" />
                    </IconButton>
                    <IconButton
                      title="Move down"
                      onClick={() => move(i, i + 1)}
                      disabled={i === chosen.length - 1}
                    >
                      <ArrowDown className="h-3 w-3" />
                    </IconButton>
                    <IconButton title="Remove from email" onClick={() => remove(kind)}>
                      <X className="h-3 w-3" />
                    </IconButton>
                  </>
                ) : null}
              />
            );
          })
        )}
      </Section>

      {others.length > 0 && (
        <Section title="Other strong options">
          {others.map((ev) => (
            <EvidenceLine
              key={ev.kind}
              ev={ev}
              actions={editable ? (
                <IconButton
                  title={atLimit ? `${maxEvidence} is the limit — remove one first` : 'Add to email'}
                  onClick={() => add(ev.kind)}
                  disabled={atLimit}
                >
                  <Plus className="h-3 w-3" />
                </IconButton>
              ) : null}
            />
          ))}
          {atLimit && editable && (
            <p className="px-1.5 text-[11px] text-muted-foreground">
              {maxEvidence} is the limit — beyond that an approach reads as a report. Remove one first.
            </p>
          )}
        </Section>
      )}

      {dropped.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowOther((v) => !v)}
            className="text-[11px] text-muted-foreground underline underline-offset-2"
          >
            {showOther ? 'Hide' : 'Show'} {dropped.length} suppressed or below-threshold finding
            {dropped.length === 1 ? '' : 's'}
          </button>
          {showOther && (
            <div className="mt-1">
              {/* Each carries the reason it lost, which is the difference
                  between a considered choice and an arbitrary one. Still
                  offerable: the rules that dropped these are editorial, the
                  operator can see them, and overriding one is their call. */}
              {dropped.map((ev) => (
                <EvidenceLine
                  key={ev.kind}
                  ev={ev}
                  reason={ev.reason}
                  actions={editable && ev.text ? (
                    <IconButton
                      title={atLimit ? `${maxEvidence} is the limit — remove one first` : 'Use anyway'}
                      onClick={() => add(ev.kind)}
                      disabled={atLimit}
                    >
                      <Plus className="h-3 w-3" />
                    </IconButton>
                  ) : null}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* What the coach will actually read, in the order the structure puts it.
          Checked against the body rather than assumed: a template that predates
          the evidence engine has no place for these sentences, so the panel
          would otherwise promise prose the coach never receives. */}
      {selected.length > 0 && (inBody === false ? (
        <p className="border-t pt-2 text-xs text-amber-700 dark:text-amber-500">
          Not in this draft — none of these sentences appear in the body. If you edited it,
          paste back what you want kept.
        </p>
      ) : (
        <div className="border-t pt-2 text-xs text-muted-foreground">
          In the email:
          {selected.map((e) => (
            <span key={e.kind} className="ml-1 text-foreground">{e.text}</span>
          ))}
        </div>
      ))}

      {internal.length > 0 && (
        <div className="border-t pt-2">
          <button
            type="button"
            onClick={() => setShowInternal((v) => !v)}
            className="text-[11px] text-muted-foreground underline underline-offset-2"
          >
            {showInternal ? 'Hide' : 'Show'} {internal.length} internal-only finding
            {internal.length === 1 ? '' : 's'}
          </button>
          {showInternal && (
            <div className="mt-1 space-y-0.5">
              {/* No sentence is rendered for these and none can be: they are
                  marked email-ineligible in the registry, so the operator can
                  see what we know without it being offerable. */}
              {internal.map((ev) => (
                <p key={ev.kind} className="px-1.5 text-[11px] text-muted-foreground">
                  {kindLabel(ev.kind)} · {ev.confidence?.toLowerCase()} · not permitted in email
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The match card's read-only view                                             */
/* -------------------------------------------------------------------------- */

/**
 * How many findings the "other available" group shows before folding.
 *
 * Three. A half-width card that lists nine suppressed findings is a report
 * inside an accordion, and the operator opened the card to read a match.
 */
const OTHER_PREVIEW = 3;

/**
 * The card's subsection heading, deliberately quieter than the card's own.
 *
 * CollegeCard's `SectionHeading` prints the three things an operator reads the
 * card for — key info, why this score, outreach evidence. These sit one level
 * below that. Sharing its exact type made five headings look like five peers,
 * so "Outreach evidence" stopped reading as the parent of "Recommended" and
 * "Other available". Smaller, lighter and dimmer, so the level is visible
 * without introducing a second heading idiom.
 */
function CardSection({ title, children }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70 mb-1.5">
        {title}
      </p>
      {children}
    </div>
  );
}

/**
 * Relevance, as a bar rather than a number.
 *
 * `strength` is an internal 0-100 priority, and printing it would invite an
 * operator to read it as a percentage of something. A bar beside the claim says
 * "more than that one, less than this one", which is all it means and all it
 * can support. It also matches ScoreBreakdown two sections above.
 *
 * The track has to be visible for any of that to work. `bg-muted` on the dark
 * card is rgb(24,28,33) against rgb(16,20,25) — eight levels per channel, which
 * reads as no track at all, leaving the fill hanging in space as a stray dash.
 * ScoreBreakdown's own track is what this is supposed to echo, so it borrows the
 * same trick of a bordered rail, and widens to w-12: at w-8 the whole realistic
 * strength range spanned six pixels, so every bar looked identical anyway.
 */
function RelevanceBar({ strength }) {
  if (typeof strength !== 'number') return null;
  return (
    <span
      className="ml-auto h-1.5 w-12 shrink-0 self-center rounded-full bg-foreground/10 overflow-hidden"
      title={`Relevance ${strength} of 100`}
    >
      <span className="block h-full rounded-full bg-primary/70" style={{ width: `${strength}%` }} />
    </span>
  );
}

/**
 * One finding, compactly.
 *
 * The label is `kindLabel`, never the registry key: HISTORICAL_SAME_COUNTRY is
 * a grouping constant for a database, and an operator should not have to decode
 * it to learn that we have recruited from this athlete's country before.
 *
 * `text` is the SERVER-RENDERED sentence and is printed verbatim. The card has
 * no renderer, so a SIGNAL arrives hedged and stays hedged.
 */
function CardFinding({ ev, muted = false, reason = null, note = null }) {
  return (
    <div className="py-1">
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className={muted ? 'text-xs text-muted-foreground' : 'text-xs font-medium'}>
          {kindLabel(ev.kind)}
        </span>
        {ev.tier && <TierBadge tier={ev.tier} />}
        {!muted && <RelevanceBar strength={ev.strength} />}
      </div>
      {ev.text && (
        <p className={`mt-0.5 text-xs ${muted ? 'text-muted-foreground/80' : 'text-muted-foreground'}`}>
          {ev.text}
        </p>
      )}
      {note && <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-500">{note}</p>}
      {reason && <p className="mt-0.5 text-[11px] text-muted-foreground">{reason}</p>}
    </div>
  );
}

/**
 * What Thriv3 knows that could help us approach this programme.
 *
 * READ-ONLY, deliberately and completely. The composer is where an angle gets
 * chosen; this answers a different question — "is there anything here worth
 * writing about" — while the operator is still deciding which programmes to
 * approach at all. Selection controls here would be a second place to change
 * an email, and the one that could not show the result.
 *
 * Same wire model, same server, same grouping helper as the composer panel.
 * Nothing is ranked, re-rendered or re-classified in the browser.
 */
export function CardEvidence({ evidence, loading = false, failed = false }) {
  const [showOther, setShowOther] = useState(false);
  const [showInternal, setShowInternal] = useState(false);

  // Loading wins over an absent lookup. Paging to the next twenty leaves the
  // previous page's response in state until the new one lands, and every name
  // on the new page misses it — which without this would read as "nothing to
  // say about this programme" for as long as the request is in flight.
  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading outreach evidence…</p>;
  }

  // A failed request and a programme with nothing to say produce the same empty
  // screen, and conflating them would let a server problem read as a fact about
  // the school.
  if (failed) {
    return (
      <p className="text-xs text-amber-700 dark:text-amber-500">
        Outreach evidence could not be loaded.
      </p>
    );
  }

  if (!evidence) {
    return (
      <p className="text-xs text-muted-foreground">
        No strong outreach evidence identified for this programme.
      </p>
    );
  }

  const { selected = [] } = evidence;
  const { otherAvailable, internal, hasEmailable } = groupEvidence(evidence);

  // Nothing emailable, but we do hold internal intelligence. Two different
  // states, said as two different things: "we have nothing" and "we have
  // something we may not put in an email" are not the same message.
  if (!hasEmailable) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          No strong outreach evidence identified for this programme.
        </p>
        {internal.length > 0 && <AdditionalIntelligence
          internal={internal}
          open={showInternal}
          onToggle={() => setShowInternal((v) => !v)}
        />}
      </div>
    );
  }

  const preview = showOther ? otherAvailable : otherAvailable.slice(0, OTHER_PREVIEW);
  const hidden = otherAvailable.length - preview.length;

  return (
    <div className="space-y-3">
      <CardSection title="Recommended outreach evidence">
        {selected.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing strong enough to lead with — an approach would introduce the athlete first.
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {selected.map((ev) => (
              <CardFinding
                key={ev.kind}
                ev={ev}
                /* Selected and deliberately not carried: the composer caps a
                   paragraph at two gathered clauses, so an item can be chosen,
                   logged and shown here without reaching a coach. Said out loud
                   rather than left to imply guaranteed email copy. */
                note={ev.displayed === false ? 'Recorded, but a default approach would not carry it' : null}
              />
            ))}
          </div>
        )}
      </CardSection>

      {otherAvailable.length > 0 && (
        <CardSection title="Other available evidence">
          <div className="divide-y divide-border/40 border-l-2 border-border/60 pl-2">
            {preview.map((ev) => (
              <CardFinding key={ev.kind} ev={ev} muted reason={ev.reason ?? null} />
            ))}
          </div>
          {(hidden > 0 || showOther) && (
            <button
              type="button"
              onClick={() => setShowOther((v) => !v)}
              className="mt-1 text-[11px] text-muted-foreground underline underline-offset-2"
            >
              {showOther
                ? 'Show fewer'
                : `Show ${hidden} more finding${hidden === 1 ? '' : 's'}`}
            </button>
          )}
        </CardSection>
      )}

      {internal.length > 0 && (
        <AdditionalIntelligence
          internal={internal}
          open={showInternal}
          onToggle={() => setShowInternal((v) => !v)}
        />
      )}
    </div>
  );
}

/**
 * Intelligence that helped ranking and is not permitted in an email.
 *
 * Collapsed, unlabelled as evidence, and rendered without a sentence — there is
 * none, by construction: these kinds are `emailEligible: false` in the registry
 * and no copy is ever generated for them. Naming the section "Additional
 * intelligence" rather than "evidence" is the point. An operator who reads
 * "you've added 23 defenders across four intakes" and types it into an email by
 * hand has made a claim the engine deliberately refused to make.
 */
function AdditionalIntelligence({ internal, open, onToggle }) {
  return (
    <div className="border-t border-dashed pt-2">
      <button
        type="button"
        onClick={onToggle}
        className="text-[11px] text-muted-foreground underline underline-offset-2"
      >
        {open ? 'Hide' : 'Show'} {internal.length} additional intelligence finding
        {internal.length === 1 ? '' : 's'}
      </button>
      {open && (
        <div className="mt-1 space-y-0.5">
          <p className="text-[11px] text-muted-foreground/80">
            Used for ranking only — not approved for outreach.
          </p>
          {internal.map((ev) => (
            <p key={ev.kind} className="text-[11px] text-muted-foreground">
              {kindLabel(ev.kind)}
              {ev.confidence ? ` · ${ev.confidence.toLowerCase()} confidence` : ''}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
