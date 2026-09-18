import { useCallback, useEffect, useState } from 'react';
import { manualOutreach } from '@/api/client';
import { contactIntelligenceKey } from '@shared/contactIntelligenceKey.js';

/**
 * WHICH MANUAL DRAFTS THIS ATHLETE IS STILL WAITING ON — F7b.
 *
 * ===========================================================================
 * ONE REQUEST FOR THE WHOLE ATHLETE, INDEXED BY PROGRAMME.
 *
 * Specific Schools renders a list. A pending-draft lookup per row would be an
 * N+1 that grows with exactly the athletes who have the most outreach, and it
 * would be invisible from the network tab because the page would be making one
 * request per card BY DESIGN rather than by accident. So this is shaped like
 * `useContactIntelligence` beside it, for the same reason and with the same
 * key: one call, one map, every row reads a local entry.
 * ===========================================================================
 *
 * SEPARATE FROM CONTACT INTELLIGENCE, DELIBERATELY. That payload answers "what
 * has happened" — derived, read-only, and carrying no row identifiers. This one
 * answers "what is still waiting for you" and carries an actionable
 * `outreach_send.id`. Folding an id for writes into a read-only intelligence
 * summary would make a handle out of an abstraction that has none.
 *
 * A FAILURE IS SILENCE, NOT A FALSE EMPTY. `failed` is reported so a caller can
 * tell "nothing is pending" from "we could not ask" — the same distinction
 * `useContactIntelligence` draws, and for the same reason: showing no pending
 * action when one exists loses a draft, and the operator never learns why.
 */
export function usePendingManualDrafts(playerId) {
  const [byProgramme, setByProgramme] = useState(() => new Map());
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!playerId) {
      setByProgramme(new Map());
      return undefined;
    }
    let cancelled = false;

    manualOutreach.pendingDrafts(playerId)
      .then((body) => {
        if (cancelled) return;
        const map = new Map();
        for (const draft of body.drafts ?? []) {
          const key = contactIntelligenceKey(draft.college_name, draft.sport);
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(draft);
        }
        setByProgramme(map);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setByProgramme(new Map());
        setFailed(true);
      });

    return () => { cancelled = true; };
  }, [playerId, attempt]);

  /**
   * Refetched rather than patched in place after a confirmation.
   *
   * A confirmation changes two things this page shows — the pending list AND
   * the contact history — and only the server knows the second. Optimistically
   * removing the row here would leave the summary beside it still reading
   * "Drafted" until something else happened to refetch, which is a screen
   * disagreeing with itself about whether a coach was written to.
   */
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { byProgramme, failed, reload };
}
