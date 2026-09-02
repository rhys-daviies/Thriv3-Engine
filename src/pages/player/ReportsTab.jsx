/**
 * THE OPERATOR'S DELIVERY SCREEN — Phase 13J.
 *
 * Pick a programme, generate, download. The athlete is whichever one the
 * workspace is already open on, which is why this is a tab here and not a
 * separate screen with its own athlete picker: an operator who has navigated
 * to Rhys Davies should not have to choose him again, and a second picker is a
 * second chance to send the wrong person's report.
 *
 * Internal, not client-facing. Clarity over ornament: no cards, no progress
 * bars, no counters. The one thing this screen must never do is let somebody
 * generate a document for the wrong pair, so the pair is spelled out in full
 * before the button and the button says exactly what it will make.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Download, Search, AlertCircle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { reports } from '@/api/client';
import { downloadBlob } from '@/lib/download';
import { usePlayerWorkspace } from './PlayerWorkspace';

const SPORT_LABEL = { 'mens-soccer': 'Men’s soccer', 'womens-soccer': 'Women’s soccer' };

/** READY → GENERATING → GENERATED | FAILED. No percentages: there is nothing to count. */
const STATE = { READY: 'ready', GENERATING: 'generating', GENERATED: 'generated', FAILED: 'failed' };

