import { useEffect, useState } from 'react';
import { operatorEvidence as operatorApi } from '@/api/client';

/**
 * Operator decision evidence for a set of programmes.
 *
 * A SIBLING of useEvidence rather than a mode of it. The two answer different
 * questions from different payloads — one returns the sentences an email would
 * carry, the other returns structured facts for a screen to phrase — and a
 * single hook with a flag would make every future change to either have to be
 * reasoned about against both.
 *
 * NO FALLBACK TO THE COMPOSER ENDPOINT. If this request fails the surface says
 * so; quietly serving the other endpoint's payload would mean the decision
 * screen was reading the email's evidence and could not say which.
 *
 * Returns { data, loading, failed }. `data` is null until the first response
 * and STAYS null on failure, so a caller cannot read an empty object as "no
 * programme has anything to say".
 */
const CHUNK = 40;

export function useOperatorEvidence(playerId, collegeNames) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Serialised rather than passed as an array, because a fresh array literal
   * on every render is a new dependency every render and the effect would
   * refetch in a loop.
   *
   * JSON rather than a space join. `useEvidence` joins on a space and splits
   * the same string back apart, which silently shreds every programme whose
   * name contains one: "Sacred Heart" is requested as "Sacred" and "Heart",
   * neither resolves, and the real name is never asked about — the programme
   * renders blank with no error anywhere. 722 of the 1,166 men's programmes
   * have a space in their name. Reported rather than fixed there, since this
   * step must not change the composer surface.
   */
  const key = JSON.stringify(collegeNames ?? []);

  useEffect(() => {
    const names = JSON.parse(key);
    // No identifiers, no request. An empty list would be a 400 from the server
    // and would show as a failure rather than as "nothing asked for".
    if (!playerId || !names.length) {
      setData(null);
      setLoading(false);
      setFailed(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);

    const chunks = [];
    for (let i = 0; i < names.length; i += CHUNK) chunks.push(names.slice(i, i + CHUNK));

    Promise.all(chunks.map((c) => operatorApi.summaries(playerId, c)))
      .then((parts) => {
        if (cancelled) return;
        setData(Object.assign({}, ...parts));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [playerId, key]);

  return { data, loading, failed };
}

/**
 * One programme's read model, or null.
 *
 * Null for an `unavailable` entry as well as a missing one. `unavailable` is a
 * programme the server could not read — a failure, not an answer — and it must
 * not reach the zero state, which is a statement about what we found.
 */
export function operatorEvidenceForCollege(data, collegeName) {
  const found = data?.[collegeName];
  if (!found || found.unavailable) return null;
  return found;
}
