import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/Disclosure';
import { philosophy } from '@/api/client';
import { downloadBlob, slug } from '@/lib/download';
import { verdictLabel, ladderTopText, bandLabel, cohortText } from '@/lib/philosophyLabels';

/** The three shares partition the position's minutes, so a stack is honest. */
function MixBar({ dials }) {
  if (!dials || !dials.n) {
    return <p className="text-xs text-muted-foreground italic">no position-seasons we can read</p>;
  }
  const parts = [
    { key: 'returning', pct: dials.returning, className: 'bg-sky-200', label: 'stayed' },
    { key: 'freshman', pct: dials.freshman, className: 'bg-slate-800', label: 'freshmen' },
    { key: 'newcomer', pct: dials.newcomer, className: 'bg-emerald-800', label: 'transfers' },
  ];
  return (
    <div className="space-y-1">
      <div className="flex gap-0.5 h-2 rounded-sm overflow-hidden">
        {parts.map((p) => (
          <span key={p.key} className={p.className} style={{ width: `${p.pct}%` }} />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground tabular-nums">
        {parts.map((p) => `${Math.round(p.pct)}% ${p.label}`).join(' · ')}
      </p>
    </div>
  );
}

function LadderRow({ rung }) {
  const label = rung.rank === 1 ? 'Best freshman' : `${rung.rank}${['', 'st', 'nd', 'rd'][rung.rank] || 'th'}`;
  if (!rung.comparable) {
    return (
      <div className="flex justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        <span className="italic text-xs">the seasons are not comparable this far down</span>
      </div>
    );
  }
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">
        <strong>{rung.median.toLocaleString('en-US')}</strong>
        <span className="text-muted-foreground text-xs ml-2">
          {rung.agreement === 'wide' ? `${rung.low}–${rung.high}, the seasons disagree` : bandLabel(rung.band)}
        </span>
      </span>
    </div>
  );
}

/**
 * One school.
 *
 * Download state lives here rather than in the body, because the body is
 * unmounted when the row collapses and an error the operator has not read yet
 * would vanish with it.
 */
export function PhilosophyRow({ college, summary, player }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const alive = useRef(true);
  // Set on the way IN as well as cleared on the way out. StrictMode runs
  // effects mount → unmount → remount in development, so a cleanup-only
  // version latches false on the first mount and every download then hangs on
  // "Generating…" for ever, having actually succeeded.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const loading = summary === undefined;
  const verdict = summary?.verdict ? verdictLabel(summary.verdict.verdict) : null;
  const top = ladderTopText(summary?.ladderTop);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const blob = await philosophy.report(college.id, player?.id ?? null);
      downloadBlob(blob, `program-report-${slug(college.name)}`
        + `${player ? `-for-${slug(player.full_name)}` : ''}.pdf`);
    } catch (err) {
      if (alive.current) setError(err.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const header = (
    <div className="flex items-start gap-3">
      {college.logo_url
        ? <img src={college.logo_url} alt="" className="h-8 w-8 object-contain shrink-0" />
        : <div className="h-8 w-8 rounded bg-muted shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium truncate">{college.name}</span>
          <Badge variant="muted">{college.division}</Badge>
          {verdict && <Badge variant={verdict.variant}>{verdict.label}</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {loading ? 'reading roster history…' : summary?.unavailable || (
            <>
              Best freshman <span className="tabular-nums font-medium text-foreground">{top.value}</span>
              {top.note ? ` — ${top.note}` : ''}
              {summary?.dials?.n
                ? ` · transfers take ${Math.round(summary.dials.newcomer)}% of the minutes`
                : ''}
            </>
          )}
        </p>
      </div>
    </div>
  );

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <Disclosure header={header} open={open} onOpenChange={setOpen}>
        {summary?.unavailable ? (
          <p className="text-sm text-muted-foreground">{summary.unavailable}</p>
        ) : summary ? (
          <>
            {summary.verdict?.note && <p className="text-sm">{summary.verdict.note}</p>}
            <p className="text-xs text-muted-foreground">
              Describes {(summary.verdict?.describes || []).join(', ') || 'no seasons on file'}
              {summary.coach ? ` · ${summary.coach}` : ''}
              {summary.coachForRecruitSeason && summary.coachForRecruitSeason !== summary.coach
                ? ` · ${summary.coachForRecruitSeason} for 2026`
                : ''}
              {summary.coachStillInPost === null ? ' · who is in charge for 2026 is not established' : ''}
            </p>

            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                What the Nth-best freshman got
              </p>
              {(summary.ladderTop ? [summary.ladderTop] : []).length === 0
                ? <p className="text-sm text-muted-foreground">not enough on file</p>
                : <LadderRow rung={{ rank: 1, ...summary.ladderTop, comparable: true }} />}
              {summary.cohortLadderTop && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Best in {player.full_name.split(' ')[0]}’s group
                    {cohortText(summary.cohortLadderTop.cohort)
                      ? ` (${cohortText(summary.cohortLadderTop.cohort)})` : ''}
                  </span>
                  <span className="tabular-nums font-medium">
                    {summary.cohortLadderTop.median.toLocaleString('en-US')}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                When a place comes free
              </p>
              <MixBar dials={summary.dials} />
            </div>
          </>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" variant="outline" disabled={busy || !summary?.reports?.available}
            onClick={download}>
            {busy
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <FileText className="h-3.5 w-3.5 mr-1.5" />}
            {busy ? 'Generating…' : 'Program report'}
          </Button>
          <Download className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span className="text-xs text-muted-foreground">PDF</span>
          {/* Stated as text, not a title attribute — a tooltip is invisible on
              touch and to most screen readers. */}
          {summary?.reports?.playerReason && (
            <span className="text-xs text-muted-foreground">
              — the section for {player.full_name.split(' ')[0]} will say why it could not be read
            </span>
          )}
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
            <strong>That report could not be generated.</strong> {error}
          </p>
        )}
      </Disclosure>
    </div>
  );
}
