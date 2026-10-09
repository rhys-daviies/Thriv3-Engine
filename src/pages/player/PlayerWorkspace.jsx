import React, { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Sparkles, MapPin, GraduationCap, Pencil, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { entities, integrations } from '@/api/client';
import { analyze } from '@/lib/playerAnalysis';
import { readReserve } from '@shared/matching/reserve.js';
import { useActionableRecommendations } from '@/lib/useActionableRecommendations';
import { matchmakingVersion, MATCHING_V1 } from '@/lib/matchmakingVersion';
import { cn } from '@/lib/utils';
import { positionDetailLabel } from '@shared/positions.js';

const TABS = [
  { segment: 'profile', label: 'Profile' },
  { segment: 'matching', label: 'Analysis & Matching' },
  { segment: 'engagement', label: 'Coach Engagement' },
  /**
   * F8. Always present, whether or not a campaign exists — a tab that appears
   * and disappears is harder to find than one that explains itself, and "this
   * athlete has no campaign running" is a thing an operator needs to be able to
   * check rather than infer from an absent tab.
   *
   * After Engagement because that is the order of the work: which programmes
   * fit, what engagement has happened, and then what outreach is running.
   */
  { segment: 'campaign', label: 'Campaign' },
  /**
   * 13J: the delivery surface. It lives here rather than on its own screen
   * because the athlete is already chosen and displayed above these tabs —
   * a second athlete picker is a second chance to send the wrong person's
   * report — and because report history is naturally per athlete.
   */
  { segment: 'reports', label: 'Reports' },
];

/**
 * SECONDARY VIEWS — Phase 3 (docs/IMMEDIATE_CHANGES_ROADMAP.md).
 *
 * Off the primary bar, not out of the product. Each keeps its route, its page
 * and every deep link into it (Decision Evidence's `?college=` preselect
 * included); they are one click away under "More views", and Decision
 * Evidence is also opened per programme from each V2 match card.
 */
export const MORE_VIEWS = Object.freeze([
  { segment: 'philosophy', label: 'Program Philosophy' },
  // Two evidence surfaces, named for the question each answers rather than
  // both being called "Evidence": this one is what an email would say, the one
  // below is the operator's assessment.
  { segment: 'evidence', label: 'Evidence' },
  { segment: 'decision', label: 'Decision Evidence' },
]);

export const PRIMARY_TABS = Object.freeze(TABS.map((t) => t.label));

/**
 * A small menu, not a dependency: a button that opens a list of links, closed
 * by Escape, by a click outside or by following one. When one of these views
 * is open the button carries the active colour and names it, so the operator
 * can still see where they are with no primary tab lit.
 */
function MoreViewsMenu({ playerId }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);
  const location = useLocation();
  const current = MORE_VIEWS.find((v) => location.pathname.endsWith(`/${v.segment}`)) ?? null;

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open]);

  return (
    <div className="relative ml-auto shrink-0" ref={ref} data-testid="more-views">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1 whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-medium transition-colors',
          current ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
        )}
        data-testid="more-views-button"
      >
        {current ? `More views: ${current.label}` : 'More views'}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 min-w-[12rem] rounded-md border border-border bg-card p-1 shadow-lg" data-testid="more-views-menu">
          {MORE_VIEWS.map(({ segment, label }) => (
            <NavLink
              key={segment}
              role="menuitem"
              to={`/player/${playerId}/${segment}`}
              className={({ isActive }) => cn(
                'block rounded px-3 py-2 text-sm hover:bg-muted',
                isActive ? 'text-primary' : 'text-foreground'
              )}
            >
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Stored analysis keyed by the recommendations pointer itself, so a fresh
 * analysis (new pointer) misses naturally and an edit elsewhere can never
 * serve stale results. Switching tabs re-renders children but never remounts
 * this component, so the fetch below runs once per player, not once per tab.
 */
const analysisCache = new Map();

function initials(name) {
  return (name || '').split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

async function loadStoredAnalysis(ref) {
  if (!ref) return null;
  if (analysisCache.has(ref)) return analysisCache.get(ref);

  const isUrl = typeof ref === 'string' && (ref.startsWith('http') || ref.startsWith('/'));
  let data;
  try {
    if (isUrl) {
      const res = await fetch(ref);
      data = await res.json();
    } else {
      data = JSON.parse(ref);
    }
  } catch {
    return null; // corrupt or missing stored analysis
  }

  const parsed = {
    recommendations: data.recommendations || data,
    // Carried through rather than dropped, so the cache and the file on disk
    // say the same thing. Absent on every analysis written before the reserve
    // existed, and on the legacy blobs that are a bare array — both read as
    // empty, which is the truth about them. See shared/matching/reserve.js.
    reserve: readReserve(data),
    summary: data.summary || '',
  };
  analysisCache.set(ref, parsed);
  return parsed;
}

/** Unknown tab segments land here rather than 404ing. */
export function TabFallback() {
  const { id } = useParams();
  return <Navigate to={`/player/${id}/profile`} replace />;
}

/** Tabs read shared player + analysis state from here instead of refetching. */
export function usePlayerWorkspace() {
  return useOutletContext();
}

export default function PlayerWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  /**
   * WHICH ENGINE THIS HEADER'S BUTTON BELONGS TO — A9.5 §P.
   *
   * Read through the same one-line switch the Matching route uses, so the
   * header and the tab beneath it can never disagree about which product the
   * operator is looking at.
   */
  const v1 = matchmakingVersion(searchParams) === MATCHING_V1;
  const [player, setPlayer] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [recommendations, setRecommendations] = useState(null);
  /**
   * Ranks 101-150, carried onto the context so the Matching tab can derive the
   * ACTIONABLE hundred — a programme an operator removed is replaced from
   * here. Never rendered on its own: the reserve is a replacement for
   * something taken out, not an extension of the list.
   */
  const [reserve, setReserve] = useState([]);
  const [summary, setSummary] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [phase, setPhase] = useState(0);
  const [progress, setProgress] = useState({ current: 0, total: 0, school: '' });
  const [page, setPage] = useState(1);
  const [saveError, setSaveError] = useState(null);

  /**
   * DERIVED ONCE, HERE, FOR EVERY TAB.
   *
   * `recommendations` and `reserve` stay exactly what the analysis produced.
   * `actionableRecommendations` is what the operator has decided to act on —
   * the same list on Matching, Decision, Evidence and Philosophy, so a school
   * removed from this athlete's Top 100 is removed from all four rather than
   * from whichever one happened to be looked at.
   */
  const {
    actionableRecommendations, actionableStatus, derived,
    programmes, specific, byCollegeId, byCollegeName,
    loading, settled, failed, pending, error, clearError,
    add, withdraw, apply, flag, unflag, setVisibility, setContactStance, saveNote, reload,
  } = useActionableRecommendations({ playerId: player?.id, recommendations, reserve });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let p;
      try {
        p = await entities.Player.get(id);
      } catch {
        // A deleted player, or a stale link to one — say so rather than
        // spinning forever on a rejected fetch.
        if (!cancelled) setNotFound(true);
        return;
      }
      if (cancelled) return;
      setPlayer(p);

      const stored = await loadStoredAnalysis(p.recommendations);
      if (cancelled || !stored) return;
      setRecommendations(stored.recommendations);
      setReserve(stored.reserve || []);
      setSummary(stored.summary);
    })();
    return () => { cancelled = true; };
  }, [id]);

  /**
   * `override` lets a caller run against a player it has just changed, rather
   * than against this component's copy. Saving a new criterion ranking and
   * immediately re-analysing would otherwise race the state update and rank
   * against the priorities the operator just replaced.
   */
  const handleAnalyze = useCallback(async (override) => {
    const subject = override && override.id ? override : player;
    if (!subject) return;
    navigate(`/player/${id}/matching`);
    setAnalyzing(true);
    setPhase(0);
    setPage(1);
    try {
      const result = await analyze(subject, { onPhase: setPhase, onProgress: setProgress });
      setRecommendations(result.recommendations);
      setReserve(readReserve(result));
      setSummary(result.summary);

      // Ranking and persisting are separate failures and only one of them was
      // ever visible. The results are already on screen by this point, so an
      // upload or a write that fails leaves the tab showing a full match list
      // that no longer exists anywhere — reload, and the athlete is back to
      // "Find Matches" with no clue why. Seen exactly once and not
      // reproduced, which is reason enough to make it announce itself.
      const blob = new Blob([JSON.stringify(result)], { type: 'application/json' });
      const file = new File([blob], `recommendations-${id}.json`, { type: 'application/json' });
      const { file_url } = await integrations.Core.UploadFile(file);
      analysisCache.set(file_url, {
        recommendations: result.recommendations,
        reserve: readReserve(result),
        summary: result.summary,
      });
      await entities.Player.update(id, { recommendations: file_url, status: 'Analyzed' });

      // Read back rather than trusting the write. The update is a partial one
      // and silently drops any column the entity does not declare, so a
      // successful request is not the same as a stored value.
      const saved = await entities.Player.get(id);
      if (saved?.recommendations !== file_url) {
        throw new Error('the analysis ran but did not save — re-run before sending anything from it');
      }
      setSaveError(null);
      setPlayer((prev) => ({ ...prev, recommendations: file_url, status: 'Analyzed' }));
    } catch (err) {
      setSaveError(err.message || String(err));
    } finally {
      setAnalyzing(false);
    }
  }, [player, id, navigate]);

  if (notFound) {
    return (
      <div className="text-center py-20">
        <p className="font-heading text-lg font-semibold">Player not found</p>
        <p className="text-sm text-muted-foreground mt-2">
          This player may have been deleted, or the link is out of date.
        </p>
        <Link to="/players" className="inline-block mt-4 text-sm text-primary hover:underline">
          Back to Players
        </Link>
      </div>
    );
  }

  if (!player) return <div className="text-sm text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <Link to="/players" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Players
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary font-heading text-lg font-bold">
            {initials(player.full_name)}
          </span>
          <div>
            <h1 className="font-heading text-2xl font-bold">{player.full_name}</h1>
            <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
              <span>{positionDetailLabel(player.position)}</span>
              <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{player.state || '—'}</span>
              <span className="flex items-center gap-1"><GraduationCap className="h-3.5 w-3.5" />Class of {player.recruiting_class_year || player.graduation_year || '—'}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Phase 5 (#12): from the matching tab, saving comes back to it rather than to Profile. */}
          <Button
            variant="outline"
            onClick={() => navigate(`/player/${id}/edit${location.pathname.endsWith('/matching') ? '?return=matching' : ''}`)}
            data-testid="edit-profile-button"
          >
            <Pencil className="h-4 w-4 mr-1.5" /> Edit Profile
          </Button>
          {/*
            THE HEADER BUTTON STOPS RANKING THINGS UNDER V2 — A9.5 §P.

            ===================================================================
            Under V2 this button NAVIGATES. It does not compute.

            `handleAnalyze` runs the V1 analysis in the browser, uploads a file
            and repoints `players.recommendations`. Leaving that as the most
            prominent control on a V2 screen meant the obvious button silently
            ran the OLD engine and overwrote V1's stored answer — while the tab
            below it showed a V2 run that the click had not touched. Two
            engines, one button, and no way for an operator to tell which one
            had just answered.

            Under V2 the act of ranking is explicit and lives where the results
            are: Generate Matches on an athlete with no run, Refresh Matches on
            a stale one. Both write an immutable, dated run. So this becomes
            what it now means — the way to the matches.

            V1 IS UNCHANGED AND IS NOT DELETED. Under `?matching=v1` this is
            byte-for-byte the previous control, calling the same handler, which
            is still on the context for the V1 tab that uses it.
            ===================================================================
          */}
          {v1 ? (
            <Button onClick={handleAnalyze} disabled={analyzing}>
              <Sparkles className="h-4 w-4 mr-1.5" />
              {recommendations ? 'Re-Analyze' : 'Find Matches'}
            </Button>
          ) : (
            <Button onClick={() => navigate(`/player/${id}/matching`)} data-testid="open-matches">
              <Sparkles className="h-4 w-4 mr-1.5" />
              Matches
            </Button>
          )}
        </div>
      </div>

      {/* Gold marks the active tab and nothing else in this bar. */}
      <div className="border-b border-border flex items-end gap-1">
        <nav className="flex gap-1 -mb-px overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Player workspace">
          {TABS.map(({ segment, label }) => (
            <NavLink
              key={segment}
              to={`/player/${id}/${segment}`}
              className={({ isActive }) => cn(
                'whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        {/* Outside the scrolling nav, so its menu is not clipped by overflow-x. */}
        <MoreViewsMenu playerId={id} />
      </div>

      {saveError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <strong>This analysis was not saved.</strong> {saveError}
        </p>
      )}

      {/*
        EVERY KEY NAMED, never spread.
        src/pages/player/workspaceContext.test.js reads this object as SOURCE
        TEXT to check that no tab destructures a key the workspace does not
        publish — the check that would have caught EvidenceTab reading a
        non-existent `analysis`. A spread here is invisible to that check, so
        the relationship helpers are listed out even though they arrive
        together.
      */}
      <Outlet context={{
        player,
        setPlayer,
        recommendations,
        reserve,
        summary,
        actionableRecommendations,
        actionableStatus,
        derived,
        programmes,
        specific,
        byCollegeId,
        byCollegeName,
        loading,
        settled,
        failed,
        pending,
        error,
        clearError,
        add,
        withdraw,
        apply,
        flag,
        unflag,
        setVisibility,
        setContactStance,
        saveNote,
        reload,
        analyzing,
        phase,
        progress,
        page,
        setPage,
        onAnalyze: handleAnalyze,
      }} />
    </div>
  );
}
