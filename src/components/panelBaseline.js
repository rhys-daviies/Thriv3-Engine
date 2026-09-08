/**
 * The operator panel's rendered-output baseline.
 *
 * The six older artefacts — outreach QA, email bodies, the composer payload,
 * the evidence reports, matching and Decision Evidence — all measure what
 * LEAVES the building or what the server computed. None of them can see the
 * panel: it renders from the wire, and a change to its JSX moves nothing they
 * hash. H1's fifteen unhonourable swap offers, H2's untested production panel
 * and H5's missing alternative reasons were all invisible to every baseline we
 * had, which is why this one exists.
 *
 * WHAT IS HASHED IS WHAT AN OPERATOR READS. The HTML is reduced to its visible
 * text — tags dropped, entities decoded, whitespace collapsed — so a class
 * rename, a wrapper element or a Tailwind change does not move the hash and a
 * changed sentence does. That is the point: this is a regression artefact for
 * what the panel SAYS, not for how it is built.
 *
 * Fixtures are literal wire objects rather than live data, deliberately. A
 * live panel state depends on which programmes happen to hold which evidence
 * this week; these ten states are the ones the panel has to get right, and
 * several of them (a failed lookup, an alternative with no reason) are rare or
 * absent in live data on any given day.
 *
 * Pinned by panelBaseline.test.js, which prints every state's text when the
 * hash moves — so a deliberate change is re-baselined by reading the diff and
 * pasting the new hash, and an accidental one is a failing test.
 *
 *   npm run panel-baseline    print each state's text and the hash
 */
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import EvidencePanel from './EvidencePanel.jsx';

/** Visible text, in reading order. Markup, entities and spacing are not content. */
export const visibleText = (html) => html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&#8212;/g, '—').replace(/&#8230;/g, '…')
  .replace(/\s+/g, ' ')
  .trim();

const HOOK = {
  kind: 'COACH_ARRIVAL_SAME_COUNTRY', tier: 'FACT', category: 'international',
  confidence: 'HIGH', text: 'you brought Hayden Aish in from New Zealand in 2025',
  order: 0, slot: 'HOOK', displayed: true,
};
const RELEVANCE = {
  kind: 'POSITION_GRADUATION', tier: 'FACT', category: 'roster', confidence: 'HIGH',
  text: 'three defenders are listed to graduate in 2027 — Nahne Paulsen, Simon Libert and Nassim Akki',
  order: 1, slot: 'RELEVANCE', displayed: true,
};
const RECOGNITION = {
  kind: 'CONFERENCE_TITLE', tier: 'FACT', category: 'performance', confidence: 'HIGH',
  text: 'Congrats on winning the ACC last year.', order: 2, slot: 'RECOGNITION', displayed: true,
};
const HELD = {
  kind: 'ACADEMIC_FIT', tier: 'FACT', category: 'academic', confidence: 'HIGH',
  text: 'Rhys is looking to study Exercise Science, and Kinesiology is among the programmes you list',
  order: 3, slot: null, displayed: false,
};

/**
 * An alternative the operator could swap in, with the selector's own reason
 * for not defaulting to it.
 *
 * H6 shapes. Before it, the disposition and reason on this object came from
 * the legacy selector — `SUPPRESSED_REDUNDANT`, "says the same thing as
 * same-country arrival under this coach" — an engine that decides nothing
 * outbound, describing a claim the outbound engine was offering as a swap.
 */
const ALT_WITH_REASON = {
  kind: 'HISTORICAL_SAME_COUNTRY', tier: 'FACT', category: 'international', confidence: 'HIGH',
  role: 'HOOK', text: 'two players from New Zealand have come through the programme since 2022',
  selected: false, disposition: 'DEDUPED',
  reason: 'the same connection as same-country arrival under this coach, said another way',
  supersedes: 'COACH_ARRIVAL_SAME_COUNTRY',
};
/**
 * An alternative with no reason.
 *
 * Live data has none of these since H6 — every one of the 880 alternatives
 * carries the selector's reason. Kept as a DEFENSIVE state: the panel must
 * still be correct if a reason is ever missing, and inventing one on the
 * client is the failure this whole seam produced.
 */
