import {
  EVIDENCE_KINDS, PERMISSION, permissionsFor, kindSpec, kindLabel,
  assertSurfaceRenderable, confidenceAtLeast,
} from './kinds.js';
import { renderInput, hasContract, CONTRACT_KINDS } from './outreachContract.js';

/**
 * What Thriv3 may say to a coach it has never met.
 *
 * THE STRICTEST OF THE FOUR SURFACES, because it is the only one whose output
 * leaves the building. An operator inspecting a claim can weigh it; a coach
 * reading a cold email cannot, and has no way to ask what we meant. So the
 * test is not "is this true" — everything the generators produce is true — but
 * "is this a thing a stranger may say about your programme, in writing, with
 * nothing else on the page to qualify it".
 *
 * Ten kinds of twenty-six pass that test. What is refused is refused for one
 * of three reasons, and none of them is doubt about the fact:
 *
 *   IT SAYS NOTHING ABOUT THIS ATHLETE. "You've got a pretty international
 *   squad already" is true of hundreds of programmes and is the single
 *   most-selected claim the legacy engine makes. It personalises an email
 *   without making it relevant, which is the definition of a mail merge.
 *
 *   IT GRADES THEIR PROGRAMME TO THEIR FACE. "Your defender group looks a
 *   little light from the outside", "your results look like they've been
 *   trending up", "you've been building the program over at least five
 *   seasons". A stranger's assessment of your squad, your season and your
 *   tenure, unasked.
 *
 *   IT IS SUPPORTING DETAIL, NOT A CLAIM. POSITION_GRADUATION_STARTERS renders
 *   as "one of THOSE defenders" — a sentence with a dangling referent unless
 *   the graduation claim it belongs to is beside it. It is a property of that
 *   claim and should one day be owned by it, not selected as though it stood
 *   alone.
 *
 * ---------------------------------------------------------------------------
 * THE CLAIM ENDS AT THE OBSERVATION.
 *
 * The rule this module exists to enforce is that a recruiting observation
 * never becomes an inference about what a coach wants. "You brought Hayden
 * Aish in from New Zealand in 2025" is a record. "So I thought you might be
 * open to another Kiwi" is a guess about a stranger's intentions dressed as a
 * conclusion — and it is what the current renderer says. Past recruiting
 * proves past recruiting: not openness, not preference, not need, not intent.
 *
 * Moving from the observation to the athlete is the EMAIL's job, in its own
 * voice — "I'm reaching out about another New Zealand defender" — and belongs
 * to structure, not to the evidence object. Nothing here may license that
 * bridge, and the copy contract in `SAFE_CLAIM` below forbids it per kind.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE PRODUCTION OUTBOUND SELECTOR. `selectEvidence` calls it, and
 * `selectFrom` — which used to decide this — now serves the operator panel's
 * diagnostics and nothing a coach reads.
 */

/**
 * The three things a claim can be doing in an outbound email.
 *
 *   HOOK        explains why we are writing to THIS coach. May appear before
 *               or around the athlete's introduction, because it stands up
 *               without knowing who the athlete is.
 *   RELEVANCE   a safe fact about the athlete against this programme. Never
 *               opens cold: "you've got three defenders graduating" as a first
 *               line to a stranger reads as a pitch about their weakness.
 *   RECOGNITION a congratulation. Not evidence of anything about the athlete,
 *               and counted as none. Its own sentence wherever it lands, never
 *               gathered into another clause, and placed late — after the
 *               relevance reasoning, where it reads as attention paid rather
 *               than as flattery before an ask.
 *
 * THIS IS THE ONLY PLACE A KIND IS CLASSIFIED. There was a `recognition: true`
 * flag on two registry specs saying the same thing about the same two kinds;
 * `structures.js` read it until H4 removed its last reader, and H5 removed the
 * flag. The copy registry agrees by construction — a RECOGNITION kind returns
 * `{ recognition }` and everything else returns `{ clause }` — and that
 * agreement is asserted rather than assumed.
 */
