/**
 * Email evidence for the browser composer.
 *
 * The engine is server-side because the evidence that matters most needs five
 * seasons of roster rows — 276,000 of them — and the client loads one season.
 * Rather than ship the data to the browser, the browser asks what we know.
 *
 * Deliberately the ONLY way the client obtains evidence, and it never accepts
 * facts from the client. The composer holds the departure numbers already, and
 * posting them would be one line shorter; it would also mean the sentences in
 * a coach's inbox came from whatever a stale tab happened to be holding. The
 * server recomputes them from `roster_players` using the matching engine's own
 * `departures()`, so the email and the match card cannot disagree.
 *
 * What crosses the wire is rendered prose plus flat metadata — never the
 * evidence objects themselves. The client therefore has no renderer, and so
 * has no way to state a SIGNAL as a fact.
 */
import db from '../db/client.js';
import { evidenceFor } from '../lib/evidenceQueries.js';
import { usedEvidenceForCoaches, EVIDENCE_USE } from '../lib/evidenceHistory.js';
import { identityOf } from '../../shared/evidence/sequenceStrategy.js';
import {
  renderEvidence, kindLabel, FLOWS, FAMILY_LABELS, MAX_EMAIL_EVIDENCE, outreachPermitted,
} from '../../shared/evidence/index.js';
import { outreachCopyFor } from '../../shared/evidence/outreachCopy.js';

/**
 * Outbound outcomes that belong in "what we knew and could not use".
 *
 * NOT `DEDUPED` — a dedupe loser is licensed, qualified and swappable, and
 * belongs in the offer list. NOT `NOT_LICENSED` or `DENIED` — those are the
 * internal kinds, which have no rendered sentence and are reported separately
 * so they cannot be offered. In send order of severity, so the drawer reads
 * from nearest-miss to furthest.
 */
const OTHER_KNOWN = Object.freeze(['OVER_CAP', 'UNQUALIFIED', 'BELOW_CONFIDENCE']);

/** The athlete's first name, for the one clause that needs it. Never a pronoun. */
const firstNameOf = (name) => String(name ?? '').trim().split(/\s+/)[0] || null;

const selectPlayer = db.prepare(`
  SELECT id, full_name, position, secondary_position, nationality, intended_major,
         recruiting_class_year, graduation_year, sport
  FROM players WHERE id = ?
`);

/** How many programmes one request may ask about. */
export const MAX_COLLEGES = 40;

export function loadAthlete(playerId) {
  const p = selectPlayer.get(playerId);
  if (!p) throw new Error(`Unknown player: ${playerId}`);
  return p;
}

/**
 * The wire shape.
 *
 * `paragraph` is what the email actually says. Everything beside it is there
 * so the composer can show an operator WHY it says that — which is the whole
 * argument for a system like this over a mail merge, and useless if the
 * operator cannot see it before pressing send.
 *
 * `suppressed` and `rejected` are included for the same reason: "we also knew
 * this and dropped it as redundant" is the difference between a considered
 * choice and an arbitrary one.
 */
/**
 * The wire form of one piece of evidence.
 *
 * Carries the SERVER-RENDERED sentence and no `data`. That is what lets the
 * composer offer the operator a different angle without ever gaining a
 * renderer: it can show and reorder sentences the server wrote, and it has
 * nothing from which to manufacture one. A SIGNAL arrives already hedged and
 * stays hedged whatever the client does with it.
 */
const wireEvidence = (ev, text) => ({
  kind: ev.kind,
  tier: ev.tier,
  category: ev.category,
  confidence: ev.confidence,
  strength: ev.strength,
  season: ev.season,
  source: ev.source,
  // Only where it changed something. A timestamp beside every current item
  // would be noise on the 99% of programmes whose roster was read this week.
  downgraded: ev.confidenceBeforeFreshness && ev.confidenceBeforeFreshness !== ev.confidence
    ? { from: ev.confidenceBeforeFreshness, reason: ev.freshness?.reason ?? null }
    : null,
  text,
});


