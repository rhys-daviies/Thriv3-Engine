import { useEffect, useState } from 'react';
import { contactIntelligence } from '@/api/client';

/**
 * ONE FETCH PER ATHLETE, READ BY EVERY CARD.
 *
 * The matching page renders a hundred programmes twenty at a time. Asking per
 * card would make the request count a property of how the page paginates,
 * which is the same failure `useMatchingSummary` was built to avoid — and this
 * one would be worse, because a card is rendered on four surfaces.
 *
 * So the athlete is asked once, the answer is indexed by programme name, and
 * every consumer does a Map lookup. A MISS IS THE ANSWER "nobody has written
 * to them", not a reason to go and ask.
 *
 * ---------------------------------------------------------------------------
 * UNKNOWN IS NOT NONE, AND THE STATUS IS HOW A CALLER TELLS.
 *
 * A programme with no history is absent from the map, and so is every
 * programme when the request fails — the same empty Map, meaning two opposite
 * things. `status` is what separates them, because a card rendering nothing is
 * read as "never contacted" and on a failed load that is the one conclusion
 * the data does not support.
 * ---------------------------------------------------------------------------
 *
 * Returns { status, byProgramme, error, loading, failed, reload }.
 */
export const CONTACT_INTELLIGENCE = Object.freeze({
  /** No athlete yet. Nothing has been asked and nothing is coming. */
  IDLE: 'idle',
  LOADING: 'loading',
  /** The answer is in. An absent programme genuinely has no history. */
  READY: 'ready',
  /** We do not know. An absent programme means nothing at all. */
  FAILED: 'failed',
});
export function useContactIntelligence(playerId) {
  const [byProgramme, setByProgramme] = useState(() => new Map());
  const [status, setStatus] = useState(CONTACT_INTELLIGENCE.IDLE);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!playerId) {
      setByProgramme(new Map());
      setStatus(CONTACT_INTELLIGENCE.IDLE);
      return undefined;
    }
    let cancelled = false;
    setStatus(CONTACT_INTELLIGENCE.LOADING);
    setError(null);

    contactIntelligence.forAthlete(playerId)
      .then((body) => {
        if (cancelled) return;
        setByProgramme(new Map((body.programmes ?? []).map((p) => [p.college_name, p])));
        setStatus(CONTACT_INTELLIGENCE.READY);
      })
      .catch((err) => {
        if (cancelled) return;
        /**
         * AN EMPTY MAP, AND A STATUS SAYING IT MEANS NOTHING.
         *
         * Showing no history is the right direction — a wrong summary is worse
         * than none — but it must not be indistinguishable from a confirmed
         * absence of contact. The consumers read `status`, not the map size.
         */
        setByProgramme(new Map());
        setError(err.message ?? String(err));
        setStatus(CONTACT_INTELLIGENCE.FAILED);
      });

    return () => { cancelled = true; };
  }, [playerId, attempt]);

  return {
    status,
    byProgramme,
    error,
    loading: status === CONTACT_INTELLIGENCE.LOADING,
    failed: status === CONTACT_INTELLIGENCE.FAILED,
    /**
     * ONE RETRY, REACHED FROM THE PAGE. Not one per card: a hundred retry
     * controls is a hundred ways to make the same request, and the request is
     * athlete-level.
     */
    reload: () => setAttempt((n) => n + 1),
  };
}