export const ROLES = Object.freeze({
  HOOK: 'HOOK',
  RELEVANCE: 'RELEVANCE',
  RECOGNITION: 'RECOGNITION',
});

/**
 * Which role each licensed kind plays.
 *
 * The registry and this table are ONE POLICY, asserted as an equality at load:
 * every OUTREACH-licensed kind has a role here, every role here is licensed,
 * and each has a qualification rule and a copy handler. G3 ran with the two
 * deliberately out of step for one commit — the registry granted nineteen
 * while this named ten — because narrowing the registry before the copy
 * existed would have changed live emails. G4 closed that in a single commit
 * and the invariant has been equality since.
 */
const ROLE_OF = Object.freeze({
  // Pathway. One connection, six ways of observing it; the dedupe group keeps
  // exactly one, which is what stops four true sentences from reading as four
  // independent reasons.
  COACH_ARRIVAL_SAME_COUNTRY: ROLES.HOOK,
  ARRIVAL_SAME_COUNTRY_POSITION: ROLES.HOOK,
  HISTORICAL_SAME_COUNTRY: ROLES.HOOK,
  CURRENT_SAME_COUNTRY: ROLES.HOOK,
  ARRIVAL_SAME_REGION_POSITION: ROLES.HOOK,

  POSITION_GRADUATION: ROLES.RELEVANCE,
  ACADEMIC_FIT: ROLES.RELEVANCE,

  CONFERENCE_TITLE: ROLES.RECOGNITION,
  POSTSEASON_RESULT: ROLES.RECOGNITION,
});

/**
 * What each licensed kind must be able to state before it may be sent.
 *
 * FAILING CLOSED IS THE POINT, and it is stricter here than on any other
 * surface: a card that drops a claim shows one fewer line, an email that
 * sends one without its qualification has already arrived.
 *
 * THE RULE ITSELF LIVES IN `outreachContract.js`, with the projection it is
 * stated over and with nothing else. It used to live here, in generator field
 * names, while the copy re-derived its own version in the renamed projection —
 * two lists that had to agree and that nothing kept in step. H17 measured them
 * disagreeing on fourteen of sixteen value cases.
 *
 * What stays here is the POLICY this module owns: which kinds have a role,
 * where each may appear, and that a kind may not be licensed without a
 * contract to satisfy. Whether one object satisfies it is the contract's
 * answer, asked once and used by the copy as well.
 *
 * A STRUCTURAL VALIDITY CHECK IS NOT A QUALIFICATION.
 *
 * The four ALLOWED kinds go through the same contract, and that does not make
 * them QUALIFIED. The distinction is what the requirement is FOR: a QUALIFIED
 * kind's contract decides whether the CLAIM may be made at all without its
 * caveat — a region arrival with no countries cannot be stated safely in any
 * wording. An ALLOWED kind's contract only asks whether the object is
 * well-formed enough to render. The permission grades are unchanged: 4
 * ALLOWED, 6 QUALIFIED, 16 DENIED.
 */

/** Registry declaration order — the tie-break within a role. */
const DECLARATION_ORDER = Object.freeze(Object.keys(EVIDENCE_KINDS));

/**
 * Which hook survives when several observe the same connection.
 *
 * A NAMED LADDER, NOT A SCORE, and it exists because declaration order gets
 * this exactly backwards. All six hooks share one dedupe group, so one
 * survives; ordered by declaration, HISTORICAL_SAME_COUNTRY wins every time
 * and the coach's own recruiting record — the most specific and most checkable
 * thing we can say to the person reading — is suppressed by a weaker
 * statement of the same connection. Measured before this list existed:
 * COACH_ARRIVAL_SAME_COUNTRY survived 0 of 3,498 pairs.
 *
 * The order is SPECIFICITY, which is a property of the claim and not a
 * judgement about its worth:
 *
 *   the coach's own record        addressed to the person reading it
 *   country and position          two axes, one object
 *   a compatriot who came through one axis, past
 *   a compatriot here now         one axis, present
 *   region and position           a wider cut, two axes
 *   the region alone              a wider cut, one axis
 *
 * Deliberately not `baseStrength`, though it agrees with it today. That is the
 * legacy engine's tunable ranking number, and a surface that read it would
 * inherit a ranking policy every time somebody tuned one.
 */
