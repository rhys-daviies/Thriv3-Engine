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
  const chosen = selection ?? selected.map((e) => e.kind);
  const chosenSet = new Set(chosen);
  const byKind = new Map([
    ...available.map((e) => [e.kind, e]),
    ...otherKnown.filter((e) => e.text).map((e) => [e.kind, e]),
    ...selected.map((e) => [e.kind, e]),
  ]);
  const slotByKind = new Map(selected.map((e) => [e.kind, e.slot]));
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
