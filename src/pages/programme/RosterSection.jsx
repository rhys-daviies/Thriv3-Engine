import React, { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { POSITION_PILL_VARIANT } from '@/lib/divisions';
import { playerHistory } from '@/api/client';
import MinutesCell from '@/components/programmes/MinutesCell';
import Departures, { classCaveat, POSITION_SHORT, WINDOW_EXHAUSTED_NOTE } from '@/components/programmes/Departures';

/**
 * ROSTER & OPENINGS — Phase 4.
 *
 * Every player on the current roster, grouped by where the ENGINE'S eligibility
 * rule places them against the chosen class (`availabilityAtEntry`, the same
 * predicate the counts come from). The counts above the list and the
 * "Eligibility ends before" group are therefore the same people.
 *
 * Nothing here is a confirmed graduate. "Eligible to remain" means the rules
 * permit it, not that the player will stay.
 */
const GROUPS = [
  { key: 'EXPIRED', title: (y) => `Eligibility ends before ${y} - projected openings` },
  { key: 'FINAL_SEASON', title: (y) => `Final eligible season is ${y} - there for that season, then gone` },
  { key: 'ELIGIBLE_TO_REMAIN', title: (y) => `Eligible to remain beyond ${y} (rules permit it; not a forecast)` },
  { key: 'UNREADABLE', title: () => 'Eligibility cannot be established - no readable class, or no rule for the association' },
];

const MODEL_LABEL = {
  NCAA_AGE_BASED_5Y: 'Five-year age-based eligibility (NCAA)',
  FOUR_SEASONS: 'Four seasons of competition',
  UNKNOWN: 'No eligibility rule on file',
};

const STARTER_LABEL = { STARTER: 'starter', SQUAD: 'squad', UNKNOWN: 'role not established' };

export default function RosterSection({ detail }) {
  const { roster, classYear, rosterSeason, overview } = detail;
  const [possibleBy, setPossibleBy] = useState(new Map());

  useEffect(() => {
    let live = true;
    playerHistory.possibleTransfers(rosterSeason, overview.sport)
      .then((rows) => {
        if (!live) return;
        // Unverified origins, labelled as such; a failure only hides the label.
        setPossibleBy(new Map((rows?.links || []).filter((l) => l.decision === 'PROBABLE_SAME_PERSON').map((l) => [l.to_observation_id, l])));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [rosterSeason, overview.sport]);

  const grouped = useMemo(() => {
    const g = Object.fromEntries(GROUPS.map((x) => [x.key, []]));
    for (const p of roster.players) (g[p.availability] ?? g.UNREADABLE).push(p);
    return g;
  }, [roster.players]);

  const e = roster.evidence;
  const w = roster.eligibility;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border p-4 space-y-2" data-testid="roster-openings">
        <h2 className="text-sm font-semibold">Projected openings for the {classYear} class</h2>
        {roster.assessed
          ? <Departures departures={roster.departures} detail />
          : <p className="text-sm text-muted-foreground" data-testid="roster-not-assessed">Not assessed: this programme is inactive, so it is outside the matching universe.</p>}
        <p className="text-[11px] text-muted-foreground">{classCaveat({ classYear, rosterSeason })}</p>
        {w.windowExhausted && <p className="text-xs text-amber-500" data-testid="window-exhausted">{WINDOW_EXHAUSTED_NOTE}</p>}
      </div>

      <div className="rounded-lg border border-border p-4 space-y-1 text-xs" data-testid="eligibility-rule">
        <p className="text-sm font-semibold">Eligibility rule applied</p>
        <p>{MODEL_LABEL[w.model] ?? w.model}{w.transitional ? ' - transitional season: players may elect the older or newer model, so a ceiling may not reflect a decision already taken' : ''}</p>
        {w.note && <p className="text-muted-foreground">{w.note}</p>}
        {w.source && <p className="text-muted-foreground">Source: {w.source}</p>}
      </div>

      <div className="rounded-lg border border-border p-4 text-xs space-y-1" data-testid="roster-evidence">
        <p className="text-sm font-semibold">Evidence quality</p>
        {e.rows === 0
          ? <p className="text-muted-foreground" data-testid="no-roster">Thriv3 holds no {rosterSeason} roster for this programme.</p>
          : (
            <ul className="space-y-0.5 text-muted-foreground">
              <li>{e.rows} players on the {rosterSeason} roster{e.dataConfidence ? ` · source confidence: ${e.dataConfidence}` : ''}</li>
              <li>{e.classUnreadable} with no readable eligibility · {e.positionUnreadable} with no readable position · {e.starterUnknown} with no starting role established</li>
              {(e.fetchedFrom || e.sourceUrl) && (
                <li>
                  {e.fetchedFrom && `Read ${e.fetchedFrom.slice(0, 10)}${e.fetchedTo && e.fetchedTo !== e.fetchedFrom ? ` to ${e.fetchedTo.slice(0, 10)}` : ''}`}
                  {e.sourceUrl && <> · <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="underline">roster source</a></>}
                </li>
              )}
            </ul>
          )}
      </div>

      {GROUPS.map((g) => {
        const list = grouped[g.key];
        if (!list.length) return null;
        return (
          <div key={g.key} className="space-y-1" data-testid={`roster-group-${g.key}`}>
            <p className="text-xs font-semibold text-muted-foreground">{g.title(classYear)} ({list.length})</p>
            <div className="rounded-lg border border-border divide-y divide-border">
              {list.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
                  <Badge variant={POSITION_PILL_VARIANT[p.position] || 'muted'} title={p.position ? undefined : `Position not readable: ${p.positionRaw ?? 'not recorded'}`}>{POSITION_SHORT[p.position] ?? '?'}</Badge>
                  <span className="flex-1 min-w-[8rem]">{p.name}</span>
                  <span className="text-muted-foreground w-16">{p.classYear ?? 'no class'}</span>
                  <span className="text-muted-foreground w-28">{p.lastSeason ? `last season ${p.lastSeason}` : 'last season unknown'}</span>
                  <span className="text-muted-foreground w-28">{STARTER_LABEL[p.starter]}</span>
                  <MinutesCell
                    minutes={p.minutesPlayed}
                    projected={p.projectedMinutes}
                    projectedSeason={p.projectedMinutesSeason}
                    priorProgramme={p.priorProgramme}
                    school={overview.name}
                    possible={possibleBy.get(p.id)}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