const HOOK_SPECIFICITY = Object.freeze([
  'COACH_ARRIVAL_SAME_COUNTRY',
  'ARRIVAL_SAME_COUNTRY_POSITION',
  'HISTORICAL_SAME_COUNTRY',
  'CURRENT_SAME_COUNTRY',
  'ARRIVAL_SAME_REGION_POSITION',
]);

/** The kinds this surface may carry. */
export const LICENSED_KINDS = Object.freeze(
  DECLARATION_ORDER.filter((k) => ROLE_OF[k]),
);

/**
 * Load-time completeness, in both directions.
 *
 * A kind with a role and no qualification would throw at selection; a kind
 * with a qualification and no role would be silently unreachable and look like
 * a programme that had nothing to say. Both are the kind of mistake that only
 * shows up in a coach's inbox.
 */
for (const kind of LICENSED_KINDS) {
  if (!hasContract(kind)) {
    throw new Error(`${kind} has an outreach role but declares no qualification`);
  }
  if (!EVIDENCE_KINDS[kind]) throw new Error(`${kind} has an outreach role but is not a kind`);
  if (permissionsFor(kind).OUTREACH === PERMISSION.DENIED) {
    throw new Error(`${kind} has an outreach role but the registry denies it`);
  }
}

/**
 * EQUALITY, in both directions. The registry and this module are one policy.
 *
 * Until G4 this was containment only: the registry granted OUTREACH to
 * nineteen kinds while this table named ten, because narrowing the registry
 * would have changed live emails before the copy existed. Both moved in one
 * commit, so the gap is closed and stays closed — a kind licensed in the
 * registry with no role here would be silently unreachable and would look like
 * a programme with nothing to say.
 */
for (const kind of Object.keys(EVIDENCE_KINDS)) {
  const licensed = permissionsFor(kind).OUTREACH !== PERMISSION.DENIED;
  if (licensed !== Boolean(ROLE_OF[kind])) {
    throw new Error(
      `${kind} is ${licensed ? 'licensed for OUTREACH but has no role' : 'given an outreach role but denied by the registry'}`,
    );
  }
}
for (const kind of CONTRACT_KINDS) {
  if (!ROLE_OF[kind]) throw new Error(`${kind} declares an outreach qualification but no role`);
}

/**
 * The copy handler, checked at load with the rest.
 *
 * Four things must exist together for a kind to be sendable: a licence, a
 * role, a qualification rule and words. Three of them were already asserted
 * here; the fourth lived in another module and was only discovered missing by
 * rendering. A kind licensed with no handler would reach composition and
 * produce nothing, which reads as a programme with nothing to say.
 *
 * Imported lazily so the two modules do not form a cycle — `outreachCopy`
 * needs nothing from here, and this needs only the key list.
 */
import('./outreachCopy.js').then(({ OUTREACH_COPY_KINDS }) => {
  for (const kind of LICENSED_KINDS) {
    if (!OUTREACH_COPY_KINDS.includes(kind)) {
      throw new Error(`${kind} is licensed for OUTREACH but has no copy handler`);
    }
  }
  for (const kind of OUTREACH_COPY_KINDS) {
    if (!ROLE_OF[kind]) throw new Error(`${kind} has outreach copy but no role`);
  }
});
// A hook missing from the ladder would sort to -1 and silently outrank the
// coach's own record — the exact failure the ladder was written to fix.
for (const kind of LICENSED_KINDS) {
  const onLadder = HOOK_SPECIFICITY.includes(kind);
  if ((ROLE_OF[kind] === ROLES.HOOK) !== onLadder) {
    throw new Error(`${kind} must be on the hook specificity ladder if and only if it is a HOOK`);
  }
}

