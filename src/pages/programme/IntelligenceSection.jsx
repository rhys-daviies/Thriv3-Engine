import React from 'react';
import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { programmes as api } from '@/api/client';
import { verdictLabel, ladderTopText, dialText } from '@/lib/philosophyLabels';
import { useSection } from './useSection';

/**
 * PROGRAMME INTELLIGENCE — Phase 4. The generic programme report's own data:
 * how the programme uses freshmen and who coaches it (philosophy), and its
 * competitive record by season. Each half states when it cannot be read.
 * Athlete-specific evidence stays in the athlete's workspace.
 */
export default function IntelligenceSection({ id }) {
  const { loading, data, error } = useSection(() => api.intelligence(id), [id]);
  if (loading) return <p className="text-sm text-muted-foreground">Loading programme intelligence…</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  const ph = data.philosophy;
  const cp = data.competitive;
  const top = ph.state === 'AVAILABLE' ? ladderTopText(ph.ladderTop) : null;
  const dials = ph.state === 'AVAILABLE' ? dialText(ph.dials) : null;
  const verdict = ph.verdict ? verdictLabel(ph.verdict.verdict) : null;

  return (
    <div className="space-y-5">
      <a href={data.reportUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline" data-testid="programme-report-link">
        <FileText className="h-4 w-4" /> Programme report (PDF)
      </a>

      <div className="rounded-lg border border-border p-4 space-y-2" data-testid="intelligence-philosophy">
        <h3 className="text-sm font-semibold">Program philosophy and coaching</h3>
        {ph.state !== 'AVAILABLE'
          ? <p className="text-xs text-muted-foreground" data-testid="philosophy-unavailable">Not established: {ph.reason}.</p>
          : (
            <div className="space-y-1 text-xs">
              {verdict && <p><Badge variant={verdict.variant}>{verdict.label}</Badge>{ph.verdict.note && <span className="text-muted-foreground ml-2">{ph.verdict.note}</span>}</p>}
              <p>Coach: {ph.coach ?? 'not on file'}{ph.coachForRecruitSeason && ph.coachForRecruitSeason !== ph.coach ? ` · coach for the recruiting season: ${ph.coachForRecruitSeason}` : ''}{ph.coachStillInPost === false ? ' · no longer in post' : ''}</p>
              {ph.seasonsObserved != null && <p className="text-muted-foreground">{ph.seasonsObserved} seasons observed</p>}
              {top && <p>Best freshman's minutes: <span className="font-medium">{top.value}</span> <span className="text-muted-foreground">{top.note}</span></p>}
              {dials && <p className="text-muted-foreground">Minutes share: {Math.round(dials.returning)}% returning · {Math.round(dials.freshman)}% freshmen · {Math.round(dials.newcomer)}% transfers</p>}
            </div>
          )}
      </div>

      <div className="rounded-lg border border-border p-4 space-y-2" data-testid="intelligence-competitive">
        <h3 className="text-sm font-semibold">Competitive record</h3>
        {cp.state !== 'AVAILABLE'
          ? <p className="text-xs text-muted-foreground" data-testid="competitive-unavailable">No competitive record can be read for this programme.{cp.refusals?.length ? ` ${cp.refusals.join(' ')}` : ''}</p>
          : (
            <>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr><th className="text-left py-1">Season</th><th className="text-left">Record (W-L-D)</th><th className="text-left">Win %</th><th className="text-left">Division</th><th className="text-left">Conference</th><th className="text-left">Conference record</th></tr>
                </thead>
                <tbody>
                  {cp.seasons.map((s) => (
                    <tr key={s.season} className="border-t border-border">
                      <td className="py-1">{s.season}</td>
                      <td>{s.overallRecord}</td>
                      <td>{s.winPercentage != null ? s.winPercentage.toFixed(3) : '—'}</td>
                      <td>{s.historicalDivision ?? 'not established'}</td>
                      <td>{s.historicalConference ?? 'not established'}</td>
                      <td>{s.conferenceRecord ?? 'not established'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cp.structuralFacts.length > 0 && <ul className="text-xs text-muted-foreground list-disc pl-4">{cp.structuralFacts.map((f) => <li key={f}>{f}</li>)}</ul>}
              <p className="text-[11px] text-muted-foreground">{cp.coverage.readableSeasons} of {cp.coverage.expectedSeasons} seasons readable.{cp.refusals.length ? ` ${cp.refusals.join(' ')}` : ''}</p>
            </>
          )}
      </div>
    </div>
  );
}