const ALT_NO_REASON = {
  kind: 'POSTSEASON_RESULT', tier: 'FACT', category: 'performance', confidence: 'HIGH',
  role: 'RECOGNITION', text: 'Congrats on the semi-final run last season.',
  selected: false, disposition: 'DEDUPED', reason: null, supersedes: 'CONFERENCE_TITLE',
};
const INTERNAL = [
  { kind: 'POSITION_GROUP_SCARCITY', tier: 'SIGNAL', confidence: 'MEDIUM' },
  { kind: 'TRANSFER_BEHAVIOUR', tier: 'FACT', confidence: 'HIGH' },
];

const wire = (over = {}) => ({
  paragraph: 'I saw you brought Hayden Aish in from New Zealand in 2025.',
  structure: 'RELATIONSHIP_FIRST', structureLabel: 'Relationship first',
  structureSource: 'ENGINE', structureRefused: null,
  structureOptions: [
    { key: 'RELATIONSHIP_FIRST', label: 'Relationship first' },
    { key: 'PLAYER_FIRST', label: 'Player first' },
  ],
  maxEvidence: 4,
  programme: { name: 'Jacksonville', hasSquad: true, hasHistory: true, freshness: null },
  selected: [HOOK], available: [], internal: [], otherKnown: [],
  suppressed: [], belowThreshold: [], rejected: [], dispositions: [],
  ...over,
});

/**
 * The ten states the panel owes an operator a correct answer for.
 *
 * `editable` mirrors the composer, which supplies a change handler; the
 * Evidence tab does not, and shows the same picture without swap controls. Both
 * are hashed, because a control appearing on a read-only surface is exactly the
 * kind of drift a baseline is for.
 */
export const STATES = [
  ['loading', { loading: true }],
  ['failure', { failed: true }],
  ['zeroSafeEvidence', { evidence: wire({ selected: [], paragraph: '' }) }],
  ['hookRendered', { evidence: wire() }],
  ['relevanceRendered', { evidence: wire({ selected: [RELEVANCE], structure: 'PLAYER_FIRST', structureLabel: 'Player first' }) }],
  ['recognitionRendered', { evidence: wire({ selected: [HOOK, RECOGNITION] }) }],
  // The held claim must appear in the list, marked, and NOT in the "In the
  // email" summary — the contradiction H5 found and fixed.
  ['heldEvidence', { evidence: wire({ selected: [HOOK, RELEVANCE, HELD] }) }],
  ['alternativeWithReason', { evidence: wire({ available: [ALT_WITH_REASON] }), onSelectionChange: () => {} }],
  ['alternativeWithoutReason', { evidence: wire({ selected: [HOOK, RECOGNITION], available: [ALT_NO_REASON] }), onSelectionChange: () => {} }],
  // `otherKnown` now holds what the OUTBOUND selector could not use. Live data
  // has none — a dedupe loser is offerable and belongs in the list above — so
  // this is the shape the drawer takes when one does occur.
  ['internalOnly', { evidence: wire({ internal: INTERNAL, otherKnown: [{ kind: 'ACADEMIC_FIT', label: 'Intended major offered', family: 'Academic', disposition: 'UNQUALIFIED', reason: 'cannot state what this claim needs to be safe', text: null, tier: 'FACT', confidence: 'MEDIUM' }] }) }],
];

/** Every state's visible text, in a fixed order. */
export function panelBaseline() {
  return STATES.map(([name, props]) => [name, visibleText(renderToStaticMarkup(createElement(EvidencePanel, props)))]);
}

export const panelBaselineHash = () => createHash('sha256')
  .update(panelBaseline().map(([n, t]) => `${n}\n${t}`).join('\n---\n'))
  .digest('hex')
  .slice(0, 16);

/** Every state's text, formatted for a human reading a diff. */
export const panelBaselineReport = () => panelBaseline()
  .map(([name, text]) => `${name}\n  ${text}`)
  .join('\n\n');