/** How many claims about the athlete an email may carry. */
export const MAX_BODY_FACTS = 3;
/** And how many congratulations. */
export const MAX_RECOGNITION = 1;

/**
 * Evidence we hold and may not send: the operator's "internal-only" list.
 *
 * DERIVED FROM THE LICENCE, and from nothing else. It used to come out of
 * `selectFrom` — the legacy selector — which computed it correctly but meant
 * that a surface owning none of this policy ran on every request to produce it.
 *
 * TWO CONDITIONS, AND THE SECOND IS NOT DECORATION.
 *
 *   Not permitted for OUTREACH. That is what "internal" means, and it is a
 *   registry answer, not a ranking one.
 *   Meets its kind's confidence floor. A claim we are not sure enough of is
 *   not something we know and are choosing not to say; it is something we do
 *   not know. Showing it under "internal-only findings" would offer an
 *   operator a finding the system does not stand behind.
 *
 * NOT THE SAME SET AS `NOT_LICENSED` + `DENIED` in the dispositions, and the
 * difference is real: the selector tests the licence FIRST and never reaches
 * the confidence check for an unlicensed kind, so its disposition list holds
 * 1,343 more items across the live corpus — every one of them a kind that is
 * both unlicensed and below its floor. Those belong in neither list.
 *
 * Returns them unordered. WHICH claims are internal is a licence question and
 * belongs here; what order to show them in is a presentation choice and is
 * made where the result is assembled.
 */
export function internalEvidence(all = []) {
  return all.filter((ev) => !outreachLicensed(ev) && meetsFloor(ev));
}

/** Whether this object may appear in an email at all. The registry decides. */
function outreachLicensed(ev) {
  try { return assertSurfaceRenderable(ev, 'OUTREACH') !== PERMISSION.DENIED; }
  catch { return false; }
}

/** Whether the object clears its kind's confidence floor. */
const meetsFloor = (ev) => confidenceAtLeast(ev.confidence, kindSpec(ev.kind).minConfidence);

/**
 * What a cold email may say about one athlete at one programme.
 *
 * @param {object} evidenceResult  an `evidenceFor` / `selectEvidence` result,
 *   WHOLE. `all` is the pre-selection collection; a `selected` or `ranked`
 *   array has already had the legacy engine's strength ordering, category
 *   priors and family caps applied to it, and this surface's whole argument is
 *   that those are the wrong policy for an outbound claim.
 */
