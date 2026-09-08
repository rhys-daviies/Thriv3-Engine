import { useEffect, useState } from 'react';
import { evidence as evidenceApi } from '@/api/client';

/**
 * Email evidence for a set of programmes, fetched once per composer.
 *
 * Batched rather than one request per school: the whole-page composer opens on
 * twenty programmes at once, and twenty round trips would each carry the same
 * athlete lookup. The server caps a batch at 40, so this chunks anything
 * larger rather than failing the request.
 *
 * Returns { evidence, loading, failed }. `evidence` is null until the first
 * response and STAYS null on failure — a caller must not read an empty object
 * as "this programme has nothing to say", because the composer would then
 * quietly send the un-personalised template while looking like it had checked.
 * `buildEmailContext` already treats absent evidence as "render as before", so
 * a failed lookup degrades to exactly the pre-evidence email rather than to a
 * wrong one.
 */
const CHUNK = 40;

/**
 * @param {object} [overrides.prefer]          { "<college>": ["KIND", ...] }
 * @param {object} [overrides.preferStructure] { "<college>": "STRUCTURE_KEY" }
 *
 * Changing either REFETCHES. That is the point rather than a cost: the server
 * re-runs selection, revalidates the structure against what survived, renders
 * each sentence through the renderer its tier demands, and recomposes the
 * body. Reordering in the browser would be one round trip cheaper and would
 * mean the preview was assembled by code that holds no evidence objects and
 * has no idea which paragraph a claim belongs in.
 */
export function useEvidence(playerId, collegeNames, overrides = null) {
  const [evidence, setEvidence] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Serialised rather than passed as an array, because a fresh array literal
   * on every render is a new dependency every render and the effect would
   * refetch in a loop. The names are what the request actually depends on.
   *
   * JSON rather than a delimiter, and this is hardening rather than a fix.
   * What was here worked: it joined and split on a literal NUL, which no
   * programme name contains, so "Sacred Heart" survived the round trip intact.
   * The problem was that a NUL is invisible. It made this file binary to every
   * tool that reads it — `file` calls it data and `grep` refuses to search it,
   * which is how the character came to be misread as a space in the first
   * place — and it sat one formatter, one copy-paste or one editor that
   * declines to store control characters away from becoming `join('')`, which
   * would concatenate the whole list into a single string and split it back
   * into individual letters. A separator whose correctness depends on a byte
   * nobody can see in review is not worth keeping when JSON costs nothing.
   *
   * Every name in both sports round-trips through JSON exactly — the
   * apostrophes, ampersands, parentheses and the one en-dash included.
   */
  const key = JSON.stringify(collegeNames ?? []);

  // Same reasoning for the overrides, which arrive as a fresh object literal
  // on every render of the composer and would otherwise refetch in a loop of
  // their own.
  const overrideKey = JSON.stringify(overrides ?? null);

  useEffect(() => {
    // Falsy entries dropped before the emptiness check, which is what the
    // old separator did incidentally: a list of nothing but blanks produced an
    // empty key and no request at all. Keeping that means a caller with no
    // usable names still gets "nothing asked for" rather than a 400 rendered
    // as a failed lookup.
    const names = JSON.parse(key).filter(Boolean);
    if (!playerId || !names.length) { setEvidence(null); return undefined; }
    const opts = JSON.parse(overrideKey) ?? {};

    let cancelled = false;
    setLoading(true);
    setFailed(false);

    const chunks = [];
    for (let i = 0; i < names.length; i += CHUNK) chunks.push(names.slice(i, i + CHUNK));

    Promise.all(chunks.map((c) => evidenceApi.summaries(playerId, c, opts)))
      .then((parts) => {
        if (cancelled) return;
        setEvidence(Object.assign({}, ...parts));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [playerId, key, overrideKey]);

  return { evidence, loading, failed };
}

/**
 * One programme's evidence, or null.
 *
 * Returns null for an `unavailable` entry as well as a missing one: the server
 * marks a programme it could not read, and that is the same thing to a caller
 * as having nothing — it must not be handed to the template as though it were
 * evidence with no content.
 */
export function evidenceForCollege(evidence, collegeName) {
  const found = evidence?.[collegeName];
  if (!found || found.unavailable) return null;
  return found;
}
