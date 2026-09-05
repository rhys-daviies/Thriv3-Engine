import { useEffect, useState } from 'react';
import { matchingSummary as matchingSummaryApi } from '@/api/client';

/**
 * Recruiting signals for a set of programmes.
 *
 * A THIRD SIBLING of useEvidence and useOperatorEvidence rather than a mode of
 * either. The three answer different questions under different licences, and a
 * single hook with a flag would make every future change to one have to be
 * reasoned about against all three.
 *
 * ZERO SIGNALS IS A SUCCESSFUL ANSWER, and on this surface it is the common
 * one: 79.1% of real athlete-programme pairs have none. A caller must be able
 * to tell "we looked and there is no licensed signal" from "the request
 * failed" and from "this name is not a programme we hold", because the card
 * omits the panel in the first case and must not omit it for the others
 * silently. So `data` is null only before the first response and on failure;
 * a resolved programme with no signals comes back as a real entry.
 *
 * Returns { data, loading, failed }.
 */
const CHUNK = 40;

export function useMatchingSummary(playerId, collegeNames) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * JSON, never a delimiter.
   *
   * `useEvidence` keyed on a joined string for a long time and the separator
   * was a NUL — correct, invisible, and one formatter away from shredding
   * every multi-word name. 1,698 of the 2,401 active programmes contain a
   * space. There is no delimiter worth the risk.
   */
  const key = JSON.stringify(collegeNames ?? []);

  useEffect(() => {
    const names = JSON.parse(key).filter(Boolean);
    // No identifiers, no request. An empty list would be a 400 from the
    // server and would surface as a failure rather than as "nothing asked".
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

    Promise.all(chunks.map((c) => matchingSummaryApi.summaries(playerId, c)))
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
 * One programme's signals, or null.
 *
 * Null for a programme the server could not read as well as a missing one —
 * `unavailable` is a failure, not an answer, and must not reach a card as an
 * empty panel indistinguishable from a programme that simply has no signals.
 */
export function matchingSummaryForCollege(data, collegeName) {
  const found = data?.[collegeName];
  if (!found || found.unavailable) return null;
  return found;
}
