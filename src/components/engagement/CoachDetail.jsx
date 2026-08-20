import React, { useEffect, useState } from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { engagement } from '@/api/client';

function duration(seconds) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Chronological session timeline for one coach — what a staff member reads
 * before advising a family. Qualified sessions only.
 */
export default function CoachDetail({ coach, onBack }) {
  const [sessions, setSessions] = useState(null);

  useEffect(() => {
    let cancelled = false;
    engagement.sessions(coach.outreach_id).then((rows) => {
      if (!cancelled) setSessions(rows);
    });
    return () => { cancelled = true; };
  }, [coach.outreach_id]);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft className="h-4 w-4 mr-1.5" /> All coaches
      </Button>

      <Card className="p-5">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-heading text-lg font-semibold">{coach.coach_name || 'Coach'}</h3>
            <p className="text-sm text-muted-foreground">
              {[coach.position_title, coach.school, coach.division].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="text-right">
            <p className="font-heading text-2xl font-bold">{coach.engagement_score}</p>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{coach.tier}</p>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h4 className="font-heading text-sm font-semibold mb-4">Session timeline</h4>

        {sessions === null && <p className="text-sm text-muted-foreground">Loading…</p>}

        {sessions !== null && sessions.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            This coach has not had a qualified visit yet.
          </p>
        )}

        {sessions !== null && sessions.length > 0 && (
          <ol className="space-y-3">
            {sessions.map((s) => {
              // A return visit is a new visit after the first — not merely a
              // new session, since sessions inside the collapse window are the
              // same visit and the coach table counts them that way.
              const isReturn = s.starts_visit && s.visit_number > 1;
              return (
                <li key={s.session_id} className="border-l-2 border-border pl-4 pb-1 relative">
                  <span
                    className={`absolute -left-[5px] top-1.5 h-2 w-2 rounded-full ${isReturn ? 'bg-primary' : s.starts_visit ? 'bg-muted-foreground' : 'bg-border'}`}
                  />
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <span className="text-sm font-medium">
                      {new Date(s.started_at).toLocaleString()}
                    </span>
                    {isReturn ? (
                      <span className="text-[10px] uppercase tracking-wider text-primary">
                        Return visit {s.visit_number}
                      </span>
                    ) : !s.starts_visit ? (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Same visit
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    <span>Duration {duration(s.duration_seconds)}</span>
                    <span>Coverage {s.coverage_pct}%</span>
                    <span>Watched {duration(s.watched_seconds)}</span>
                    {s.rewinds > 0 && (
                      <span className="inline-flex items-center gap-1 text-foreground">
                        <RotateCcw className="h-3 w-3" /> {s.rewinds} rewind{s.rewinds === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  {s.chapters.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {s.chapters.map((label, n) => (
                        <li key={n} className="text-xs text-muted-foreground">— {label}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
