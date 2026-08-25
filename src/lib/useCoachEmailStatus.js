import { useEffect, useState } from 'react';
import { coaches } from '@/api/client';

/**
 * One in-flight request per sport, shared by every composer that mounts.
 *
 * Module-level rather than component state because the single-school and
 * whole-page composers both need the same map, and opening one after the
 * other should not fetch six thousand addresses twice. Promises are cached,
 * not results, so two dialogs opening at once still make one request.
 */
const cache = new Map();

function load(sport) {
  const key = sport || '*';
  if (!cache.has(key)) {
    cache.set(key, coaches.emailStatus(sport).catch((err) => {
      // Dropped from the cache so the next open retries rather than showing a
      // permanent "unavailable" from one bad request.
      cache.delete(key);
      throw err;
    }));
  }
  return cache.get(key);
}

/**
 * Returns { statuses, failed }. `statuses` is null until it arrives, and stays
 * null if the lookup fails — callers must show "unavailable" in that case
 * rather than treating an empty map as a clean bill of health, which would
 * read as verified for every address on the page.
 */
export function useCoachEmailStatus(sport) {
  const [statuses, setStatuses] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatuses(null);
    setFailed(false);
    load(sport).then(
      (map) => { if (!cancelled) setStatuses(map); },
      () => { if (!cancelled) setFailed(true); }
    );
    return () => { cancelled = true; };
  }, [sport]);

  return { statuses, failed };
}

/** Looks one address up, case-insensitively. Undefined when not yet loaded. */
export function statusOf(statuses, email) {
  if (!statuses) return undefined;
  return statuses[(email || '').trim().toLowerCase()];
}