/* -------------------------------------------------------------------------- */
/*  PRIOR EVIDENCE USE - F9e                                                  */
/* -------------------------------------------------------------------------- */

/** As many coaches as a composer could plausibly select at one programme. */
export const MAX_COACHES = 40;

/**
 * WHAT THESE COACHES HAVE ALREADY BEEN TOLD, INDEXED BY CONNECTION.
 *
 * ===========================================================================
 * IT ANNOTATES; IT DECIDES NOTHING.
 *
 * Nothing below reaches selection, ordering, structure, licensing or
 * `operatorSelected`. Given the same evidence inputs the offer is identical
 * with and without `coachIds`; the only difference is a `previouslyUsed`
 * marker beside findings that are in the response either way. That invariant
 * is the point of the feature and is pinned by tests.
 * ===========================================================================
 *
 * KEYED ON THE DEDUPE GROUP, because that is the thing a coach experiences.
 * The kind is what `rendered_kinds` stores; the group is what makes "you have
 * a New Zealander now" and "you have had New Zealanders before" one connection
 * rather than two. `identityOf` is the registry's own answer, imported rather
 * than re-derived.
 *
 * CONFIRMED OUTRANKS OPEN where a connection is both. They are different
 * facts - one a person said went, one is a body in a window - and the stronger
 * is the one worth saying. The open-draft entry is not lost: it is simply not
 * what this marker reports when a confirmed use exists.
 */
function historyIndex({ athleteId, coachIds }) {
  const { confirmed, open } = usedEvidenceForCoaches({ athleteId, coachIds });

  const byKey = new Map();
  const add = (entry) => {
    // A kind whose group the registry does not know falls back to the kind
    // itself, so an unrecognised one still matches itself and never matches
    // something else.
    const key = entry.group ?? entry.kind;
    if (!key) return;
    const found = byKey.get(key) ?? {
      source: null, coaches: new Set(), origins: new Set(), at: null,
    };
    const stronger = entry.source === EVIDENCE_USE.CONFIRMED
      && found.source !== EVIDENCE_USE.CONFIRMED;
    if (found.source === null || stronger) {
      // Switching to the stronger fact restarts its own tallies: a coach
      // counted for an open draft is not a coach this was confirmed to.
      found.source = entry.source;
      found.coaches = new Set();
      found.origins = new Set();
      found.at = null;
    }
    if (entry.source !== found.source) return;
    found.coaches.add(entry.coachId);
    found.origins.add(entry.origin ?? null);
    // The most recent, so "when did we last put this to them" is answerable.
    if (!found.at || (entry.at && entry.at > found.at)) found.at = entry.at ?? found.at;
    byKey.set(key, found);
  };

  for (const entry of open) add(entry);
  for (const entry of confirmed) add(entry);

  return byKey;
}

/**
 * The marker for one finding, or null.
 *
 * NULL IS THE COMMON ANSWER AND IS NOT A CLAIM. A finding with no marker is
 * one this index has nothing about - which, when the history read failed,
 * means nothing at all. That is why `history.status` is carried separately:
 * a surface must be able to tell "never used" from "we could not check".
 *
 * NOTHING IS LEAKED. This is called only for findings ALREADY in the
 * response, so a historical kind the current licence denies cannot appear:
 * there is no finding for it to annotate.
 */
function markerFor(index, kind) {
  if (!index) return null;
  let group = null;
  try { group = identityOf(kind); } catch { group = null; }
  const found = index.get(group ?? kind);
  if (!found) return null;
  return {
    source: found.source,
    /**
     * HOW MANY OF THE SELECTED COACHES, never which. The composer holds coach
     * identity and this payload deliberately does not add a second source of
     * it - a count is all the wording needs and all it may honestly carry.
     */
    coachCount: found.coaches.size,
    /** Named where recorded, null where it never was. Never guessed. */
    origins: [...found.origins],
    at: found.at,
  };
}

