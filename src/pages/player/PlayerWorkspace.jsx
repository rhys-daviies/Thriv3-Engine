import React, { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { ArrowLeft, Sparkles, MapPin, GraduationCap, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { entities, integrations } from '@/api/client';
import { analyze } from '@/lib/playerAnalysis';
import { cn } from '@/lib/utils';

const TABS = [
  { segment: 'profile', label: 'Profile' },
  { segment: 'matching', label: 'Analysis & Matching' },
  { segment: 'engagement', label: 'Coach Engagement' },
];

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
  const [player, setPlayer] = useState(null);
  const [recommendations, setRecommendations] = useState(null);
  const [summary, setSummary] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [phase, setPhase] = useState(0);
  const [progress, setProgress] = useState({ current: 0, total: 0, school: '' });
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await entities.Player.get(id);
      if (cancelled) return;
      setPlayer(p);

      const stored = await loadStoredAnalysis(p.recommendations);
      if (cancelled || !stored) return;
      setRecommendations(stored.recommendations);
      setSummary(stored.summary);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const handleAnalyze = useCallback(async () => {
    if (!player) return;
    navigate(`/player/${id}/matching`);
    setAnalyzing(true);
    setPhase(0);
    setPage(1);
    try {
      const result = await analyze(player, { onPhase: setPhase, onProgress: setProgress });
      setRecommendations(result.recommendations);
      setSummary(result.summary);

      const blob = new Blob([JSON.stringify(result)], { type: 'application/json' });
      const file = new File([blob], `recommendations-${id}.json`, { type: 'application/json' });
      const { file_url } = await integrations.Core.UploadFile(file);
      analysisCache.set(file_url, { recommendations: result.recommendations, summary: result.summary });
      await entities.Player.update(id, { recommendations: file_url, status: 'Analyzed' });
      setPlayer((prev) => ({ ...prev, recommendations: file_url, status: 'Analyzed' }));
    } finally {
      setAnalyzing(false);
    }
  }, [player, id, navigate]);

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
              <span>{player.position}</span>
              <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{player.state || '—'}</span>
              <span className="flex items-center gap-1"><GraduationCap className="h-3.5 w-3.5" />{player.graduation_year || '—'}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate(`/player/${id}/edit`)}>
            <Pencil className="h-4 w-4 mr-1.5" /> Edit Profile
          </Button>
          <Button onClick={handleAnalyze} disabled={analyzing}>
            <Sparkles className="h-4 w-4 mr-1.5" />
            {recommendations ? 'Re-Analyze' : 'Find Matches'}
          </Button>
        </div>
      </div>

      {/* Gold marks the active tab and nothing else in this bar. */}
      <div className="border-b border-border">
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
      </div>

      <Outlet context={{
        player, setPlayer,
        recommendations, summary,
        analyzing, phase, progress,
        page, setPage,
        onAnalyze: handleAnalyze,
      }} />
    </div>
  );
}
