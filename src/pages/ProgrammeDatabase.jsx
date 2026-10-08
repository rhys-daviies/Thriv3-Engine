import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SPORTS } from '@/lib/sports';
import { programmes as api } from '@/api/client';
import Departures, { classCaveat, WINDOW_EXHAUSTED_NOTE } from '@/components/programmes/Departures';
import { cn } from '@/lib/utils';

/**
 * THE PROGRAMME DATABASE — Phase 4 (docs/IMMEDIATE_CHANGES_ROADMAP.md).
 *
 * Replaces the College Database and the Graduating Database. Every filter is
 * applied by the server and lives in the URL, so a view can be shared and the
 * back button restores it. A row opens the programme's workspace.
 *
 * Openings are the matching engine's own projection for the chosen recruiting
 * class, with the engine's states: a count is printed only when it was
 * measured.
 */
/**
 * /colleges and /graduating-db, which this page replaces. The sport carries
 * across; nothing else on those pages lived in the URL.
 */
export function LegacyDatabaseRedirect() {
  const { search } = useLocation();
  const sport = new URLSearchParams(search).get('sport');
  return <Navigate to={sport ? `/programmes?sport=${encodeURIComponent(sport)}` : '/programmes'} replace />;
}

export const DEFAULTS = Object.freeze({ sport: 'mens-soccer', sort: 'strength', page: '1' });

const CONF_SEP = '\u001F';

const SORT_LABEL = { strength: 'Program strength', academic: 'Academic rating', name: 'Name' };

function strengthText(s) {
  return s ? `Top ${s.topPercent}% in ${s.division}` : 'Not established';
}

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function Select({ label, value, onChange, children, testid }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select
        className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
      >
        {children}
      </select>
    </label>
  );
}

function StatusCell({ p }) {
  if (p.active === 0) return <Badge variant="muted">Inactive</Badge>;
  const s = p.seasonStatus;
  if (!s) return <span className="text-xs text-muted-foreground">Active</span>;
  if (s.status === 'FUTURE') return <Badge variant="amber" title={s.evidence || undefined}>From {s.activeFromSeason}</Badge>;
  return <Badge variant="muted" title={s.evidence || undefined}>Not active{s.activeToSeason ? ` · through ${s.activeToSeason}` : ''}</Badge>;
}

