import { useCallback, useEffect, useRef, useState } from 'react';
import { athleteProgrammes as api } from '@/api/client';

/**
 * ONE ATHLETE'S PROGRAMME RELATIONSHIPS, AND THE TWO COMMANDS ON THEM.
 *
 * The whole relationship list rather than only the requested ones, because
 * "is Stanford already a specific request" and "does a relationship with
 * Stanford exist at all" are different questions and the search results panel
 * needs both. A hook that fetched only `request_state = 'requested'` would
 * make adding a school that is merely FLAGGED look like a fresh create, and
 * the operator would have no way to see that the row they just changed was
 * already carrying something.
 *
 * ---------------------------------------------------------------------------
 * ADDING IS AN UPSERT AND SO IS SAFE TO REPEAT. The server holds
 * UNIQUE (athlete_id, college_name, sport) and applies a second add to the
 * same row, so a double-click cannot produce two Stanfords. `pending` here is
 * about the button looking honest, not about correctness — the guarantee is in
 * the database, not in this state variable.
 *
 * REMOVING IS A WITHDRAWAL, NEVER A DELETE. The row carries a flag, a note and
 * a contact stance that have nothing to do with the request, and deleting it
 * to "remove a specific school" would silently discard all of them.
 * ---------------------------------------------------------------------------
 *
 * Returns { programmes, specific, loading, failed, pending, error,
 *           byCollegeId, add, withdraw, reload, clearError }.
 */
export function useAthleteProgrammes(playerId) {
  const [programmes, setProgrammes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // The college_id currently being written to, so one row's button can say it
  // is working without disabling the rest of the list.
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  /**
   * Read inside callbacks that are created before `byCollegeId` is computed.
   * A ref rather than a dependency so `flag` does not get a new identity on
   * every relationship change and re-render every card on the page.
   */
  const byCollegeIdRef = useRef(new Map());

  const load = useCallback(async ({ signal } = {}) => {
    if (!playerId) {
      setProgrammes([]);
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      const { programmes: rows } = await api.list(playerId);
      if (signal?.cancelled) return;
      setProgrammes(rows || []);
    } catch {
      if (signal?.cancelled) return;
      // A relationship list that failed to load is EMPTY-LOOKING, and an empty
      // Specific Schools view is indistinguishable from a working one with
      // nothing in it. `failed` is what lets the view say which it is.
      setFailed(true);
      setProgrammes([]);
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }, [playerId]);

  useEffect(() => {
    const signal = { cancelled: false };
    load({ signal });
    return () => { signal.cancelled = true; };
  }, [load]);

  /** Replace one row in place, so a write does not cost a full refetch. */
  const absorb = useCallback((row) => {
    setProgrammes((prev) => {
      const i = prev.findIndex((p) => p.id === row.id);
      if (i === -1) return [...prev, row];
      const next = prev.slice();
      next[i] = row;
      return next;
    });
  }, []);

  /**
   * Record that this athlete has specifically asked for this programme.
   *
   * `requested_by: 'operator'` is the grain this build can honestly record —
   * that a member of staff entered it, NOT which member of staff. There is no
   * operator attribution on these rows yet and inventing one here would be a
   * value nobody observed.
   */
  const add = useCallback(async (college) => {
    if (!playerId || !college?.id) return null;
    setPending(college.id);
    setError(null);
    try {
      const { programme } = await api.upsert(playerId, {
        college_id: college.id,
        request_state: 'requested',
        requested_by: 'operator',
      });
      absorb(programme);
      return programme;
    } catch (err) {
      setError({ message: err.message, code: err.code, collegeId: college.id });
      return null;
    } finally {
      setPending(null);
    }
  }, [playerId, absorb]);

  /**
   * Withdraw the request and leave everything else on the row standing.
   *
   * Only `request_state` is sent. A flagged Stanford that is withdrawn from
   * Specific Schools is still flagged, still carries its note, still carries
   * its contact stance, and still remembers who asked and when — a withdrawn
   * request that forgot it was ever made would be indistinguishable from one
   * that was never made.
   */
  const withdraw = useCallback(async (programme) => {
    if (!playerId || !programme?.id) return null;
    setPending(programme.college_id || programme.id);
    setError(null);
    try {
      const { programme: updated } = await api.update(playerId, programme.id, {
        request_state: 'withdrawn',
      });
      absorb(updated);
      return updated;
    } catch (err) {
      setError({ message: err.message, code: err.code, collegeId: programme.college_id });
      return null;
    } finally {
      setPending(null);
    }
  }, [playerId, absorb]);

  /**
   * Write relationship state, whichever end the caller is holding.
   *
   * A RECOMMENDED SCHOOL USUALLY HAS NO ROW YET. The first flag on it is a
   * create; every change after that is a patch on the row that now exists. The
   * caller should not have to know which — it is holding a match-card entry and
   * a state to set, and the `college_id` route is an upsert that lands on the
   * same row either way.
   *
   * ONLY THE NAMED FIELDS ARE SENT. Setting visibility names `visibility`;
   * flagging names `flagged` and `flag_reason`. Nothing else travels, so a
   * flag cannot move a contact stance and removing a school from the Top 100
   * cannot disturb a specific request.
   */
  const apply = useCallback(async ({ college, relationship }, fields) => {
    if (!playerId) return null;
    const key = relationship?.college_id || college?.id || relationship?.id;
    setPending(key);
    setError(null);
    try {
      const { programme } = relationship?.id
        ? await api.update(playerId, relationship.id, fields)
        : await api.upsert(playerId, { college_id: college?.id, ...fields });
      absorb(programme);
      return programme;
    } catch (err) {
      setError({ message: err.message, code: err.code, collegeId: key });
      return null;
    } finally {
      setPending(null);
    }
  }, [playerId, absorb]);

  /**
   * A FACT ABOUT THE WORLD. It says nothing about whether the school stays in
   * the athlete's actionable Top 100 — that is the separate call below, made
   * by a separate control, because they are separate decisions.
   */
  const flag = useCallback((college, reason) => apply(
    { college, relationship: byCollegeIdRef.current.get(college?.id) },
    { flagged: true, flag_reason: reason },
  ), [apply]);

  /**
   * Unflagging clears the flag and its reason and LEAVES VISIBILITY ALONE. A
   * school removed from the Top 100 stays removed when the relationship that
   * prompted it is cleared, because the operator made two decisions and only
   * one of them has been revisited.
   */
  const unflag = useCallback((relationship) => apply(
    { relationship }, { flagged: false },
  ), [apply]);

  /** `default` or `suppressed`, and nothing else travels with it. */
  const setVisibility = useCallback((target, visibility) => apply(
    target.id && target.athlete_id ? { relationship: target } : { college: target },
    { visibility },
  ), [apply]);

  const saveNote = useCallback((target, note) => apply(
    target?.athlete_id ? { relationship: target } : { college: target },
    { note },
  ), [apply]);

  const specific = programmes.filter((p) => p.request_state === 'requested');
  const byCollegeId = new Map(programmes.filter((p) => p.college_id).map((p) => [p.college_id, p]));
  byCollegeIdRef.current = byCollegeId;

  /** By programme NAME, which is what a match-card entry carries. */
  const byCollegeName = new Map(programmes.map((p) => [p.college_name, p]));

  return {
    programmes,
    specific,
    byCollegeId,
    byCollegeName,
    loading,
    failed,
    pending,
    error,
    clearError: () => setError(null),
    add,
    withdraw,
    apply,
    flag,
    unflag,
    setVisibility,
    saveNote,
    reload: load,
  };
}
