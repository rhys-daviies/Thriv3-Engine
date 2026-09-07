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
 * P3 — P2 plus everything Stage J changed about what may be said and how.
 * Stage J moved four things on the bump list, and the audit that found them
 * was J8: the version had stayed at P2 while its own description had stopped
 * being true of the engine.
 *
 *   LICENSING     HISTORICAL_SAME_REGION denied (J3). Nine licensed kinds,
 *                 not ten: 4 ALLOWED, 5 QUALIFIED, 17 DENIED.
 *   QUALIFICATION ARRIVAL_SAME_REGION_POSITION requires a season inside two
 *                 of the squad season (J3).
 *   SELECTION     the hook ladder lost a rung (J3); POSITION_FLOW_HOLD
 *                 withholds POSITION_GRADUATION beside a position-bearing
 *                 arrival (J4).
 *   COPY          a graduating cohort names three or counts (J7); "back in"
 *                 starts a season later (J7); the conference congratulation
 *                 dropped its appended compliment (J7); a congratulation says
 *                 "as well" only when something precedes it (J8).
 *   STRUCTURE     the credentials block stopped repeating the introduction
 *                 (J4); the scaffold stopped carrying evidence of its own (J6).
 *
 * A P2 send and a P3 send are different products. Pooling their reply rates
 * would average two engines, which is the whole reason this field exists.
 *
 * ---------------------------------------------------------------------------
 * P4 — K3C. One bump for the whole remediation package, because it ships as
 * one thing and a version per edit would make this field a changelog instead
 * of a boundary.
 *
 *   LICENSING     recruiting-pattern PRESENCE claims are licensed by the
 *                 observation rather than by sport, so women's soccer may now
 *                 say COACH_ARRIVAL_SAME_COUNTRY, ARRIVAL_SAME_COUNTRY_POSITION
 *                 and ARRIVAL_SAME_REGION_POSITION where the rows support it.
 *                 ABSENCE and PROPORTION are unchanged and still gated:
 *                 `countryAbsence` still refuses on UNVALIDATED coverage, and
 *                 INTERNATIONAL_SHARE and POSITION_INTAKE_HISTORY stay DENIED
 *                 for every sport. Nine licensed kinds still.
 *   COPY          the regional clause names the seasons that ADMITTED it
 *                 rather than the oldest it ever saw; it compresses past three
 *                 countries on the graduation convention; and countries carry
 *                 their definite article.
 *
 * NOT the reason for the bump, and listed so nobody looks for them here: the
 * manifest V1->V2 transition is data comparability, and the saved-template
 * fixture is test coverage. Neither changes what any email says.
 *
 * QUALIFICATION AND SELECTION DID NOT MOVE. `recentSeasons` keeps its exact
 * behaviour, the hook ladder is untouched, and POSITION_FLOW_HOLD is
 * untouched — which is why OUTBOUND_DECISION did not move on the copy half of
 * this package.
 */
export const OUTREACH_POLICY_VERSION = 'P4';

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
  /**
   * P2 is retired and still known. No send may be written under it again, and
   * every row already carrying it stays exactly as it is — a stored version is
   * a record of what produced that email, and rewriting one would make the
   * field useless for the only thing it is for.
   *
   * Today no row carries P2: all 41 historical sends predate it and are
   * LEGACY_UNKNOWN. It is listed because a build that met one must be able to
   * name it rather than treat it as corruption.
   */
  'P2',
  /**
   * P3 is retired from new writes and stays known, on exactly the argument P2
   * is kept on. The 41 historical sends are LEGACY_UNKNOWN and no row carries
   * P3 either, but a build that met one must be able to name it. No historical
   * send is migrated: a stored version records what produced that email.
   */
  'P3',
  OUTREACH_POLICY_VERSION,
]);

/** Whether rows carrying these versions describe the same product. */
export const comparablePolicies = (a, b) => a === b
  && a !== LEGACY_POLICY_VERSION
  && KNOWN_POLICY_VERSIONS.includes(a);