function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined,
    { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ReportsTab() {
  const { player } = usePlayerWorkspace();
  const sportKey = player?.sport ?? 'mens-soccer';

  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [programme, setProgramme] = useState(null);
  const [state, setState] = useState(STATE.READY);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState(null);
  const [downloading, setDownloading] = useState(null);

  const loadHistory = useCallback(() => {
    if (!player?.id) return;
    reports.history({ athleteId: player.id })
      .then((rows) => { setHistory(rows); setHistoryError(null); })
      .catch((err) => setHistoryError(err.message));
  }, [player?.id]);

  useEffect(loadHistory, [loadHistory]);

  // Programme search, scoped to the athlete's own sport so the pairing guard
  // never has to fire on something this screen offered.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setMatches([]); return undefined; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      reports.programmes(q, sportKey)
        .then((rows) => { if (!cancelled) setMatches(rows); })
        .catch(() => { if (!cancelled) setMatches([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); setSearching(false); };
  }, [query, sportKey]);

  const generate = useCallback(async () => {
    // Guards the double click as well as the empty selection: while a
    // generation is in flight the button is disabled AND this returns.
    if (!programme || state === STATE.GENERATING) return;
    setState(STATE.GENERATING);
    setError(null);
    setResult(null);
    try {
      const row = await reports.generate({ athleteId: player.id, collegeId: programme.id });
      setResult(row);
      setState(row.status === 'generated' ? STATE.GENERATED : STATE.FAILED);
      if (row.status !== 'generated') setError(row.error);
      loadHistory();
    } catch (err) {
      setError(err.message);
      setState(STATE.FAILED);
      // A failed attempt is recorded server-side, so the history still moves.
      loadHistory();
    }
  }, [programme, state, player?.id, loadHistory]);

  const download = useCallback(async (id) => {
    setDownloading(id);
    try {
      const { blob, filename } = await reports.download(id);
      // The server names the file. Never rebuilt here.
      downloadBlob(blob, filename);
    } catch (err) {
      setHistoryError(err.message);
    } finally {
      setDownloading(null);
    }
  }, []);

  const previousForPair = useMemo(
    () => (programme ? history.filter((h) => h.programme === programme.name).length : 0),
    [history, programme],
  );

  if (!player) return null;

  return (
    <div className="max-w-3xl space-y-10 py-2">
      {/* ---- the pair ---------------------------------------------------- */}
      <section>
        <h2 className="font-heading text-base font-semibold">Generate an intelligence report</h2>
        <p className="text-sm text-muted-foreground mt-1">
          One athlete, one programme, one PDF. Every generation is kept exactly as it was
          produced — regenerating never replaces what was sent before.
        </p>

        <dl className="mt-6 grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Athlete</dt>
          <dd className="font-medium">
            {player.full_name}
            <span className="text-muted-foreground font-normal">
              {' · '}{player.position || 'position not set'}
              {player.recruiting_class_year ? ` · entering ${player.recruiting_class_year}` : ''}
              {' · '}{SPORT_LABEL[player.sport] ?? player.sport}
            </span>
          </dd>

          <dt className="text-muted-foreground pt-1">Programme</dt>
          <dd>
            {programme ? (
              <div className="flex items-start gap-3">
                <div>
                  <span className="font-medium">{programme.name}</span>
                  <span className="text-muted-foreground">
                    {' · '}{programme.sport}
                    {programme.division ? ` · ${programme.division}` : ''}
                    {programme.state ? ` · ${programme.state}` : ''}
                  </span>
                </div>
                <button type="button" className="text-xs text-primary hover:underline pt-0.5"
                  onClick={() => { setProgramme(null); setQuery(''); setState(STATE.READY); setResult(null); setError(null); }}>
                  change
                </button>
              </div>
            ) : (
              <div>
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Search ${SPORT_LABEL[sportKey] ?? ''} programmes…`}
                    className="w-full border rounded-md pl-8 pr-3 py-1.5 text-sm bg-background"
                    aria-label="Search programmes"
                  />
                </div>
                {query.trim().length >= 2 && (
                  <ul className="mt-1 border rounded-md divide-y max-h-64 overflow-auto">
                    {searching && !matches.length && (
                      <li className="px-3 py-2 text-sm text-muted-foreground">Searching…</li>
                    )}
                    {!searching && !matches.length && (
                      <li className="px-3 py-2 text-sm text-muted-foreground">
                        No {SPORT_LABEL[sportKey]?.toLowerCase()} programme matches that.
                      </li>
                    )}
                    {matches.map((p) => (
                      <li key={p.id}>
                        <button type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                          onClick={() => { setProgramme(p); setState(STATE.READY); setResult(null); setError(null); }}>
                          <span className="font-medium">{p.name}</span>
                          {/* Division and state, because two programmes share a name. */}
                          <span className="text-muted-foreground">
                            {' · '}{p.division ?? 'division not on file'}
                            {p.conference ? ` · ${p.conference}` : ''}
                            {p.state ? ` · ${p.state}` : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </dd>
        </dl>

        <div className="mt-6 flex items-center gap-3">
          <Button onClick={generate} disabled={!programme || state === STATE.GENERATING}>
            <FileText className="h-4 w-4 mr-1.5" />
            {state === STATE.GENERATING ? 'Generating…'
              : previousForPair ? 'Regenerate report' : 'Generate report'}
          </Button>
          {state === STATE.GENERATING && (
            <span className="text-sm text-muted-foreground">
              Building the document. The first report after a restart takes a few seconds.
            </span>
          )}
          {!programme && (
            <span className="text-sm text-muted-foreground">Choose a programme to continue.</span>
          )}
          {programme && previousForPair > 0 && state === STATE.READY && (
            <span className="text-sm text-muted-foreground">
              {previousForPair} already generated for this pair. A new one is kept alongside them.
            </span>
          )}
        </div>

        {state === STATE.GENERATED && result && (
          <div className="mt-5 border rounded-md p-4 text-sm">
            <div className="font-medium">Generated</div>
            <div className="mt-1 font-mono text-xs break-all">{result.filename}</div>
            <div className="mt-1 text-muted-foreground">
              {result.athlete ? 'Athlete × programme' : 'Programme intelligence'}
              {result.pages ? ` · ${result.pages} pages` : ''}
              {' · '}{when(result.generatedAt)}
            </div>
            <Button variant="outline" size="sm" className="mt-3"
              disabled={downloading === result.id} onClick={() => download(result.id)}>
              <Download className="h-4 w-4 mr-1.5" />
              {downloading === result.id ? 'Preparing…' : 'Download PDF'}
            </Button>
          </div>
        )}

        {state === STATE.FAILED && error && (
          <div className="mt-5 border rounded-md p-4 text-sm flex gap-2.5">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div>
              <div className="font-medium">That report was not generated.</div>
              <p className="text-muted-foreground mt-1">{error}</p>
            </div>
          </div>
        )}
      </section>

      {/* ---- history ------------------------------------------------------ */}
      <section>
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Previous reports
          </h3>
          <button type="button" onClick={loadHistory}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <RotateCw className="h-3 w-3" /> refresh
          </button>
        </div>

        {historyError && (
          <p className="text-sm text-muted-foreground mt-3">{historyError}</p>
        )}

        {!history.length ? (
          /* Never "no analysis": an empty history means nothing has been sent. */
          <p className="text-sm text-muted-foreground mt-3">No reports generated yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b">
                <th className="py-2 font-medium">Programme</th>
                <th className="py-2 font-medium">Type</th>
                <th className="py-2 font-medium">Generated</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium sr-only">Download</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{h.programme}</div>
                    <div className="text-xs text-muted-foreground">{h.sport}</div>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {h.reportType === 'athlete' ? 'Athlete × programme' : 'Programme'}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                    {when(h.generatedAt)}
                    {h.pages ? <span className="block text-xs">{h.pages} pages</span> : null}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {h.status === 'generated' ? 'Generated' : 'Failed'}
                    {/* Two generations of one pair share a filename; the
                        fingerprint is how an operator tells the files apart. */}
                    {h.fingerprint
                      ? <span className="block text-xs font-mono">{h.fingerprint}</span> : null}
                  </td>
                  <td className="py-2 text-right">
                    {h.status === 'generated' && (
                      <Button variant="ghost" size="sm" disabled={downloading === h.id}
                        onClick={() => download(h.id)}>
                        <Download className="h-3.5 w-3.5 mr-1" />
                        {downloading === h.id ? 'Preparing…' : 'Download'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