export function outreachEvidenceFor(evidenceResult) {
  if (!evidenceResult || !Array.isArray(evidenceResult.all)) {
    throw new Error(
      'outreachEvidenceFor needs an evidenceFor result with its full `all` collection.',
    );
  }

  const eligible = [];
  const dispositions = [];
  const note = (kind, disposition, reason = null, extra = null) => dispositions
    .push({ kind, disposition, reason, ...extra });

  for (const ev of evidenceResult.all) {
    const role = ROLE_OF[ev.kind];
    if (!role) { note(ev.kind, 'NOT_LICENSED', 'not permitted in an outbound email'); continue; }

    /**
     * The registry first, and it may only narrow.
     *
     * DENIED drops the kind whatever its role says. QUALIFIED proceeds to the
     * rule below and is dropped there if it cannot state what it needs — which
     * is what the grade means: renderable only through a path that states its
     * qualification. This module IS that path, which is why QUALIFIED is no
     * longer refused outright the way it was while the path did not exist.
     */
    try { assertSurfaceRenderable(ev, 'OUTREACH'); }
    catch (err) { note(ev.kind, 'DENIED', err.message); continue; }

    /**
     * The kind's own confidence floor, reused deliberately.
     *
     * These are claim-safety floors and not selector tuning: ACADEMIC_FIT sits
     * at HIGH because a subject we are not sure the programme offers is worse
     * than saying nothing, while a roster reading is useful at MEDIUM. They
     * were written for what a sentence may assert, which is exactly this
     * surface's question. Enforced as a floor, never as a rank.
     */
    if (!confidenceAtLeast(ev.confidence, kindSpec(ev.kind).minConfidence)) {
      note(ev.kind, 'BELOW_CONFIDENCE', `below ${kindSpec(ev.kind).minConfidence}`);
      continue;
    }

    /**
     * The contract, asked once. It returns the render input or nothing, so
     * there is no state in which this surface holds a qualified object and the
     * copy holds a different opinion about it.
     */
    const facts = renderInput(ev.kind, ev.data ?? {});
    if (!facts) {
      note(ev.kind, 'UNQUALIFIED', 'cannot state what this claim needs to be safe');
      continue;
    }

    eligible.push({
      kind: ev.kind,
      role,
      facts,
      _group: kindSpec(ev.kind).dedupeGroup,
      // Hooks order by the specificity ladder; everything else by the
      // registry's declaration order.
      _order: role === ROLES.HOOK
        ? HOOK_SPECIFICITY.indexOf(ev.kind)
        : DECLARATION_ORDER.indexOf(ev.kind),
    });
  }

  /**
   * Role, then the order within it. No score of any sort.
   *
   * Not strength, not the category prior, not confidence, not the legacy
   * priority — those rank evidence by how much it is worth saying, and this
   * surface has already decided that with a licence. Within a role the order
   * is a fixed, named list: the specificity ladder for hooks, and the
   * registry's declaration order for the rest. Both are arbitrary but
   * reviewable, which is what a tie-break needs to be.
   */
  const ROLE_ORDER = [ROLES.HOOK, ROLES.RELEVANCE, ROLES.RECOGNITION];
  eligible.sort((a, b) => (ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
    || (a._order - b._order));

  /**
   * One per dedupe group, and it cuts hardest among the hooks.
   *
   * All six pathway kinds share `international-connection`: a coach's arrival
   * from New Zealand, a New Zealand defender recruited, a compatriot on an
   * earlier roster, one on the squad now and two regional cuts are six
   * observations of ONE connection. Sent as several sentences they would read
   * as several independent reasons — the false corroboration this surface
   * exists to prevent — so exactly one survives.
   *
   * No cross-group exclusion table. After this policy the surviving body kinds
   * sit in three groups measuring three different things — a recruiting
   * pathway, a graduating cohort, a subject offering — and none of the roster
   * depth kinds that could have corroborated each other is licensed. An
   * exclusion table here would be machinery guarding nothing.
   */
  const survivor = new Map();
  const hooks = []; const relevance = []; const recognition = [];
  /**
   * The claims that lost their group and could validly have won it.
   *
   * Licensed, qualified, same role, same connection — a different true way of
   * saying the one thing. They are not sent, and they ARE offerable: an
   * operator may prefer one, and `applyPrefer` will swap it for the survivor.
   *
   * Carried explicitly because they used to vanish. A dedupe loser got no
   * disposition at all, so the panel listed it as available while
   * `applyPrefer` refused it — measured at 15 real POSTSEASON_RESULT swaps the
   * operator could ask for and never receive.
   */
  const alternatives = [];
  for (const item of eligible) {
    const held = survivor.get(item._group);
    if (held) {
      note(item.kind, 'DEDUPED', sameConnectionAs(held.kind), { supersededBy: held.kind });
      alternatives.push({
        kind: item.kind, role: item.role, facts: item.facts,
        group: item._group, supersededBy: held.kind,
      });
      continue;
    }
    const bucket = item.role === ROLES.HOOK ? hooks
      : item.role === ROLES.RELEVANCE ? relevance : recognition;
    const bodyFull = item.role !== ROLES.RECOGNITION
      && hooks.length + relevance.length >= MAX_BODY_FACTS;
    if (bodyFull || (item.role === ROLES.RECOGNITION && recognition.length >= MAX_RECOGNITION)) {
      note(item.kind, 'OVER_CAP', 'the email already carries as much as it should');
      continue;
    }
    const chosen = { kind: item.kind, role: item.role, facts: item.facts };
    survivor.set(item._group, { ...chosen, group: item._group });
    bucket.push(chosen);
  }

  return {
    /**
     * Every kind this surface saw, and what became of it — INCLUDING what was
     * sent. The losers were noted from the start; the winners were not, so a
     * caller asking "what happened to this kind" got silence for the one
     * answer that mattered and had to infer it from three other arrays.
     *
     * `server/routes/evidence.js` inferred it from the LEGACY selector's log
     * instead, which is a different engine answering a different question. At
     * five programmes the two disagreed and the panel labelled the claim it
     * was sending as suppressed.
     */
    dispositions: withOutcomes(dispositions, { hooks, relevance, recognition }),
    /**
     * Same-connection claims the operator may swap in. Never sent as they
     * stand — exactly one member of a group ever reaches an email.
     */
    alternatives,
    hooks,
    relevance,
    recognition,
    /**
     * Whether this email says anything about THIS athlete at THIS programme.
     *
     * Hooks and relevance count; recognition does not. Congratulating a
     * programme on its conference title is a courtesy any sender could pay and
     * says nothing about whether the athlete belongs there — counting it would
     * make the personalisation rate a measure of how many programmes won
     * something, and the number exists to answer a different question.
     */
    hasPersonalisation: hooks.length + relevance.length > 0,
  };
}

/**
 * The losers' notes plus the winners', in send order.
 *
 * SELECTED carries an `order` and no reason. A reason answers "why not this
 * one", and the claims in the email do not need one — inventing something for
 * them is how a log starts explaining decisions it did not make.
 */
function withOutcomes(notes, { hooks, relevance, recognition }) {
  const sent = [...hooks, ...relevance, ...recognition];
  const noted = new Set(notes.map((d) => d.kind));
  const selected = sent
    .filter((i) => !noted.has(i.kind))
    .map((i, order) => ({ kind: i.kind, disposition: 'SELECTED', reason: null, role: i.role, order }));
  return Object.freeze([...selected, ...notes]);
}

/**
 * The operator's own ordering, applied to what the licence already permitted.
 *
 * PREFERENCE CHOOSES AMONG THE PERMITTED. It cannot promote a denied kind,
 * cannot bypass a qualification, cannot move a claim between roles and cannot
 * make a congratulation open an email — every one of those is a property of
 * the kind, decided by policy, and an operator reordering sentences has said
 * nothing about any of them. What it CAN do is say which of two licensed hooks
 * leads, or which relevance claim is the one worth carrying.
 *
 * Names only, matched against what survived. Anything unrecognised — a denied
 * kind, a kind that failed its qualification, a typo, a tampered client — is
 * dropped and reported, and the result falls back to the selector's own order
 * rather than to nothing.
 *
 * @param {object} result   an `outreachEvidenceFor` result
 * @param {Array}  prefer   kind names, in the order the operator wants them
 */
export function applyPrefer(result, prefer = null) {
  const wanted = Array.isArray(prefer) ? prefer.filter(Boolean) : [];
  const empty = { ...result, operatorSelected: false, unavailableRequests: [] };
  if (!wanted.length) return empty;

  /**
   * The choices an operator may actually make.
   *
   * Survivors AND the same-connection alternatives that lost their group. All
   * of them are licensed, qualified and carry a role; the only reason an
   * alternative is not being sent is that a sibling won the group, and that is
   * a default rather than a safety boundary. So an operator naming one gets
   * it, and the sibling steps aside — see the note on `alternatives`.
   *
   * What preference still cannot do: restore a denied kind, revive one that
   * failed its qualification, move a claim between roles, or put two members
   * of one group in the same email. The group rule is re-applied below, so a
   * list naming both a survivor and its alternative yields one of them.
   */
  const offerable = new Map(
    [...result.hooks, ...result.relevance, ...result.recognition,
      ...(result.alternatives ?? [])].map((i) => [i.kind, i]),
  );
  const groupOf = new Map((result.alternatives ?? []).map((a) => [a.kind, a.group]));

  const seen = new Set();
  const chosen = [];
  const unavailable = [];
  for (const kind of wanted) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    if (offerable.has(kind)) chosen.push(offerable.get(kind));
    else unavailable.push(kind);
  }
  if (!chosen.length) return { ...empty, unavailableRequests: unavailable };

  /**
   * One per connection, still. An operator who names two members of a group
   * gets the first they named — their ordering is the tie-break, exactly as it
   * is everywhere else in this function.
   */
  const usedGroups = new Set();
  const kept = [];
  for (const item of chosen) {
    const group = groupOf.get(item.kind) ?? groupFor(item.kind);
    if (usedGroups.has(group)) { unavailable.push(item.kind); continue; }
    usedGroups.add(group);
    kept.push(item);
  }

  // Re-bucketed by the kind's OWN role, not by where the operator put it in
  // the list. Order within each bucket is theirs.
  const hooks = kept.filter((i) => i.role === ROLES.HOOK);
  const relevance = kept.filter((i) => i.role === ROLES.RELEVANCE);
  const recognition = kept.filter((i) => i.role === ROLES.RECOGNITION).slice(0, MAX_RECOGNITION);
  return {
    ...result,
    hooks,
    relevance,
    recognition,
    /**
     * The decision state AFTER the operator's choice, not before it.
     *
     * Spreading `result` carried the selector's own notes through untouched,
     * so a swapped-in alternative still read DEDUPED and the claim it replaced
     * still read SELECTED — the panel would have described the email it was no
     * longer sending. The dedupe FACT is unchanged, which is why this is a
     * rewrite of who superseded whom rather than a re-run of the policy.
     */
    dispositions: repointDispositions(result.dispositions ?? [], { hooks, relevance, recognition }),
    hasPersonalisation: kept.some((i) => i.role !== ROLES.RECOGNITION),
    operatorSelected: true,
    unavailableRequests: unavailable,
  };
}

