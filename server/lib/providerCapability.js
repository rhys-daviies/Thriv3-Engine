import { resolveConfig, googleOAuthConfigured } from './runtimeConfig.js';
import { MAILBOX_PROVIDER } from './connectedMailboxes.js';

/**
 * CAN THIS RUNTIME ACTUALLY SEND THROUGH THIS PROVIDER? — D5.2.
 *
 * ===========================================================================
 * ONE AUTHORITY, THREE QUESTIONS, ASKED IN ORDER — AND THEY ARE NOT THE SAME
 * QUESTION.
 *
 *   implemented   is there an adapter for this provider AT ALL? A property of
 *                 the BUILD. It does not vary by deployment, by environment or
 *                 by time, and it is the only one of the three a database row
 *                 can be judged against durably.
 *   configured    does this deployment hold what the adapter needs — OAuth
 *                 client, redirect origin, mailbox key? A property of the
 *                 ENVIRONMENT.
 *   sendEnabled   has somebody explicitly switched real email on? A deliberate
 *                 human act, and the last thing between this build and a real
 *                 coach's inbox.
 *
 * THE DISTINCTION BETWEEN THE FIRST AND THE LAST IS THE WHOLE POINT OF THIS
 * FILE. `googleTransport.js` existing means Google is IMPLEMENTED. It does not
 * mean Google is enabled, and a capability model that conflated them would
 * announce a send path the moment a file landed in the repository — which is
 * exactly the false signal D5.2 exists to avoid.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * ONE ALLOWLIST, NOT THREE. Before this file the answer lived in two places
 * that could not disagree only because neither was authoritative:
 * `executionReadiness` reported `MAILBOX_PROVIDER_UNSUPPORTED` advisorily, and
 * `executionClaim` had no provider gate at all. Everything now asks here —
 * readiness, the orchestrator's pre-claim check, the claim itself and the
 * transport registry — so a fourth caller cannot invent a fourth opinion.
 * ---------------------------------------------------------------------------
 *
 * IT READS CONFIGURATION AND NOTHING ELSE. No database, no credential, no
 * network, no clock. Safe to call on any path, including one that must not
 * touch a mailbox.
 */

/** Why this provider cannot be used for a real send right now. */
export const PROVIDER_REFUSAL = Object.freeze({
  /**
   * NO ADAPTER EXISTS FOR THIS PROVIDER IN THIS BUILD. Microsoft, or a value
   * that is not a provider at all. Durable: no amount of configuration changes
   * it, so a claim may refuse on it and a screen may say so permanently.
   */
  MAILBOX_PROVIDER_UNSUPPORTED: 'MAILBOX_PROVIDER_UNSUPPORTED',
  /**
   * THE ADAPTER EXISTS AND THIS DEPLOYMENT CANNOT FEED IT. No OAuth client, no
   * app origin to derive a redirect from, or no mailbox key to decrypt a
   * credential with. An operator action, not a code change.
   */
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  /**
   * EVERYTHING IS IN PLACE AND REAL SENDING IS SWITCHED OFF — D5.2's normal
   * state, and the one this slice ships in.
   *
   * It is deliberately NOT `REFUSED_BEFORE_TRANSPORT`: that is a transport
   * OUTCOME, recorded against an execution that was claimed and paid for. This
   * refusal happens before any of that, so there is no execution row, no
   * ledger row and nothing to settle. A configuration answer, not a send
   * result.
   */
  PROVIDER_SEND_DISABLED: 'PROVIDER_SEND_DISABLED',
});

/**
 * THE PROVIDERS THIS BUILD HAS AN ADAPTER FOR.
 *
 * A build-time fact, written out rather than inferred from what happens to be
 * importable: a registry that discovered its members by trying to import them
 * would declare a provider supported because a file exists, which is precisely
 * the thing this module refuses to do.
 */
const IMPLEMENTED = Object.freeze([MAILBOX_PROVIDER.GOOGLE]);

/**
 * @param {string|null} provider  from the durable mailbox row, never a caller.
 * @returns {{provider, implemented, configured, sendEnabled, refusal}}
 *   `refusal` is the FIRST thing standing in the way, or null when a real send
 *   could proceed. Ordered narrowest-cause-first so a caller reports the thing
 *   somebody can act on.
 */
export function providerCapability(provider, config = resolveConfig()) {
  const implemented = IMPLEMENTED.includes(provider);

  /**
   * CONFIGURED MEANS BOTH HALVES. `googleOAuthConfigured` covers the client id,
   * the secret and a derivable redirect URI; the mailbox key is separate and
   * just as necessary — without it a stored credential cannot be decrypted, so
   * a send would fail at the one moment it is most expensive to fail.
   */
  const configured = implemented
    && googleOAuthConfigured(config)
    && Boolean(config.mailboxKey);

  /**
   * AND SENDING IS OFF UNLESS SOMEBODY SAID OTHERWISE, EXPLICITLY.
   *
   * `config.googleSendEnabled` comes from `bool()`, which returns the fallback
   * for an absent or empty value and false for anything that is not `1`,
   * `true`, `yes` or `on`. So a typo, a stray quote, `"FALSE"`, `"0"` and an
   * unset variable all mean the same thing, and the direction they all mean is
   * off.
   *
   * IT IS GATED ON `configured` TOO, so a deployment cannot switch sending on
   * for a provider it has not finished setting up.
   */
  const sendEnabled = configured && config.googleSendEnabled === true;

  let refusal = null;
  if (!implemented) refusal = PROVIDER_REFUSAL.MAILBOX_PROVIDER_UNSUPPORTED;
  else if (!configured) refusal = PROVIDER_REFUSAL.PROVIDER_NOT_CONFIGURED;
  else if (!sendEnabled) refusal = PROVIDER_REFUSAL.PROVIDER_SEND_DISABLED;

  return Object.freeze({
    provider: provider ?? null, implemented, configured, sendEnabled, refusal,
  });
}

/**
 * IS THERE AN ADAPTER FOR THIS PROVIDER AT ALL?
 *
 * Split out because it is the ONLY one of the three that `executionClaim` may
 * safely judge a durable row against — see the note on the claim's provider
 * gate. Configuration and the send switch belong to a deployment and a moment;
 * this belongs to the build.
 */
export const providerImplemented = (provider) => IMPLEMENTED.includes(provider);
