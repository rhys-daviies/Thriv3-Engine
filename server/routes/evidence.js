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
import {
  renderEvidence, kindLabel, FLOWS, FAMILY_LABELS, MAX_EMAIL_EVIDENCE,
} from '../../shared/evidence/index.js';

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

export function toWire(result) {
  const selectedKinds = new Set(result.selected.map((ev) => ev.kind));
  const placement = result.composition?.placement ?? [];
  const slotOf = new Map(placement.map((p) => [p.kind, p.slot]));
  const displayedOf = new Map(placement.map((p) => [p.kind, p.displayed !== false]));
  const textOf = new Map((result.sentences ?? []).map((x) => [x.kind, x.text]));
  const dispositionOf = new Map((result.dispositions ?? []).map((d) => [d.kind, d]));

  /**
   * Why an item is not in the email, in the operator's words.
   *
   * Taken from the selection rather than recomputed, so the panel and the log
   * cannot describe the same decision differently. An item with no entry is
   * simply available — a reason would be an invention.
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
      order: i,
      // Which paragraph of the email this claim lands in. The panel shows it
      // so an operator reordering evidence can see that they are moving a
      // sentence between paragraphs, not just up a list.
      slot: slotOf.get(ev.kind) ?? null,
      // Selected and worth recording, but not carried by this email. Said out
      // loud so the panel does not imply the coach read it.
      displayed: displayedOf.get(ev.kind) ?? false,
    })),
    // Every email-eligible piece, each with its own rendered sentence, so the
    // operator can preview an alternative angle before choosing it. `selected`
    // marks the engine's own picks within the same list.
    available: result.ranked.map((ev) => ({
      ...wireEvidence(ev, renderEvidence(ev)),
      selected: selectedKinds.has(ev.kind),
      disposition: dispositionOf.get(ev.kind)?.disposition ?? null,
      reason: reasonFor(ev.kind),
    })),
    // Redundant and too-weak evidence, each with its reason and its rendered
    // sentence. Shown rather than hidden: "we knew this and dropped it because
    // it restates the item above" is the difference between a considered
    // choice and an arbitrary one, and an operator who disagrees can still
    // select it — the panel offers it, the engine simply did not pick it.
    otherKnown: [
      ...result.suppressed, ...result.belowThreshold,
    ].map((entry) => {
      const ev = result.usable.find((e) => e.kind === entry.kind);
      return {
        kind: entry.kind,
        label: kindLabel(entry.kind),
        family: ev ? (FAMILY_LABELS[ev.category] ?? ev.category) : null,
        disposition: dispositionOf.get(entry.kind)?.disposition ?? null,
        reason: entry.reason ?? null,
        // Rendered so it can be swapped in and previewed. Still through the
        // tier-appropriate renderer — a suppressed SIGNAL arrives hedged.
        text: ev && ev.emailEligible ? renderEvidence(ev) : null,
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
    suppressed: result.suppressed,
    belowThreshold: result.belowThreshold,
    rejected: result.rejected,
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
} = {}) {
  const names = Array.isArray(collegeNames) ? collegeNames.filter(Boolean) : [];
  if (!names.length) throw new Error('collegeNames is required');
  if (names.length > MAX_COLLEGES) {
    throw new Error(`Too many programmes at once: ${names.length} (max ${MAX_COLLEGES})`);
  }
  const athlete = loadAthlete(playerId);
  const sport = athlete.sport || 'mens-soccer';

  const out = {};
  for (const name of names) {
    try {
      out[name] = toWire(evidenceFor(athlete, name, {
        sport,
        prefer: prefer?.[name] ?? null,
        preferStructure: preferStructure?.[name] ?? null,
      }));
    } catch (err) {
      console.error(`[evidence] ${name}:`, err);
      out[name] = { unavailable: err.message };
    }
  }
  return out;
}
