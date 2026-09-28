import { useCallback, useEffect, useRef, useState } from 'react';
import { evidence as evidenceApi } from '@/api/client';

/**
 * WHAT THRIV3 COULD TRUTHFULLY SAY ABOUT ONE PROGRAMME — F9b.
 *
 * ===========================================================================
 * ONE PROGRAMME, ASKED FOR ONLY WHEN SOMEBODY OPENS IT.
 *
 * This is the same `/api/players/:id/evidence` contract the composer sends
 * from, deliberately: the workspace and the email must not disagree about what
 * we know. What differs is the QUESTION. The composer asks "what is this email
 * using"; the workspace asks "is there anything here worth writing about", and
 * the second question is asked about a row an operator has chosen to open.
 *
 * NOT ATHLETE-LEVEL, AND THAT IS THE DIFFERENCE FROM THE THREE READS BESIDE
 * IT. `/programmes`, `/contact-intelligence` and `/pending-manual-drafts` are
 * cheap and answer for every school at once, so the page pays for them on
 * load. Evidence is not cheap: per programme the server reads five seasons of
 * roster rows, the season results, coach tenure, recruiting patterns and pool
 * benchmarks, verifies the roster source, then computes the programme's
 * philosophy and this athlete's fit within it. Thirty specific schools would
 * be thirty of those on page load, for rows nobody opened. So this stays lazy
 * and the page's load budget stays at three.
 * ===========================================================================
 *
 * UNKNOWN IS NOT NONE, AND HERE THERE ARE FOUR ANSWERS RATHER THAN TWO.
 * "We have not asked", "we are asking", "we asked and there is nothing to say"
 * and "we asked and could not find out" are four different facts, and only the
 * third is a statement about the school. A caller reads `status`, never the
 * emptiness of `evidence` — which is null in three of the four.
 *
 * NOTHING IS DERIVED HERE. The server ranks, selects, renders and hedges; this
 * carries the answer across and adds nothing to it. There is no place in this
 * file where a claim could be made, which is what keeps the browser unable to
 * manufacture one.
 */
export const PROGRAMME_EVIDENCE = Object.freeze({
  IDLE: 'IDLE',
  LOADING: 'LOADING',
  READY: 'READY',
  FAILED: 'FAILED',
});

/**
 * @param {string|null} playerId
 * @param {string|null} collegeName  the canonical programme name, which is what
 *   the endpoint keys on. NOT a rank and not a recommendation: a school nobody
 *   ranked resolves from the registry exactly as a ranked one does, which is
 *   what lets a specific school outside the Top 100 have evidence at all.
 * @param {boolean} enabled  true once the operator has opened this row.
 * @returns {{status: string, evidence: object|null, reason: string|null, reload: function}}
 */
export function useProgrammeEvidence(playerId, collegeName, enabled = false) {
  const [state, setState] = useState({
    status: PROGRAMME_EVIDENCE.IDLE, evidence: null, reason: null,
  });
  const [attempt, setAttempt] = useState(0);

  /**
   * THE ANSWER IS KEPT; THE QUESTION IS NOT ASKED TWICE.
   *
   * Collapsing a row unmounts what it renders, so the cache cannot live down
   * there — this hook is held by the ROW, which survives being closed. Open
   * Stanford, close it, open it again and there is one request; open Duke and
   * there are two.
   *
   * A FAILURE IS NOT CACHED. It is not an answer about the programme, so
   * reopening a row that failed asks again rather than preserving a verdict
   * the server never gave. That is the same reason `reload` exists.
   */
  const answered = useRef(null);
  /*
    JSON, not a delimiter. `useEvidence` beside this one carries a long
    comment about the NUL it used to join names with: the separator worked,
    and it made that file binary to grep, which is how the character came to
    be misread in the first place. A key whose correctness depends on a byte
    nobody can see in review is not worth the characters it saves.
  */
  const key = playerId && collegeName ? JSON.stringify([playerId, collegeName]) : null;

  useEffect(() => {
    if (!enabled || !key) return undefined;
    if (answered.current === key) return undefined;

    let cancelled = false;
    setState({ status: PROGRAMME_EVIDENCE.LOADING, evidence: null, reason: null });

    evidenceApi.summaries(playerId, [collegeName])
      .then((body) => {
        if (cancelled) return;
        const wire = body?.[collegeName] ?? null;
        /**
         * A PROGRAMME THE SERVER COULD NOT READ IS A FAILURE, NOT AN EMPTY ONE.
         *
         * The route answers per programme rather than failing a batch, so one
         * unreadable roster arrives as `{ unavailable: message }` beside
         * nineteen good answers. Treating that as "nothing to say" would turn
         * a server problem into a fact about the school — the exact conflation
         * `EvidencePanel` refuses, and the reason these are two states here.
         */
        if (!wire || wire.unavailable) {
          answered.current = null;
          setState({
            status: PROGRAMME_EVIDENCE.FAILED,
            evidence: null,
            reason: wire?.unavailable ?? null,
          });
          return;
        }
        answered.current = key;
        setState({ status: PROGRAMME_EVIDENCE.READY, evidence: wire, reason: null });
      })
      .catch(() => {
        if (cancelled) return;
        answered.current = null;
        setState({ status: PROGRAMME_EVIDENCE.FAILED, evidence: null, reason: null });
      });

    return () => { cancelled = true; };
  }, [enabled, key, playerId, collegeName, attempt]);

  const reload = useCallback(() => {
    answered.current = null;
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, reload };
}
