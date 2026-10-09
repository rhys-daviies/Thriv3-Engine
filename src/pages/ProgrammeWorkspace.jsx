import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { programmes as api } from '@/api/client';
import { sportLabel } from '@/lib/sports';
import { cn } from '@/lib/utils';
import OverviewSection from './programme/OverviewSection';
import RosterSection from './programme/RosterSection';
import RecruitingSection from './programme/RecruitingSection';
import ContactsSection from './programme/ContactsSection';
import IntelligenceSection from './programme/IntelligenceSection';

/**
 * ONE PROGRAMME — Phase 4. `/programmes/:id`, where :id is the `colleges` id
 * (the engine's programmeId), so a programme is always a school in ONE sport.
 *
 * Five sections, chosen with `?tab=`; the recruiting class with `?classYear=`.
 * Read only: nothing on this page writes, sends or selects.
 */
export const SECTIONS = Object.freeze([
  { key: 'overview', label: 'Overview' },
  { key: 'roster', label: 'Roster & Openings' },
  { key: 'recruiting', label: 'Recruiting Intelligence' },
  { key: 'contacts', label: 'Coaches & Contacts' },
  { key: 'intelligence', label: 'Programme Intelligence' },
]);

export default function ProgrammeWorkspace() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = SECTIONS.some((s) => s.key === params.get('tab')) ? params.get('tab') : 'overview';
  const classYear = params.get('classYear') || '';
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setError(null);
    api.get(id, classYear)
      .then((d) => { if (live) setDetail(d); })
      .catch((e) => {
        if (!live) return;
        setDetail(null);
        setError({ message: e.status === 404 ? 'No programme with this id.' : e.message, code: e.code ?? null });
      });
    return () => { live = false; };
  }, [id, classYear]);

  const set = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (!v) next.delete(k); else next.set(k, String(v)); }
    setParams(next);
  };

  const o = detail?.overview;
  const backHref = o ? `/programmes?${new URLSearchParams({
    ...(o.sport !== 'mens-soccer' ? { sport: o.sport } : {}),
    ...(classYear ? { classYear } : {}),
  }).toString()}` : '/programmes';

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Link to={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Programme Database
      </Link>

      {error && (
        <div className="space-y-2" data-testid="programme-error">
          <p className="text-sm text-destructive">{error.message}</p>
          {/* A link carrying a class the rules on file cannot speak to (an athlete's class outside the window). */}
          {error.code === 'CLASS_YEAR_OUT_OF_RANGE' && (
            <button type="button" className="text-sm text-primary hover:underline" onClick={() => set({ classYear: '' })} data-testid="default-class">
              Show the nearest recruiting class instead
            </button>
          )}
        </div>
      )}

      {o && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold" data-testid="programme-name">{o.name}</h1>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span data-testid="programme-sport">{sportLabel(o.sport)}</span>
                <Badge>{o.division ?? 'No division'}</Badge>
                {o.conference && <span>{o.conference}</span>}
                {o.active === 0 && <Badge variant="muted">Inactive</Badge>}
              </div>
            </div>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Recruiting class
              <select
                className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                value={String(detail.classYear)}
                onChange={(e) => set({ classYear: e.target.value })}
                data-testid="workspace-class"
              >
                {detail.classYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          </div>

          <nav className="flex gap-1 border-b border-border overflow-x-auto" aria-label="Programme sections">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => set({ tab: s.key === 'overview' ? '' : s.key })}
                aria-current={tab === s.key ? 'page' : undefined}
                className={cn(
                  'px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px',
                  tab === s.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
                data-testid={`section-${s.key}`}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div data-testid={`panel-${tab}`}>
            {tab === 'overview' && <OverviewSection detail={detail} onOpenRoster={() => set({ tab: 'roster' })} />}
            {tab === 'roster' && <RosterSection detail={detail} />}
            {tab === 'recruiting' && <RecruitingSection id={o.id} />}
            {tab === 'contacts' && <ContactsSection id={o.id} />}
            {tab === 'intelligence' && <IntelligenceSection id={o.id} />}
          </div>
        </>
      )}
    </div>
  );
}