/**
 * The same notes, pointed at the claims that are actually being sent.
 *
 * A kind now sent becomes SELECTED. A kind no longer sent, whose group a
 * sibling now holds, becomes DEDUPED behind that sibling. Everything else —
 * a denied kind, one that failed its qualification, one over the cap — is
 * untouched, because the operator's preference cannot have changed any of it.
 */
function repointDispositions(notes, { hooks, relevance, recognition }) {
  const sent = [...hooks, ...relevance, ...recognition];
  const sentAt = new Map(sent.map((i, order) => [i.kind, { role: i.role, order }]));
  const holder = new Map(sent.map((i) => [groupFor(i.kind), i.kind]));

  const out = notes.map((d) => {
    const at = sentAt.get(d.kind);
    if (at) return { kind: d.kind, disposition: 'SELECTED', reason: null, role: at.role, order: at.order };
    if (d.disposition !== 'SELECTED') return d;
    const winner = holder.get(groupFor(d.kind));
    return winner
      ? {
        kind: d.kind,
        disposition: 'DEDUPED',
        reason: sameConnectionAs(winner),
        supersededBy: winner,
      }
      // Dropped by the operator with nothing taking its place: it was a valid
      // claim and is no longer in the email, which is all we can truthfully say.
      : { kind: d.kind, disposition: 'DESELECTED', reason: 'not part of the order you chose' };
  });
  // Sent first, in send order, as `outreachEvidenceFor` returns them.
  return Object.freeze([...out].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)));
}

/**
 * Why a claim was not the default, in the operator's words.
 *
 * THE REGISTRY'S LABEL, NEVER ITS KEY. This read
 * "the same connection as COACH_ARRIVAL_SAME_COUNTRY, said another way" until
 * the panel baseline printed it and made the leak visible — a constant an
 * operator would have to decode, in the one sentence explaining a decision to
 * them. The panel holds no vocabulary of its own by design, so anything
 * unreadable written here arrives unreadable.
 */
const sameConnectionAs = (kind) => `the same connection as ${kindLabel(kind).toLowerCase()}, said another way`;

/** The dedupe group a licensed kind belongs to. */
const groupFor = (kind) => kindSpec(kind).dedupeGroup;
