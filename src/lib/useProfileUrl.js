import { useEffect, useState } from 'react';
import { publishing } from '@/api/client';

/**
 * The athlete's real public profile URL, for showing an operator what a coach
 * will actually receive.
 *
 * Only for display. The link that goes in a message is built server-side and
 * carries that coach's own tracking token, so this is the same address with a
 * stand-in where the token will be — never a link to send.
 */
const cache = new Map();

function load(playerId) {
  if (!cache.has(playerId)) {
    cache.set(playerId, publishing.status(playerId).catch((err) => {
      cache.delete(playerId);
      throw err;
    }));
  }
  return cache.get(playerId);
}

/** Returns the preview URL, or null while loading or if the lookup fails. */
export function useProfileUrl(playerId) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    load(playerId).then(
      (status) => { if (!cancelled && status?.url) setUrl(`${status.url}?ref=<unique to each coach>`); },
      () => { /* preview falls back to the raw token, which is honest enough */ }
    );
    return () => { cancelled = true; };
  }, [playerId]);

  return url;
}
