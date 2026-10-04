import { useCallback, useRef, useState } from 'react';
import { matchmaking } from '@/api/client';

/**
 * PROGRAMME CONTEXT AND EXPLANATIONS, FETCHED THE WAY THEY ARE READ — A11 §11.
 *
 * ===========================================================================
 * TWO DIFFERENT SHAPES, BECAUSE THEY ARE READ DIFFERENTLY.
 *
 *   CONTEXT       ratings, cost and departures. Shown on every expanded card,
 *                 so it is fetched ONE PAGE AT A TIME — twenty names in one
 *                 request — and cached by name for the session.
 *
 *   EXPLANATION   ~3 KB of the engine's own sentences. Only ever read for the
 *                 card somebody opened, so it is fetched on expand, one
 *                 programme at a time, and cached.
 *
 * Neither is an N+1: the first is bounded by the page and the second by a
 * human opening a card. Both are READS — nothing here creates a relationship
 * row, records a selection or writes an observation.
 *
 * -- CACHED BY NAME, NOT BY INDEX -------------------------------------------
 *
 * Paging back and forth must not re-ask, and a programme that appears in both
 * Top 100 and Specific Schools is one entry. The cache is keyed by the
 * programme name within one run, and is dropped when the run changes, because
 * a different run is a different set of numbers.
 * ===========================================================================
 */
export function useProgrammeContext(playerId, run) {
  const [contextByName, setContextByName] = useState(() => new Map());
  const [explanations, setExplanations] = useState(() => new Map());

  /** Which run the caches belong to; a new run invalidates both. */
  const runId = run?.runId ?? null;
  const cacheRun = useRef(null);
  const inFlight = useRef(new Set());

  if (cacheRun.current !== runId) {
    cacheRun.current = runId;
    inFlight.current = new Set();
    if (contextByName.size) setContextByName(new Map());
    if (explanations.size) setExplanations(new Map());
  }

  const loadPage = useCallback(async (names) => {
    if (!playerId || !runId || !names?.length) return;
    const missing = names.filter((n) => !contextByName.has(n) && !inFlight.current.has(n));
    if (!missing.length) return;
    missing.forEach((n) => inFlight.current.add(n));
    try {
      const out = await matchmaking.programmeContext(playerId, {
        names: missing, sport: run?.sport ?? null, withPlayers: true,
      });
      setContextByName((prev) => {
        const next = new Map(prev);
        for (const p of out?.programmes ?? []) next.set(p.collegeName, p);
        return next;
      });
    } catch {
      /**
       * A context read that failed leaves the cards without ratings and
       * without departures, which they render as "—" and "Not established".
       * That is the truth about this screen right now; inventing a zero
       * because a request failed is the failure mode §6 exists to prevent.
       */
    } finally {
      missing.forEach((n) => inFlight.current.delete(n));
    }
  }, [playerId, runId, run?.sport, contextByName]);

  const loadExplanation = useCallback(async (programme) => {
    const name = programme?.name;
    if (!playerId || !runId || !name) return;
    if (explanations.has(name)) return;
    setExplanations((prev) => new Map(prev).set(name, { state: 'loading', explanation: null }));
    try {
      const out = await matchmaking.programme(playerId, {
        name, sport: run?.sport ?? null, runId,
      });
      setExplanations((prev) => new Map(prev).set(name, {
        state: 'ready',
        explanation: out?.programme?.explanation ?? null,
      }));
    } catch {
      /** Treated as "no explanation stored", which the panel states plainly. */
      setExplanations((prev) => new Map(prev).set(name, { state: 'ready', explanation: null }));
    }
  }, [playerId, runId, run?.sport, explanations]);

  return { contextByName, explanations, loadPage, loadExplanation };
}