export default function ProgrammeDatabase() {
  const [params, setParams] = useSearchParams();
  const sport = params.get('sport') || DEFAULTS.sport;
  const classYear = params.get('classYear') || '';
  const division = params.get('division') || '';
  const conference = params.get('conference') || '';
  const sort = params.get('sort') || DEFAULTS.sort;
  const page = params.get('page') || DEFAULTS.page;
  const includeInactive = params.get('includeInactive') === '1';
  const [schoolDraft, setSchoolDraft] = useState(params.get('school') || '');
  const school = useDebounced(schoolDraft.trim());

  const [facets, setFacets] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  /** Change filters; any filter change returns to page 1. */
  const update = (patch, { keepPage = false } = {}) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v === null || v === undefined || v === false) next.delete(k); else next.set(k, String(v));
    }
    if (!keepPage) next.delete('page');
    setParams(next, { replace: false });
  };

  // The school box is debounced into the URL; a one-letter query is not sent.
  useEffect(() => {
    const current = params.get('school') || '';
    const wanted = school.length >= 2 ? school : '';
    if (wanted !== current) update({ school: wanted });
  }, [school]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    api.facets(sport, { includeInactive }).then((f) => { if (live) setFacets(f); }).catch(() => { if (live) setFacets(null); });
    return () => { live = false; };
  }, [sport, includeInactive]);

  const query = useMemo(() => ({
    sport, classYear, division, conference, school: params.get('school') || '', sort, page, includeInactive,
  }), [sport, classYear, division, conference, params, sort, page, includeInactive]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    api.list(query)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) { setError(e.message); setData(null); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [query]);

  const effectiveClass = data?.filters?.classYear ?? facets?.defaultClassYear ?? null;
  const conferences = (facets?.conferences ?? []).filter((c) => !division || c.division === division);
  const conferenceGroups = conferences.reduce((m, c) => {
    (m[c.division] = m[c.division] || []).push(c);
    return m;
  }, {});
  const workspaceHref = (id) => `/programmes/${encodeURIComponent(id)}${effectiveClass ? `?classYear=${effectiveClass}` : ''}`;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Programme Database</h1>
          <p className="text-sm text-muted-foreground">Every programme Thriv3 holds, by sport, with projected openings for a recruiting class.</p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link to="/colleges/roster-gaps" className="text-primary hover:underline" data-testid="roster-gaps-link">Roster gaps queue</Link>
          <Link to="/colleges/season-trust" className="text-primary hover:underline" data-testid="season-trust-link">Season trust queue</Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Sport">
        {SPORTS.map((s) => (
          <Button
            key={s.id}
            size="sm"
            variant={sport === s.id ? 'default' : 'outline'}
            aria-pressed={sport === s.id}
            onClick={() => update({ sport: s.id === DEFAULTS.sport ? '' : s.id, division: '', conference: '' })}
          >
            {s.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
        <Select label="Recruiting class" value={classYear || String(facets?.defaultClassYear ?? '')} onChange={(v) => update({ classYear: v === String(facets?.defaultClassYear) ? '' : v })} testid="filter-class">
          {(facets?.classYears ?? []).map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        <Select label="Division" value={division} onChange={(v) => update({ division: v, conference: '' })} testid="filter-division">
          <option value="">All divisions</option>
          {(facets?.divisions ?? []).map((d) => <option key={d.division ?? 'none'} value={d.division ?? ''}>{d.division ?? 'No division'} ({d.n})</option>)}
        </Select>
        {/*
          One option per conference IDENTITY within a division (the server folds
          spellings like "Sooner" / "Sooner Athletic Conference" together through
          the canonical conference register). Options are per division, so
          choosing one also sets its division - the count shown is that
          division's.
        */}
        <Select
          label="Conference"
          value={conference ? `${division}${CONF_SEP}${conference}` : ''}
          onChange={(v) => {
            if (!v) return update({ conference: '' });
            const [div, value] = v.split(CONF_SEP);
            return update({ division: div, conference: value });
          }}
          testid="filter-conference"
        >
          <option value="">All conferences</option>
          {Object.entries(conferenceGroups).map(([div, list]) => (
            <optgroup key={div} label={div}>
              {list.map((c) => (
                <option key={`${div}-${c.value}`} value={`${div}${CONF_SEP}${c.value}`} title={c.spellings?.length > 1 ? `Stored as: ${c.spellings.join(', ')}` : undefined}>
                  {c.label} ({c.n})
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground col-span-2 md:col-span-1">
          School
          <Input value={schoolDraft} onChange={(e) => setSchoolDraft(e.target.value)} placeholder="Name or alias" data-testid="filter-school" />
        </label>
        <Select label="Sort by" value={sort} onChange={(v) => update({ sort: v === DEFAULTS.sort ? '' : v })} testid="filter-sort">
          {Object.entries(SORT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-xs text-muted-foreground h-9">
          <input type="checkbox" checked={includeInactive} onChange={(e) => update({ includeInactive: e.target.checked ? '1' : '' })} data-testid="filter-inactive" />
          Include inactive
        </label>
      </div>

      {schoolDraft.trim().length === 1 && <p className="text-xs text-muted-foreground">Type at least 2 characters to search for a school.</p>}

      {data && (
        <p className="text-xs text-muted-foreground" data-testid="class-caveat">
          {classCaveat({ classYear: data.filters.classYear, rosterSeason: data.rosterSeason })}
        </p>
      )}

      {error && <p className="text-sm text-destructive" data-testid="programmes-error">{error}</p>}

      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">School</th>
              <th className="text-left px-3 py-2">Division</th>
              <th className="text-left px-3 py-2">Conference</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Program strength</th>
              <th className="text-left px-3 py-2">Academic</th>
              <th className="text-left px-3 py-2">Projected openings ({effectiveClass ?? '…'})</th>
            </tr>
          </thead>
          <tbody data-testid="programme-rows">
            {(data?.programmes ?? []).map((p) => (
              <tr key={p.id} className="border-t border-border align-top" data-testid={`programme-row-${p.id}`}>
                <td className="px-3 py-2">
                  <Link to={workspaceHref(p.id)} className="font-medium hover:underline">{p.name}</Link>
                  {(p.city || p.state) && <div className="text-xs text-muted-foreground">{[p.city, p.state].filter(Boolean).join(', ')}</div>}
                </td>
                <td className="px-3 py-2"><Badge>{p.division ?? 'No division'}</Badge></td>
                <td className="px-3 py-2 text-xs">{p.conference ?? <span className="text-muted-foreground">Not recorded</span>}</td>
                <td className="px-3 py-2"><StatusCell p={p} /></td>
                <td className="px-3 py-2 text-xs">{strengthText(p.programStrength)}</td>
                <td className="px-3 py-2 text-xs">{p.academicRating != null ? `${p.academicRating}/10` : <span className="text-muted-foreground">Not established</span>}</td>
                <td className="px-3 py-2">
                  {p.assessed
                    ? (
                      <>
                        <Departures departures={p.departures} notes={false} />
                        {p.windowExhausted && <p className="text-[11px] text-amber-500" title={WINDOW_EXHAUSTED_NOTE}>Set by the eligibility window</p>}
                      </>
                    )
                    : <span className="text-xs text-muted-foreground">Not assessed: inactive programme</span>}
                </td>
              </tr>
            ))}
            {!loading && data && data.programmes.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground" data-testid="programmes-empty">No programme matches these filters.</td></tr>
            )}
            {loading && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">Loading programmes…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {data && (
        <div className="flex items-center justify-between text-sm" data-testid="pagination">
          <span className="text-muted-foreground">
            {data.total} programme{data.total === 1 ? '' : 's'} · page {data.page} of {data.pages}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={data.page <= 1} onClick={() => update({ page: data.page - 1 }, { keepPage: true })}>Previous</Button>
            <Button size="sm" variant="outline" disabled={data.page >= data.pages} onClick={() => update({ page: data.page + 1 }, { keepPage: true })} data-testid="next-page">Next</Button>
          </div>
        </div>
      )}
      <p className={cn('text-[11px] text-muted-foreground')}>
        GK, DEF, MID, FWD: places a current player's eligibility vacates before the class arrives. "Not established" means Thriv3 could not count them - no roster, no eligibility rule for the association, or too little of the roster could be read - never zero.
      </p>
    </div>
  );
}
