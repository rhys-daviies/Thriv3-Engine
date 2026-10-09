import React from 'react';
import { programmes as api } from '@/api/client';
import { POSITION_LABEL } from '@/components/programmes/Departures';
import { useSection } from './useSection';

/**
 * RECRUITING INTELLIGENCE — Phase 4. Where and how the programme has recruited,
 * from the materialised arrivals (`loadProgrammePatterns`) plus recruiting
 * observations operators have recorded.
 *
 * Every cut carries the engine's absence gate. When it is not reportable a
 * zero is NOT shown as a finding - the reasons are printed instead.
 */
/** `LATIN_AMERICA` -> `Latin America`; region keys are codes, not words. */
const regionLabel = (k) => String(k).toLowerCase().split('_').map((w) => (w === 'uk' ? 'UK' : w[0].toUpperCase() + w.slice(1))).join(' ');

const pct = (x) => (x == null ? 'not established' : `${Math.round(x * 100)}%`);

function Gate({ absence }) {
  if (!absence || absence.reportable) return null;
  return (
    <p className="text-[11px] text-amber-500" data-testid="absence-gate">
      Absences here are not findings: {absence.reasons.join('; ')}.
    </p>
  );
}

function Block({ title, children, testid }) {
  return (
    <div className="rounded-lg border border-border p-4 space-y-2" data-testid={testid}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Observations({ list }) {
  return (
    <Block title="Recorded recruiting statements" testid="recruiting-observations">
      {list?.length
        ? (
          <ul className="space-y-1 text-xs">
            {list.map((o) => (
              <li key={o.id}>
                <span className="font-medium">{o.kind.replace(/_/g, ' ').toLowerCase()}</span>
                {o.observedAt && <span className="text-muted-foreground"> · {String(o.observedAt).slice(0, 10)}</span>}
                {o.reviewState && <span className="text-muted-foreground"> · {o.reviewState.toLowerCase()}</span>}
                {o.note && <p className="text-muted-foreground">{o.note}</p>}
              </li>
            ))}
          </ul>
        )
        : <p className="text-xs text-muted-foreground">No recruiting statements recorded for this programme.</p>}
    </Block>
  );
}

export default function RecruitingSection({ id }) {
  const { loading, data: r, error } = useSection(() => api.recruiting(id), [id]);
  if (loading) return <p className="text-sm text-muted-foreground">Loading recruiting history…</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  if (r.state === 'STALE') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-amber-500" data-testid="recruiting-stale">
          Recruiting history is out of date: it was built from a different roster than the one on file, so nothing is shown rather than something wrong. It returns when the recruiting history is rebuilt.
        </p>
        <Observations list={r.observations} />
      </div>
    );
  }
  if (r.state === 'UNAVAILABLE') {
    return <p className="text-sm text-muted-foreground" data-testid="recruiting-unavailable">Recruiting history could not be read: {r.reason}</p>;
  }
  if (r.state === 'NO_HISTORY') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground" data-testid="recruiting-none">Thriv3 holds no roster seasons or arrivals for this programme, so there is no recruiting history to describe.</p>
        <Observations list={r.observations} />
      </div>
    );
  }

  const c = r.coverage;
  return (
    <div className="space-y-4" data-testid="recruiting-available">
      <p className="text-xs text-muted-foreground" data-testid="recruiting-coverage">
        {r.arrivals} arrivals across {c.observedTransitions} of {c.possibleTransitions} comparable season transitions
        {c.seasons.length ? ` (${c.seasons.join(', ')})` : ''}. Coverage {c.status === 'SUFFICIENT' ? 'is sufficient' : `is below the floor of ${c.floor}`}.
        {r.materialisation?.state === 'LEGACY_UNVERIFIED' && ' Built before freshness was tracked.'}
      </p>

      <Block title="Arrivals by position" testid="recruiting-positions">
        <Gate absence={r.positions.absence} />
        <ul className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {Object.entries(r.positions.byPosition).filter(([p, v]) => p !== 'UNKNOWN' || v.total > 0).map(([p, v]) => (
            <li key={p}>
              <span className="text-muted-foreground">{POSITION_LABEL[p] ?? 'Position unknown'}: </span>
              <span className="font-medium tabular-nums">{v.total}</span>
              {v.meanPerTransition != null && <span className="text-muted-foreground"> ({v.meanPerTransition.toFixed(1)} a season)</span>}
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Freshmen and experienced arrivals" testid="recruiting-entry-mix">
        <Gate absence={r.entryMix.absence} />
        <p className="text-xs">
          Freshmen {r.entryMix.counts.FRESHMAN} ({pct(r.entryMix.proportions.FRESHMAN)}) · experienced {r.entryMix.counts.EXPERIENCED} ({pct(r.entryMix.proportions.EXPERIENCED)}) · unknown {r.entryMix.counts.UNKNOWN}
        </p>
        <p className="text-[11px] text-muted-foreground">"Experienced" means college years behind them; it is not a transfer count.</p>
      </Block>

      <Block title="International recruiting" testid="recruiting-international">
        <Gate absence={r.international.absence} />
        <p className="text-xs">{r.international.total} international arrivals ({pct(r.international.share)} of arrivals)</p>
        {r.international.countries.length > 0 && (
          <p className="text-xs text-muted-foreground">Countries: {r.international.countries.map((x) => `${x.country} ${x.total}`).join(' · ')}</p>
        )}
        {r.international.regions.length > 0 && (
          <p className="text-xs text-muted-foreground">Regions: {r.international.regions.map((x) => `${regionLabel(x.region)} ${x.total}`).join(' · ')}</p>
        )}
      </Block>

      <Block title="Current coach" testid="recruiting-coach">
        {r.coach.coach
          ? (
            <p className="text-xs">
              {r.coach.coach}: {r.coach.attributableArrivals} arrivals attributable over {r.coach.attributableTransitions} transitions
              {r.coach.earliestSupportedSeason ? ` (${r.coach.earliestSupportedSeason}-${r.coach.latestSupportedSeason})` : ''}
              {r.coach.status !== 'SUFFICIENT' && <span className="text-amber-500"> · too few seasons to describe this coach's recruiting on its own</span>}
            </p>
          )
          : <p className="text-xs text-muted-foreground">No current coach on file, so no recruiting can be attributed to one.</p>}
      </Block>

      <Observations list={r.observations} />
    </div>
  );
}
