import { useCallback, useEffect, useRef, useState } from 'react';
import { matchmaking } from '@/api/client';
import { runView } from '@/lib/matchmakingV2View';

/**
 * THE ONE PLACE THAT KNOWS WHAT THE MATCHMAKING V2 BACKEND RETURNS — §U.
 *
 * Components take `run` (a view model) and `status`. None of them imports the
 * api client, branches on an HTTP status, or reads a field off a response.
 *
 * ===========================================================================
 * PERSISTED FIRST. THIS HOOK NEVER RECOMPUTES ON ITS OWN.
 *
 * Mounting reads the latest PERSISTED run and stops. It does not generate when
 * there is none, and it does not refresh when the one it finds is stale —
 * both are explicit operator acts, and that is the whole product decision
 * behind A9.3.
 *
 * The reason is not caching. A9.2 made runs IMMUTABLE so that what Thriv3 told
 * a consultant on Tuesday is still readable on Friday; a screen that silently
 * recomputed on load would leave that record intact and quietly stop showing
 * it, which is the same outcome as not having it. Rankings would also move
 * under a consultant mid-conversation — the corpus changed 1,042 cells during
 * A9.2 alone, from one routine 7B promotion.
 * ===========================================================================
 */

export const MM2 = Object.freeze({
  /** Reading the persisted run. Nothing to show yet. */
  LOADING: 'LOADING',
  /** A run is loaded and on screen. */
  READY: 'READY',
  /** The read succeeded and this athlete has never been matched. */
  NO_RUN: 'NO_RUN',
  /** The read itself failed. `error` says how. */
  FAILED: 'FAILED',
});

/** What is happening ON TOP of what is displayed. Never clears `run`. */
export const MM2_BUSY = Object.freeze({
  GENERATING: 'GENERATING',
  REFRESHING: 'REFRESHING',
});

/**
 * Every failure this screen can show, kept apart — §P.
 *
 * Collapsing these would be the specific mistake the brief names. A 409 is an
 * athlete whose family contribution is unanswered and is fixed on the profile;
 * a 422 is an incomplete profile; a 500 is ours; a dropped connection is
 * nobody's and is worth retrying immediately. One spinner and one "Something
 * went wrong" turns four different next actions into none.
 */
export const MM2_ERROR = Object.freeze({
  CONTRIBUTION_UNRESOLVED: 'CONTRIBUTION_UNRESOLVED',
  PLAYER_NOT_FOUND: 'PLAYER_NOT_FOUND',
  PROFILE_INVALID: 'PROFILE_INVALID',
  SIGNED_OUT: 'SIGNED_OUT',
  SERVER: 'SERVER',
  NETWORK: 'NETWORK',
});

/**
 * An exception, classified.
 *
 * Branches on the server's own `code` BEFORE the status, because the codes are
 * the stable contract (`STATUS_BY_CODE` in server/routes/matchmaking.js) and
 * several share a status: PLAYER_NOT_FOUND and RUN_NOT_FOUND are both 404s,
 * and four different 422s mean four different things to the operator.
 *
 * A network failure is the one case with NO status at all: `fetch` rejects
 * before a response exists, so `err.status` is undefined and `err.code` is
 * absent. That is checked last rather than first, so a genuine server error
 * that happens to carry no code is reported as a server error — claiming the
 * operator's connection dropped when it did not sends them to the wrong place.
 */
export function classifyError(err) {
  if (err?.signedOut) return { kind: MM2_ERROR.SIGNED_OUT, code: null, message: err.message };
  const code = err?.code ?? null;
  if (code === 'CONTRIBUTION_UNRESOLVED') {
    return { kind: MM2_ERROR.CONTRIBUTION_UNRESOLVED, code, message: err.message };
  }
  if (code === 'PLAYER_NOT_FOUND') {
    return { kind: MM2_ERROR.PLAYER_NOT_FOUND, code, message: err.message };
  }
  if (err?.status === 422 || code === 'CONTRIBUTION_INVALID') {
    return { kind: MM2_ERROR.PROFILE_INVALID, code, message: err.message };
  }
  if (Number.isFinite(err?.status)) {
    return { kind: MM2_ERROR.SERVER, code, message: err.message };
  }
  return { kind: MM2_ERROR.NETWORK, code: null, message: err?.message ?? null };
}

