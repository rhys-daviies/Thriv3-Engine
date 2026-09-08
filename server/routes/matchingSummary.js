/**
 * The recruiting-signal endpoint for the match card.
 *
 * A THIRD SIBLING, not a mode of the other two. `routes/evidence.js` serves
 * the email composer, `routes/operatorEvidence.js` serves the decision page,
 * and this serves a panel that may carry at most a couple of lines. All three
 * take the same identity — athlete in the path, programme names in the body —
 * and none shares a serializer, because sharing one would mean every future
 * change to one had to be reasoned about against three surfaces with three
 * different licences.
 *
 * NO QUALIFICATION LOGIC LIVES HERE. `matchingSummaryFor` decides what a card
 * may carry, and duplicating any part of that decision in the route would give
 * the system two answers to the same question. This file adds a boundary and
 * an athlete lookup, and nothing else.
 */

import { loadAthlete } from './evidence.js';
import { evidenceFor } from '../lib/evidenceQueries.js';
import { matchingSummaryFor, MAX_FACTS } from '../../shared/evidence/matchingSummary.js';

/** The same cap the sibling routes apply, for the same reason. */
export const MAX_COLLEGES = 40;

/** Structural keys the wire may carry, at each level. */
const TOP_KEYS = Object.freeze(['programme', 'facts', 'hasEvidence']);
const PROGRAMME_KEYS = Object.freeze(['resolved']);
const FACT_KEYS = Object.freeze(['kind', 'category', 'facts', 'qualification']);
const QUALIFICATION_KEYS = Object.freeze(['temporality', 'seasons']);

/**
 * Fields that must never appear anywhere in the payload, at any depth.
 *
 * The structural keys above are an allowlist and catch drift at the shape
 * level; this catches it INSIDE `facts`, which is per-kind and cannot be
 * allowlisted generically without restating the projection the read model
 * already owns. Every entry is something that reached a payload once, or came
 * one route away from it: `region` and `arrivals` are how the OCEANIA bucket
 * key would travel, `squadSize` is the figure two kinds disagree about, and
 * the rest are ranking and registry mechanics that belong to no surface.
 */
const FORBIDDEN = Object.freeze([
  'region', 'arrivals', 'squadSize',
  'decisionClass', 'polarity', 'strength', 'dedupeGroup', 'specificity',
  'lead', 'support', 'diagnostics', 'generatedCount', 'evidenceCount',
  'confidence', 'minConfidence', 'requiresWindow', 'requiresComparison',
  'permissions', 'tier', 'data', 'text', 'score', 'breakdown', 'contribution',
  'weight', 'criterion', 'match_score',
]);

/** Every key name in a payload, at any depth. */
function keysAnywhere(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((v) => keysAnywhere(v, out)); return out; }
  for (const [k, v] of Object.entries(node)) { out.add(k); keysAnywhere(v, out); }
  return out;
}

/**
 * The boundary. Asserts rather than rebuilds.
 *
 * `matchingSummaryFor` already returns exactly the public object — it projects
 * facts per kind and narrows qualification itself — so copying it field by
 * field here would add a second place to edit and no protection. What the
 * route owes is a gate that FAILS CLOSED when the read model grows something
 * new: a field added upstream must be a decision to publish it, not something
 * that appears on the API because an internal object changed shape.
 */
export function assertWireSafe(summary) {
  const bad = (what) => { throw new Error(`matching summary payload ${what}`); };

  const top = Object.keys(summary ?? {});
  if (top.length !== TOP_KEYS.length || top.some((k) => !TOP_KEYS.includes(k))) {
    bad(`must carry exactly ${TOP_KEYS.join(', ')} — got ${top.join(', ')}`);
  }
  const programme = Object.keys(summary.programme ?? {});
  if (programme.length !== PROGRAMME_KEYS.length || programme.some((k) => !PROGRAMME_KEYS.includes(k))) {
    bad(`programme must carry only ${PROGRAMME_KEYS.join(', ')} — got ${programme.join(', ')}`);
  }
  if (typeof summary.hasEvidence !== 'boolean') bad('hasEvidence must be a boolean');
  if (!Array.isArray(summary.facts)) bad('facts must be an array');
  if (summary.facts.length > MAX_FACTS) {
    bad(`carries ${summary.facts.length} facts, more than a card may show`);
  }
  /**
   * The one invariant worth restating at the boundary.
   *
   * `hasEvidence` means "has at least one recruiting signal" and NOTHING
   * WIDER. A programme with four development measurements and no licensed
   * pathway signal reports false here, which is correct for a card and would
   * be wrong for the Decision Evidence page. Asserted so the two can never
   * drift into meaning the same thing.
   */
  if (summary.hasEvidence !== (summary.facts.length > 0)) {
    bad('hasEvidence must mean facts.length > 0 on this surface');
  }

  for (const fact of summary.facts) {
    const keys = Object.keys(fact);
    if (keys.length !== FACT_KEYS.length || keys.some((k) => !FACT_KEYS.includes(k))) {
      bad(`fact ${fact.kind} must carry exactly ${FACT_KEYS.join(', ')} — got ${keys.join(', ')}`);
    }
    const q = Object.keys(fact.qualification ?? {});
    if (q.some((k) => !QUALIFICATION_KEYS.includes(k))) {
      bad(`fact ${fact.kind} qualification carries ${q.join(', ')}`);
    }
  }

  const present = keysAnywhere(summary);
  const leaked = FORBIDDEN.filter((k) => present.has(k));
  if (leaked.length) bad(`carries forbidden field(s): ${leaked.join(', ')}`);

  return summary;
}

/**
 * Recruiting signals for one athlete across many programmes, keyed by name.
 *
 * Mirrors its siblings: same cap, same per-programme `unavailable` on a
 * generator failure so one unreadable roster does not cost the operator the
 * other nineteen, and a request-level problem still throws and becomes a 400.
 *
 * The full `evidenceFor` result is handed over, never a ranked or selected
 * subset — those have had the email engine's opinion applied, and the read
 * model refuses them.
 */
export function matchingSummaries({ playerId, collegeNames } = {}) {
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
      out[name] = assertWireSafe(matchingSummaryFor(evidenceFor(athlete, name, { sport })));
    } catch (err) {
      console.error(`[matching-summary] ${name}:`, err);
      out[name] = { unavailable: err.message };
    }
  }
  return out;
}
