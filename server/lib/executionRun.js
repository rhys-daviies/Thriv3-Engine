import { randomUUID } from 'node:crypto';

/**
 * WHICH PROCESS THIS IS — D4.6.
 *
 * One value, minted when this module is first imported and constant until the
 * process exits. `claimSendForExecution` stores it on every message it takes
 * for execution, and that is the whole mechanism behind recovery: a row still
 * SENDING whose `claim_run_id` is not this value was claimed by a process that
 * is no longer running, because a process cannot hold two run ids and this one
 * has never held that one.
 *
 * ---------------------------------------------------------------------------
 * IT IS DELIBERATELY NOT PERSISTED, NOT CONFIGURED AND NOT SHARED.
 *
 *   NOT AN ENVIRONMENT VARIABLE.  A run id read from the environment would be
 *      the SAME across a restart, which is precisely the case recovery has to
 *      tell apart. It would also be the same across two processes started from
 *      one configuration, so two live transports would each believe they owned
 *      the other's claims.
 *   NOT A TABLE.  Nothing needs to be looked up. The question is only ever
 *      "is this string mine", and the answer is a comparison. A `runs` table
 *      would be a second place for process identity to be wrong.
 *   NOT REACHABLE FROM A REQUEST.  No route, no body, no header and no client
 *      names it. A caller that could choose its own run id could claim to be
 *      the process that holds somebody else's in-flight message.
 *
 * RANDOM, NOT A PID OR A TIMESTAMP. Pids are reused within minutes and a
 * restart inside the same second shares a timestamp; either collision makes a
 * dead claim look live, which is the one failure this value exists to prevent.
 * ---------------------------------------------------------------------------
 *
 * IMPORTING THIS RECOVERS NOTHING. The sweep lives in `executionRecovery.js`
 * and is called explicitly by the server's boot. A CLI script that imports this
 * module for its own claims gets an identity and nothing else — see D4.6 §B13.
 *
 * `claim_run_id` holds at most 64 characters with no whitespace; a UUID is 36.
 */
export const RUN_ID = randomUUID();