export function toWire(result, historyIdx = null) {
  const selectedKinds = new Set(result.selected.map((ev) => ev.kind));
  const roles = result.roles ?? { hooks: [], relevance: [], recognition: [], alternatives: [] };
  const roleItems = [...roles.hooks, ...roles.relevance, ...roles.recognition];
  const byKind = new Map((result.all ?? []).map((ev) => [ev.kind, ev]));
  const placement = result.composition?.placement ?? [];
  const slotOf = new Map(placement.map((p) => [p.kind, p.slot]));
  const displayedOf = new Map(placement.map((p) => [p.kind, p.displayed !== false]));
  const textOf = new Map((result.sentences ?? []).map((x) => [x.kind, x.text]));
  const dispositionOf = new Map((result.dispositions ?? []).map((d) => [d.kind, d]));

  /**
   * Why an item is not in the email, in the operator's words.
   *
   * Taken from the OUTBOUND selection rather than recomputed, so the panel and
   * the log cannot describe the same decision differently. An item with no
   * entry is simply available — a reason would be an invention.
   *
   * These used to come from the legacy selector's log, which decides nothing
   * outbound: at five programmes it had picked the other congratulation, so
   * the wire marked the claim being SENT as suppressed and the one being
   * offered as selected. Both statements were about a different email.
   */
  const reasonFor = (kind) => dispositionOf.get(kind)?.reason ?? null;

  return {
    paragraph: result.paragraph,
    structure: result.structure.key,
    structureLabel: result.structure.label,
    structureSource: result.structure.source,
    structureRefused: result.structure.refusedRequest,
    // Every shape this pairing's evidence can honestly carry, with its label,
    // so the composer offers a choice between real options rather than a menu
    // of five where four would be refused.
    structureOptions: result.structure.eligible.map((key) => ({
      key, label: FLOWS[key]?.label ?? key,
    })),
    structureEligible: result.structure.eligible,
    maxEvidence: MAX_EMAIL_EVIDENCE,
    programme: result.programme,
    /**
     * The assembled template and its filled evidence slots.
     *
     * The composer needs this to show the operator the email that will
     * actually be sent. It carries the block fragments (tokens and prose the
     * repository already holds) plus, per slot, the paragraph the SERVER
     * rendered — never an evidence object and never a `data` field, so the
     * client still has nothing from which to manufacture a claim.
     *
     * Omitting it was a live bug rather than a design choice: the browser fell
     * back to the athlete's saved template, so every draft was the same shape
     * while the panel above it named a structure that had changed nothing.
     */
    composition: result.composition,
    operatorSelected: result.operatorSelected,
    engineSelected: result.engineSelected,
    unavailableRequests: result.unavailableRequests,
    selected: result.selected.map((ev, i) => ({
      // Looked up BY KIND rather than by index. `sentences` now carries only
      // the claims the email actually displays — the composer caps a paragraph
      // at two gathered clauses — so an index would pair the wrong sentence
      // with the wrong evidence the moment anything is held back.
      ...wireEvidence(ev, textOf.get(ev.kind) ?? null),
      // F9e - annotation only. Null, and absent from the object's meaning,
      // whenever no coachIds were supplied.
      previouslyUsed: markerFor(historyIdx, ev.kind),
      order: i,
      // Which paragraph of the email this claim lands in. The panel shows it
      // so an operator reordering evidence can see that they are moving a
      // sentence between paragraphs, not just up a list.
      slot: slotOf.get(ev.kind) ?? null,
      // Selected and worth recording, but not carried by this email. Said out
      // loud so the panel does not imply the coach read it.
      displayed: displayedOf.get(ev.kind) ?? false,
    })),
    /**
     * Every angle the operator may actually choose, with the sentence the
     * email would carry if they did.
     *
     * SURVIVORS PLUS SAME-CONNECTION ALTERNATIVES, and nothing else. It used
     * to be `result.ranked` — the legacy engine's ranking, filtered only by
     * permission — which listed two things the send path would refuse: kinds
     * that fail their qualification, and dedupe losers that `applyPrefer` had
     * no way to honour. Fifteen real POSTSEASON_RESULT swaps were offerable
     * and unreachable.
     *
     * The text comes from the OUTBOUND copy for the same reason. Rendering
     * through `renderEvidence` showed the operator the legacy sentence — "so I
     * thought you might be open to another Kiwi" — for a claim the email would
     * state as a bare observation. A preview that disagrees with the send is
     * the failure this whole surface is built to prevent.
     */
    available: [...roleItems, ...(result.roles?.alternatives ?? [])].map((item) => {
      const ev = byKind.get(item.kind);
      const copy = outreachCopyFor(item, { firstName: firstNameOf(result.athlete?.name) });
      return {
        ...wireEvidence(ev ?? { kind: item.kind }, copy?.clause ?? copy?.recognition ?? null),
        previouslyUsed: markerFor(historyIdx, item.kind),
        role: item.role,
        selected: selectedKinds.has(item.kind),
        disposition: dispositionOf.get(item.kind)?.disposition ?? null,
        reason: reasonFor(item.kind),
        // The claim this one would replace, when it is an alternative. From
        // the selector's own note where it has one, so the wire agrees with
        // itself after an operator swap rewrites who superseded whom.
        supersedes: dispositionOf.get(item.kind)?.supersededBy ?? item.supersededBy ?? null,
      };
    }),
    /**
     * Licensed claims the outbound selector could not use, with its reason.
     *
     * Shown rather than hidden: "we knew this and could not say it" is the
     * difference between a considered choice and an arbitrary one.
     *
     * WHAT CHANGED IN H6. This was the legacy selector's `suppressed` and
     * `belowThreshold` lists, which on live data held exactly the 865
     * dedupe losers that `available` was already offering — so the panel put
     * them in a collapsed "suppressed or below-threshold" drawer with legacy
     * wording, and "Other strong options" held the 15 the legacy engine had
     * happened to pick, with no reason at all. Two lists, drawn by an engine
     * that decides nothing outbound, and the wrong way round: the drawer held
     * the swappable claims and the offer list held the leftovers.
     *
     * Now it holds what the OUTBOUND selector could not use — a claim below
     * its confidence floor, one that cannot state what it needs, one past the
     * cap. A dedupe loser is not here: it is offerable, it is in `available`,
     * and calling it suppressed was the error.
     */
    otherKnown: OTHER_KNOWN.flatMap((disposition) => (result.dispositions ?? [])
      .filter((d) => d.disposition === disposition)).map((entry) => {
      const ev = byKind.get(entry.kind) ?? null;
      return {
        kind: entry.kind,
        label: kindLabel(entry.kind),
        family: ev ? (FAMILY_LABELS[ev.category] ?? ev.category) : null,
        disposition: entry.disposition,
        reason: entry.reason ?? null,
        // Rendered so it can be swapped in and previewed. Still through the
        // tier-appropriate renderer — a suppressed SIGNAL arrives hedged.
        //
        // Gated on the OUTREACH permission rather than the legacy flag, for
        // the same reason selection is: this decides whether an operator is
        // OFFERED a sentence, and offering one the send path would then refuse
        // is a worse failure than not offering it. `suppressed` and
        // `belowThreshold` only ever hold emailable items today, so nothing
        // here changes; the gate now says why.
        text: ev && outreachPermitted(ev) ? renderEvidence(ev) : null,
        tier: ev?.tier ?? null,
        confidence: ev?.confidence ?? null,
      };
    }),
    // Intelligence that helped ranking and is not permitted in an email. No
    // sentence is rendered for these — there is none, by construction — so the
    // operator can see what we know without it being offerable.
    internal: result.internal.map((ev) => ({
      kind: ev.kind, tier: ev.tier, confidence: ev.confidence,
      strength: ev.strength, season: ev.season, source: ev.source,
    })),
    // The three `legacy_*` arrays that stood here carried the old selector's
    // parallel account across the wire on every request. H6 named them so they
    // could not be misread; H7 found no reader and stopped sending them.
    // One row per generated kind and how it ended up, which is what the tab
    // groups by. Carries no data — a disposition is a decision about evidence,
    // not evidence — so it adds nothing the client could render from.
    dispositions: result.dispositions,
  };
}

