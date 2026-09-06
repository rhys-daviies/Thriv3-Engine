/**
 * WHICH BEHAVIOURAL POLICY PRODUCED THIS SEND.
 *
 * I1 found fourteen analysable historical sends whose `primary_kind` includes
 * `INTERNATIONAL_ROSTER` and `PROGRAM_MOMENTUM` — kinds that are not licensed
 * for outreach today — and one whose primary was `CONFERENCE_TITLE`, a state
 * H18 proved impossible now. They are a faithful record of a system that no
 * longer exists, and pooling them with future sends would silently average two
 * different products together.
 *
 * Nothing in the data said so. That is what this fixes: every send records the
 * policy that produced it, so an analysis can refuse to compare across a
 * boundary rather than compare across one without knowing.
 *
 * ---------------------------------------------------------------------------
 * NOT A GIT SHA, AND NOT A BUILD NUMBER.
 *
 * A commit identifier changes when a comment is reflowed and does not change
 * when a database re-import moves what emails say. This is a PRODUCT
 * assertion: sends carrying the same version were produced by the same rules
 * about what may be said and how it is chosen, so they may be pooled.
 *
 * BUMP IT when any of these changes:
 *
 *   licensing        which kinds may appear in an email at all
 *   qualification    what an object must carry to be sayable
 *   selection        the hook specificity ladder, role planning, the body cap
 *   dedupe           which claims supersede which
 *   copy semantics   what a sentence asserts — not a typo, an assertion
 *   structure        flow eligibility or block order
 *
 * DO NOT bump it for: performance work, tests, comments, logging, provenance,
 * baselines, or a reworded sentence that makes the same claim. Those do not
 * change what a coach was told, so they do not divide the data.
 *
 * A bump is a deliberate act with a line in the table below. If you are unsure
 * whether a change qualifies, it does: an unnecessary split costs statistical
 * power, and a missed one silently merges two products.
 */

/**
 * The policy in force.
 *
 * P2 — the role-based outbound engine. Ten licensed kinds under four ALLOWED
 * and six QUALIFIED grades; HOOK / RELEVANCE / RECOGNITION roles; the hook
 * specificity ladder; one survivor per dedupe group; the per-kind render
 * contract; RELATIONSHIP_FIRST and PLAYER_FIRST. Established across G4–H17 and
 * fingerprinted by `npm run evidence:baseline`.
 */
export const OUTREACH_POLICY_VERSION = 'P2';

/**
 * Everything sent before P2, and the only value that may be written to a
 * historical row.
 *
 * Deliberately not `P1`. We do not know which of several pre-G4 policies
 * produced any given historical send — the legacy engine ranked by strength
 * and category prior, and its rules moved without anything recording that they
 * had. Naming it as a version would assert a coherence the data does not have,
 * so it says what is true: the policy is unknown.
 */
export const LEGACY_POLICY_VERSION = 'LEGACY_UNKNOWN';

/**
 * The versions this build understands.
 *
 * A row carrying anything else came from a future build, and an analysis that
 * silently included it would be pooling across a boundary it cannot see.
 */
export const KNOWN_POLICY_VERSIONS = Object.freeze([
  LEGACY_POLICY_VERSION,
  OUTREACH_POLICY_VERSION,
]);

/** Whether rows carrying these versions describe the same product. */
export const comparablePolicies = (a, b) => a === b
  && a !== LEGACY_POLICY_VERSION
  && KNOWN_POLICY_VERSIONS.includes(a);
