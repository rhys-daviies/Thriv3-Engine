import React from 'react';
import { Link } from 'react-router-dom';
import { sportLabel } from '@/lib/sports';
import Departures, { classCaveat } from '@/components/programmes/Departures';

const NOT_ESTABLISHED = 'Not established';

function Fact({ label, children, testid }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium" data-testid={testid}>{children}</p>
    </div>
  );
}

const ROUND = {
  appearance: 'Postseason appearance', r32: 'Round of 32', r16: 'Sweet 16', quarter: 'Quarter-final',
  semi: 'Semi-final', final: 'Final', champion: 'National champion',
};

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

function seasonStatusText(o, classYear) {
  if (o.active === 0) return 'Inactive: not a recruiting destination';
  const s = o.seasonStatus;
  if (!s) return 'Active';
  const fielded = s.fieldedInClassYear ? `fielded in ${classYear}` : `not fielded in ${classYear}`;
  if (s.status === 'FUTURE') return `Starts ${s.activeFromSeason} (${fielded})`;
  return `Not active${s.activeToSeason ? ` after ${s.activeToSeason}` : ''} (${fielded})`;
}

export default function OverviewSection({ detail, onOpenRoster }) {
  const o = detail.overview;
  const r = detail.roster;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 rounded-lg border border-border p-4">
        <Fact label="Location" testid="overview-location">{[o.city, o.state].filter(Boolean).join(', ') || o.location || NOT_ESTABLISHED}</Fact>
        <Fact label="Division">{o.division ?? NOT_ESTABLISHED}</Fact>
        <Fact label="Conference (current, this sport)">{o.conference ?? 'Not recorded'}</Fact>
        <Fact label="Program strength" testid="overview-strength">
          {o.programStrength ? `Top ${o.programStrength.topPercent}% in ${o.programStrength.division}` : NOT_ESTABLISHED}
        </Fact>
        <Fact label="Academic rating" testid="overview-academic">{o.academicRating != null ? `${o.academicRating}/10` : NOT_ESTABLISHED}</Fact>
        <Fact label="Net price">{o.netPrice != null ? money(o.netPrice) : NOT_ESTABLISHED}</Fact>
        <Fact label={`Season status (${detail.classYear})`} testid="overview-status">{seasonStatusText(o, detail.classYear)}</Fact>
        <Fact label="2025 postseason">{o.postseason2025 ? (ROUND[o.postseason2025] ?? o.postseason2025) : 'Not recorded'}</Fact>
        <Fact label="2025 conference champion">
          {o.conferenceChampion2025 == null ? 'Not recorded' : o.conferenceChampion2025 ? `Yes${o.conferenceChampion2025Name ? ` (${o.conferenceChampion2025Name})` : ''}` : 'No'}
        </Fact>
        {o.websiteDomain && <Fact label="Website">{o.websiteDomain}</Fact>}
      </div>

      {o.siblings?.length > 0 && (
        <div className="text-sm" data-testid="overview-siblings">
          <span className="text-muted-foreground">Same institution, other sport: </span>
          {o.siblings.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ', '}
              <Link to={`/programmes/${encodeURIComponent(s.id)}?classYear=${detail.classYear}`} className="text-primary hover:underline">
                {s.name} ({sportLabel(s.sport)})
              </Link>
            </span>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-border p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Projected openings for the {detail.classYear} class</h2>
          <button type="button" className="text-xs text-primary hover:underline" onClick={onOpenRoster}>Roster & Openings</button>
        </div>
        {r.assessed
          ? <Departures departures={r.departures} detail />
          : <p className="text-sm text-muted-foreground">Not assessed: this programme is inactive, so it is outside the matching universe.</p>}
        <p className="text-[11px] text-muted-foreground">{classCaveat({ classYear: detail.classYear, rosterSeason: detail.rosterSeason })}</p>
      </div>
    </div>
  );
}