/**
 * Evidence for one athlete across many programmes, keyed by college name.
 *
 * Keyed on name rather than id because that is what the composer holds: a
 * recommendation row travels with `college.name`, and `roster_players` joins
 * on the name too.
 *
 * A programme that throws returns an `unavailable` entry rather than failing
 * the batch. One school with an unreadable roster must not cost the operator
 * the other nineteen.
 */
export function evidenceSummaries({
  playerId, collegeNames, prefer = null, preferStructure = null,
  /**
   * WHO THIS EMAIL IS FOR - F9e. OPTIONAL, and absent means absent.
   *
   * Supplied, the response gains a `previouslyUsed` marker on findings this
   * athlete has already put to one of these coaches, and a `history` block
   * saying whether that could be checked. Omitted, every existing consumer -
   * the Evidence tab, the bulk composer, the drafting CLI - receives exactly
   * the payload it received before, with no new keys at all.
   *
   * The browser may name COACHES. It may never name history: `previousKinds`,
   * `usedKinds` and their relatives are not read here and could not be, which
   * is what keeps a claim about what was said to somebody a server fact.
   */
  coachIds = null,
} = {}) {
  const names = Array.isArray(collegeNames) ? collegeNames.filter(Boolean) : [];
  if (!names.length) throw new Error('collegeNames is required');
  if (names.length > MAX_COLLEGES) {
    throw new Error(`Too many programmes at once: ${names.length} (max ${MAX_COLLEGES})`);
  }
  const athlete = loadAthlete(playerId);
  const sport = athlete.sport || 'mens-soccer';

  /**
   * Coach ids, validated and capped. An unknown id matches no row and
   * fabricates nothing; the query is scoped to THIS athlete, so an id the
   * caller has no business with can only ever return this athlete's own
   * history with that coach.
   */
  const wantedCoaches = Array.isArray(coachIds)
    ? [...new Set(coachIds.filter((id) => typeof id === 'string' && id))]
    : [];
  if (wantedCoaches.length > MAX_COACHES) {
    throw new Error(`Too many coaches at once: ${wantedCoaches.length} (max ${MAX_COACHES})`);
  }

  /**
   * HISTORY MAY FAIL WITHOUT TAKING THE EMAIL WITH IT.
   *
   * The evidence is still correct and still personalised; only the "have we
   * put this to them before" annotation is missing. Failing the request would
   * let a history query block manual drafting, which is the one workflow that
   * has to keep working. So the status is reported and composition continues -
   * and UNKNOWN is not NONE: a surface reads `history.status` rather than the
   * absence of markers.
   */
  let historyIdx = null;
  let history = null;
  if (wantedCoaches.length) {
    try {
      historyIdx = historyIndex({ athleteId: athlete.id, coachIds: wantedCoaches });
      history = { status: 'READY', coachCount: wantedCoaches.length };
    } catch (err) {
      console.error('[evidence/history]', err);
      historyIdx = null;
      history = { status: 'FAILED', coachCount: wantedCoaches.length };
    }
  }

  const out = {};
  for (const name of names) {
    try {
      const wire = toWire(evidenceFor(athlete, name, {
        sport,
        prefer: prefer?.[name] ?? null,
        preferStructure: preferStructure?.[name] ?? null,
      }), historyIdx);
      out[name] = history ? { ...wire, history } : wire;
    } catch (err) {
      console.error(`[evidence] ${name}:`, err);
      out[name] = { unavailable: err.message };
    }
  }
  return out;
}