export function useMatchmakingV2(playerId) {
  const [run, setRun] = useState(null);
  const [status, setStatus] = useState(MM2.LOADING);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  /**
   * A LATE RESPONSE MUST NOT LAND ON ANOTHER ATHLETE'S SCREEN.
   *
   * Reading the current run takes a few milliseconds and generating one takes
   * seconds, so an operator who starts a generation and navigates to a second
   * athlete can be looking at that athlete when the first POST returns. The
   * token is compared on arrival; a response from a previous player id is
   * dropped, not merged. The same `cancelled` flag in the load effect handles
   * unmounting.
   */
  const token = useRef(0);

  const load = useCallback(async () => {
    if (!playerId) {
      setRun(null); setStatus(MM2.LOADING); setError(null);
      return;
    }
    const mine = (token.current += 1);
    setStatus(MM2.LOADING);
    setError(null);
    try {
      const payload = await matchmaking.currentRun(playerId);
      if (mine !== token.current) return;
      if (!payload) { setRun(null); setStatus(MM2.NO_RUN); return; }
      setRun(runView(payload));
      setStatus(MM2.READY);
    } catch (err) {
      if (mine !== token.current) return;
      setRun(null);
      setError(classifyError(err));
      setStatus(MM2.FAILED);
    }
  }, [playerId]);

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await load(); })();
    return () => { cancelled = true; };
  }, [load]);

  /**
   * Compute and persist a NEW run, then show it.
   *
   * ===========================================================================
   * THE RESULTS ALREADY ON SCREEN STAY ON SCREEN — §P.
   *
   * `run` is not cleared and `status` does not go back to LOADING. A refresh
   * takes seconds against a cold pool context, and blanking a list of ranked
   * programmes for that long — then restoring a nearly identical one — reads
   * as a page that broke and recovered. The old run is still a true record
   * until the new one exists, so it keeps the screen and `busy` says what is
   * happening over it.
   *
   * A FAILED refresh is the case that makes this matter: a 409 or a dropped
   * connection must leave the consultant exactly where they were, with an
   * explanation, rather than destroying a run the server still holds.
   * ===========================================================================
   */
  const create = useCallback(async (mode) => {
    if (!playerId) return false;
    const mine = (token.current += 1);
    setBusy(mode);
    setError(null);
    try {
      const payload = await matchmaking.generate(playerId);
      if (mine !== token.current) return false;
      /**
       * The POST body is the LIVE result plus its new `runId`, and it carries
       * no `staleness` because nothing has compared it to anything. It is
       * current BY CONSTRUCTION: `persistRun` stored the engine freeze, the
       * corpus digest and the input snapshot that this very computation used,
       * which are the three things `runStaleness` compares. Saying so here
       * costs no request; the next load asks the server properly.
       */
      setRun(runView(payload, { staleness: { current: true, reasons: [] } }));
      setStatus(MM2.READY);
      return true;
    } catch (err) {
      if (mine !== token.current) return false;
      setError(classifyError(err));
      /** Status is untouched: a failed generation does not unmake a loaded run. */
      return false;
    } finally {
      if (mine === token.current) setBusy(null);
    }
  }, [playerId]);

  const generate = useCallback(() => create(MM2_BUSY.GENERATING), [create]);
  const refresh = useCallback(() => create(MM2_BUSY.REFRESHING), [create]);

  return {
    run,
    status,
    busy,
    error,
    generate,
    refresh,
    reload: load,
    dismissError: useCallback(() => setError(null), []),
  };
}
