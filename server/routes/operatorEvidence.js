/**
 * The operator Evidence surface's own endpoint.
 *
 * ADDITIVE AND SEPARATE from `routes/evidence.js`, deliberately. That route
 * serves the email angle composer: its `wireEvidence` allowlist is nine fields
 * wide, it carries rendered coach-facing sentences, and its guarantee — that no
 * `data` object crosses the wire, so a client has nothing to manufacture a
 * claim from — is asserted by its own tests. This surface needs a different
 * payload for a different job, and sharing a serializer would mean every future
 * change to one had to be reasoned about against the other. A small duplicated
 * boundary is cheaper than that coupling.
 *
 * Nothing here derives, ranks or renders. The read model is already assembled
 * by `operatorEvidenceFor`; this file decides only what crosses HTTP.
 */

/**
 * The COMPOSER's athlete loader, not Philosophy's, and the difference is not
 * cosmetic.
 *
 * `philosophy.js` exports a `loadAthlete` of the same name that selects eight
 * columns for a ladder query. It omits `intended_major`, so `academicFit`
 * returns null and ACADEMIC_FIT is never generated — this surface lost that
 * evidence at every one of 1,166 programmes while every test still passed,
 * because a kind that is never generated looks exactly like a kind that does
 * not apply. Importing the loader the composer already uses is what keeps the
 * two surfaces answering about the same athlete.
 */
import { loadAthlete } from './evidence.js';
import { evidenceFor } from '../lib/evidenceQueries.js';
import { operatorEvidenceFor, SECTION_KEYS } from '../../shared/evidence/operatorEvidence.js';

/**
 * The same cap the composer route applies, for the same reason: a page shows
 * twenty programmes and a request for hundreds is a mistake worth refusing.
 */
export const MAX_COLLEGES = 40;

/** Top-level keys the read model may carry, and what happens to each. */
const MODEL_KEYS = Object.freeze(['programme', 'summary', 'topReasons', 'sections', 'diagnostics']);

/**
 * Summary fields that cross. `generatedCount` deliberately does not.
 *
 * It counts evidence objects built before licensing, so the gap between it and
 * `evidenceCount` says "we withheld some" without saying which or why — a
 * number a surface can only render as an unexplained discrepancy. What was
 * withheld and on what grounds belongs in a Limits section built from real
 * reasons, not inferred from a subtraction.
 */
const SUMMARY_KEYS = Object.freeze([
  'reasonCount', 'hasPositiveReasons', 'openingIdentified',
  'hasEvidence', 'evidenceCount', 'sectionCounts',
]);

/**
 * What a claim rests on, in the fields a surface can explain quality with.
 *
 * `confidenceBeforeFreshness` crosses because it is the only way to say "this
 * would have been HIGH, but the roster we read is old" — the downgrade is
 * operator-facing information, and it arrives with `freshness.reason` beside
 * it. `minConfidence`, `requiresWindow` and `requiresComparison` do not: they
 * are the rules the server applied when deciding whether to build the object at
 * all, and an item that failed them never reaches this payload. Sending a rule
 * that has already been enforced invites a surface to enforce it again.
 */
const QUALIFICATION_KEYS = Object.freeze([
  'tier', 'temporality', 'confidence', 'confidenceBeforeFreshness',
  'freshness', 'season', 'source', 'sourceUrl', 'window', 'comparison',
]);

/** A fact object as it crosses, with its qualification narrowed. */
function wireFacts(item) {
  return {
    kind: item.kind,
    decisionClass: item.decisionClass,
    polarity: item.polarity,
    category: item.category,
    // Already an allowlist per kind, built by operatorFactsFor. Passed through
    // whole: narrowing it again here would mean two files deciding what a kind
    // means, and they would drift.
    facts: item.facts,
    qualification: Object.fromEntries(
      QUALIFICATION_KEYS.map((k) => [k, item.qualification[k] ?? null]),
    ),
  };
}

/**
 * The read model, narrowed to what the operator surface receives.
 *
 * FAILS CLOSED on an unrecognised top-level key. A field added to the read
 * model must be a deliberate decision to publish rather than something that
 * appears on the API because somebody extended an internal object — the same
 * discipline the fact extractor applies to kinds and the section map applies to
 * placement. It throws rather than dropping silently, because a dropped field
 * looks identical to a field nobody added.
 *
 * `diagnostics` is recognised and deliberately NOT serialised — see the note in
 * the Stage E report. It exists for QA and carries the selection vocabulary
 * (CATEGORY_CAP, MAX_REASONS, NEUTRAL_ONLY), which is implementation mechanics
 * rather than something an operator asked about.
 */
export function wireOperatorEvidence(model) {
  const unexpected = Object.keys(model ?? {}).filter((k) => !MODEL_KEYS.includes(k));
  if (unexpected.length) {
    throw new Error(
      `Operator evidence model carries unrecognised field(s): ${unexpected.join(', ')}. `
      + 'Add them to the serializer deliberately or keep them server-side.',
    );
  }

  const sections = Object.fromEntries(
    SECTION_KEYS.map((key) => [key, (model.sections[key] ?? []).map(wireFacts)]),
  );

  return {
    /**
     * The semantic resolution state only, never the `colleges` row behind it.
     * A surface needs to know whether we found the school, not what we hold
     * about it — that is what the sections are for.
     */
    programme: { resolved: model.programme.resolved },
    summary: Object.fromEntries(SUMMARY_KEYS.map((k) => [k, model.summary[k]])),
    topReasons: model.topReasons.map((reason) => ({
      primary: wireFacts(reason.primary),
      // Never folded into the primary. Three roster items can belong to one
      // story and still count different populations over different windows.
      supporting: reason.supporting.map(wireFacts),
      decisionClass: reason.decisionClass,
      category: reason.category,
      dedupeGroup: reason.dedupeGroup,
      section: reason.section,
    })),
    sections,
  };
}

/**
 * Operator evidence for one athlete across many programmes, keyed by name.
 *
 * Mirrors `evidenceSummaries`: same identity mechanism, same cap, and the same
 * treatment of one bad programme — an `unavailable` entry rather than a failed
 * batch, because a single unreadable roster must not cost the operator the
 * other nineteen. A request-level problem still throws and becomes a 400.
 */
export function operatorEvidenceSummaries({ playerId, collegeNames } = {}) {
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
      out[name] = wireOperatorEvidence(operatorEvidenceFor(
        evidenceFor(athlete, name, { sport }),
      ));
    } catch (err) {
      console.error(`[operator-evidence] ${name}:`, err);
      out[name] = { unavailable: err.message };
    }
  }
  return out;
}
