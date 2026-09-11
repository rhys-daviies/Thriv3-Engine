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
 * Returns { byProgramme, loading, failed, reload }.
 */
export function useContactIntelligence(playerId) {
  const [byProgramme, setByProgramme] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!playerId) {
      setByProgramme(new Map());
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);

    contactIntelligence.forAthlete(playerId)
      .then((body) => {
        if (cancelled) return;
        setByProgramme(new Map((body.programmes ?? []).map((p) => [p.college_name, p])));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        /**
         * AN EMPTY MAP ON FAILURE, and `failed` beside it so a caller can tell
         * the two apart. Every consumer renders nothing for a miss, so a failed
         * load degrades to showing no history rather than to showing wrong
         * history — the safe direction for a summary nobody should act on
         * blindly.
         */
        setByProgramme(new Map());
        setFailed(true);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [playerId, attempt]);

  return { byProgramme, loading, failed, reload: () => setAttempt((n) => n + 1) };
}
