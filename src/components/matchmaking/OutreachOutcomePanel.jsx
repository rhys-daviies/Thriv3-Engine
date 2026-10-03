import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { observations as api } from '@/api/client';
import {
  outcomeStateView, observationView, selectionView, kindLabel,
} from '@/lib/outreachOutcomeView';

/**
 * WHAT CAME OF A PROGRAMME WE CHOSE — A9.6 §U.
 *
 * ===========================================================================
 * AN OPERATIONAL VERIFICATION SURFACE, AND DELIBERATELY NOT A DASHBOARD.
 *
 * §U asks for the minimum needed to prove the data path works end to end:
 * that a selection resolves to its run and rank, that an observation can be
 * recorded against it, that a machine classification can be reviewed, and that
 * the derived state follows. Charts, funnels and reply rates are A9.7's
 * business and are not here — a polished analytics screen built on three days
 * of data would mostly be a way of over-reading it.
 * ===========================================================================
 *
 * -- THE TWO RULES THIS SCREEN HOLDS ---------------------------------------
 *
 * 1. NO ENGINE NUMBERS BEYOND WHAT THE SELECTION FROZE. The rank and band
 *    come from `matchmaking_selections`, which recorded them when the choice
 *    was made. Nothing here recomputes, and nothing re-reads today's run - a
 *    programme pursued out of March's run is reported as March saw it.
 *
 * 2. AN EMPTY AXIS IS EMPTY. "No reply yet" is not "Not interested", and the
 *    view model owns that distinction so it can be tested without a browser.
 */
export default function OutreachOutcomePanel({ player, selection, universeSize = null }) {
  const [vocabulary, setVocabulary] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [kind, setKind] = useState('');
  const [position, setPosition] = useState('');
  const [saving, setSaving] = useState(false);

  const view = selectionView(selection, { universeSize });

  useEffect(() => {
    let live = true;
    api.vocabulary().then((v) => { if (live) setVocabulary(v); }).catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!player?.id || !view) return undefined;
    let live = true;
    setLoading(true);
    setError(null);
    api.forProgramme(player.id, { collegeName: view.collegeName, sport: view.sport })
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(e?.message ?? 'Could not load the outcome record.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [player?.id, view?.collegeName, view?.sport]);

  if (!view) return null;

  const reload = () => api
    .forProgramme(player.id, { collegeName: view.collegeName, sport: view.sport })
    .then(setData)
    .catch((e) => setError(e?.message ?? 'Could not reload.'));

  const spec = vocabulary?.kinds?.find((k) => k.kind === kind);
  const needsPosition = Boolean(spec?.required?.includes('position'));

  const add = async () => {
    if (!kind) return;
    setSaving(true);
    setError(null);
    try {
      await api.record(player.id, {
        collegeName: view.collegeName,
        sport: view.sport,
        matchmakingSelectionId: view.id,
        kind,
        attributes: needsPosition && position ? { position } : null,
        /**
         * A PERSON IS RECORDING THIS, so it is MANUAL and arrives CONFIRMED.
         * The screen does not offer AI_ASSISTED: nothing in this build
         * classifies anything, and an option that produced a row claiming a
         * classifier had run would be a lie told by a dropdown.
         */
        source: 'OPERATOR',
        classifierMethod: 'MANUAL',
      });
      setKind('');
      setPosition('');
      await reload();
    } catch (e) {
      setError(e?.message ?? 'That observation was refused.');
    } finally {
      setSaving(false);
    }
  };

  const state = outcomeStateView(data?.state);
  const rows = (data?.observations ?? []).map(observationView).reverse();

  return (
    <Card className="p-4 space-y-4" data-testid="outcome-panel">
      <div className="space-y-1">
        <p className="text-sm font-medium">{view.collegeName}</p>
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
          <Badge variant="outline" data-testid="outcome-rank">{view.rankLabel}</Badge>
          {view.band && <Badge variant="secondary">{view.band}</Badge>}
          {view.runWasStale && (
            <span data-testid="outcome-stale">
              Chosen from a run that was already out of date
            </span>
          )}
        </div>
      </div>

      {/* §Q. The derived state, on three axes that never collapse into one. */}
      <div className="grid gap-2 sm:grid-cols-3" data-testid="outcome-state">
        <Axis title="Programme" axis={state.programmeInterest} testid="axis-programme" />
        <Axis title="Recruiting need" axis={state.recruitingNeed} testid="axis-need" />
        <Axis title="Athlete" axis={state.athleteOutcome} testid="axis-athlete" />
      </div>

      {state.supersededCount > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="outcome-superseded">
          {state.supersededCount} earlier {state.supersededCount === 1 ? 'observation has' : 'observations have'}
          {' '}been superseded, retracted or rejected. {state.supersededCount === 1 ? 'It is' : 'They are'}
          {' '}kept below rather than removed.
        </p>
      )}

      <div className="space-y-2">
        <label className="text-xs font-medium" htmlFor="observation-kind">Record what happened</label>
        <div className="flex gap-2 flex-wrap">
          <select
            id="observation-kind"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">Choose…</option>
            {(vocabulary?.kinds ?? []).map((k) => (
              <option key={k.kind} value={k.kind}>{kindLabel(k.kind)}</option>
            ))}
          </select>

          {/*
            The required attributes come from the SERVER's vocabulary, so a
            kind that needs a position asks for one and a kind that does not
            never offers the field.
          */}
          {needsPosition && (
            <select
              aria-label="Position"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            >
              <option value="">Position…</option>
              {['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}

          <Button size="sm" onClick={add} disabled={!kind || saving || (needsPosition && !position)}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
            Record
          </Button>
        </div>
      </div>

      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      {loading && <p className="text-xs text-muted-foreground">Loading the outcome record…</p>}

      <ul className="space-y-2" data-testid="outcome-history">
        {rows.map((o) => (
          <li key={o.id} className="text-xs border-t border-border pt-2" data-testid="observation-row">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-medium">{o.label}</span>
              <span className="text-muted-foreground">{o.observedAt?.slice(0, 10)}</span>
            </div>
            {o.detail && <p className="text-muted-foreground">{o.detail}</p>}
            {o.correction && (
              <p className="text-muted-foreground">
                {o.correction === 'RETRACTS' ? 'Retracts an earlier observation' : 'Supersedes an earlier observation'}
              </p>
            )}
            {o.confidenceNote && <p className="text-muted-foreground">{o.confidenceNote}</p>}
            {o.needsReview && (
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline"
                  onClick={() => api.review(o.id, 'CONFIRMED').then(reload)}>
                  Confirm
                </Button>
                <Button size="sm" variant="outline"
                  onClick={() => api.review(o.id, 'REJECTED').then(reload)}>
                  Reject
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Axis({ title, axis, testid }) {
  return (
    <div className="rounded-md border border-border p-2" data-testid={testid}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="text-sm">{axis.label}</p>
      {axis.detail && <p className="text-xs text-muted-foreground">{axis.detail}</p>}
      {axis.confidenceNote && <p className="text-xs text-muted-foreground">{axis.confidenceNote}</p>}
    </div>
  );
}
