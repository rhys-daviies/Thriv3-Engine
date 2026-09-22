import db from '../db/client.js';
import { activateTokens, isEdgeConfigured } from './edgeSync.js';
import { isPubliclyReachable } from './config.js';

/**
 * A TRACKED LINK MUST WORK BEFORE ANYBODY IS SHOWN THE EMAIL THAT CARRIES IT
 * — R4C.
 *
 * ===========================================================================
 * THE DEFECT THIS EXISTS TO CLOSE.
 *
 * `createOutreach` mints an athlete × coach token in the local database. The
 * edge collector keeps its own allowlist and gates every profile page on it:
 *
 *     SELECT 1 FROM outreach_tokens WHERE token = ? AND revoked = 0
 *     → no row ⇒ verdict 'revoked' ⇒ the neutral "Profile unavailable" page
 *
 * A token the edge has never heard of is indistinguishable there from one
 * that was withdrawn. Nothing pushed a new token automatically:
 * `createOutreach` does not, `sendOutreach` did not, and `publish` does not.
 * The only two paths were the scheduler — off in production, because
 * THRIV3_SYNC_INTERVAL_MINUTES is 0 — and an operator remembering to press
 * "Sync now".
 *
 * So an operator could Prepare, hand the email to their mail app, send it,
 * and the coach's first click would render "Profile unavailable". Not a lost
 * tracking event: a dead profile, on first contact, from a cold approach.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT SOLVED WITH A TIMER.
 *
 * Setting THRIV3_SYNC_INTERVAL_MINUTES to 15 shortens the window; it does not
 * remove it. The operator who prepares and sends inside one interval is
 * exactly the operator who is working quickly, which is every operator on a
 * day they are getting through a list. A guarantee that holds only when
 * somebody is slow is not a guarantee.
 *
 * The scheduled sync remains useful and is untouched — it is how ENGAGEMENT
 * comes back. Readiness of an OUTBOUND link is a different question and is
 * answered here, synchronously, before the email is presented.
 * ---------------------------------------------------------------------------
 *
 * WHY NOT INSIDE `createOutreach`. That function is a persistence primitive:
 * synchronous, transactional, and called from paths that are not about to put
 * a link in front of anybody — the campaign claim, the recommendation
 * composer, back-fills. Making it async and network-dependent would make
 * every one of those fail when Cloudflare hiccups, for a guarantee only the
 * send boundary needs. The boundary that PRESENTS the email is the boundary
 * that must be sure of it, and that is `sendOutreach`.
 */

/** Why a token could not be proved live. Every one is a fact, never a policy. */
export const ACTIVATION_REFUSAL = Object.freeze({
  /** THRIV3_EDGE_URL or THRIV3_SYNC_SECRET is missing on a deployment that needs them. */
  EDGE_NOT_CONFIGURED: 'EDGE_NOT_CONFIGURED',
  /** The edge refused or could not be reached. Transport, not a decision. */
  EDGE_UNREACHABLE: 'EDGE_UNREACHABLE',
  /** The edge accepted the call but did not report the upsert we asked for. */
  NOT_CONFIRMED: 'NOT_CONFIRMED',
  /** The relationship is revoked. Activating it would undo a deliberate act. */
  OUTREACH_REVOKED: 'OUTREACH_REVOKED',
});

/**
 * Whether a link minted on this deployment is one a coach could actually open.
 *
 * ---------------------------------------------------------------------------
 * `isPubliclyReachable()` IS ALREADY THE PRODUCT'S OWN DEFINITION OF THAT.
 * It asks whether THRIV3_PUBLIC_BASE_URL is something other than localhost,
 * and `sitePublisher` already refuses to publish when it is not. A tracked
 * link on a localhost base URL is a development artefact: no coach will ever
 * receive it, no edge is involved, and requiring an edge round trip for one
 * would make every local draft fail on a machine with no secrets.
 *
 * So: a real public base URL means a real link, and a real link must be live
 * at the edge before anybody sees it. That is the production boundary item 3
 * asks for, expressed in a predicate this codebase already trusts elsewhere
 * rather than in a new NODE_ENV check.
 * ---------------------------------------------------------------------------
 */
export function activationRequired() {
  return isPubliclyReachable();
}

const OUTREACH_ROW = db.prepare('SELECT id, token, revoked_at FROM outreach WHERE id = ?');

/**
 * Proves one relationship's tracking token is live at the edge.
 *
 * @returns {{ok: boolean, reason: string|null, required: boolean, synced?: number}}
 *   `ok: true` means the caller may present the email. It NEVER throws: a
 *   refusal is a fact the caller reports to an operator, and an exception here
 *   would abort a whole run over one coach's link.
 */
export async function ensureTokenLive(outreachId) {
  const row = OUTREACH_ROW.get(outreachId);
  if (!row) return { ok: false, reason: ACTIVATION_REFUSAL.NOT_CONFIRMED, required: true };

  /**
   * A REVOKED LINK IS NEVER MADE LIVE HERE, whatever else is true.
   *
   * `sendOutreach` skips a revoked relationship before it reaches this, so
   * this is the second lock rather than the first. It matters because the
   * edge call is an UPSERT: sending `revoked: 0` for a withdrawn link would
   * silently resurrect a page an athlete asked to be taken down, and the
   * local database would still say revoked. The two must never disagree in
   * that direction.
   */
  if (row.revoked_at) {
    return { ok: false, reason: ACTIVATION_REFUSAL.OUTREACH_REVOKED, required: true };
  }

  // Development, where no coach will ever see this link. Nothing to prove.
  if (!activationRequired()) return { ok: true, reason: null, required: false };

  if (!isEdgeConfigured()) {
    return { ok: false, reason: ACTIVATION_REFUSAL.EDGE_NOT_CONFIGURED, required: true };
  }

  try {
    const result = await activateTokens([{ token: row.token, revoked: 0 }]);
    /**
     * CONFIRMED, NOT ASSUMED. `synced` is how many upserts the edge actually
     * ran; a 2xx with nothing synced is the shape the 2026-08-20 wipe took —
     * a call that looked fine and landed nowhere. One token in, one upsert
     * out, or this is not a success.
     */
    if (result.synced >= 1) {
      return { ok: true, reason: null, required: true, synced: result.synced };
    }
    return { ok: false, reason: ACTIVATION_REFUSAL.NOT_CONFIRMED, required: true };
  } catch {
    // Deliberately not logged with the error body: it can carry the sync
    // secret's rejection detail. The reason code is what the operator needs.
    return { ok: false, reason: ACTIVATION_REFUSAL.EDGE_UNREACHABLE, required: true };
  }
}
