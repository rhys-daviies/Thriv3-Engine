import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Sparkles, Search, CheckCircle2, MapPin, GraduationCap, Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import CollegeCard from '@/components/CollegeCard';
import EmailComposer from '@/components/EmailComposer';
import { entities, integrations } from '@/api/client';

const PAGE_SIZE = 20;
const MAX_PAGE_BUTTONS = 5;

function initials(name) {
  return (name || '').split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function PhaseStep({ icon: Icon, title, description, active, done }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${done ? 'bg-emerald-500/10 text-emerald-600' : active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
        {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

/**
 * The Section 7 matching algorithm — three phases, run client-side against
 * the local College / GraduatingSenior data, exactly as documented:
 * scouting (hard filters + ±20 soccer-score band) -> researching (roster
 * cross-reference + weighted score) -> ranking & persistence.
 */
async function analyze(player, { onPhase, onProgress }) {
  const playerSport = player.sport || 'mens-soccer';

  // ---- Phase 1: Scouting ----
  onPhase(1);
  const allColleges = await entities.College.filter({ sport: playerSport });

  const soccerTarget = player.football_ability != null ? player.football_ability * 10 : null;
  const academicImportance = player.academic_importance !== 'Not Important' && player.academic_importance !== undefined
    ? parseFloat(player.academic_importance)
    : null;

  let filtered = allColleges;

  if (player.preferred_divisions && player.preferred_divisions.length > 0) {
    filtered = filtered.filter((c) => player.preferred_divisions.includes(c.division));
  }
  if (academicImportance != null && !Number.isNaN(academicImportance)) {
    filtered = filtered.filter((c) => c.academic_rating != null && c.academic_rating >= academicImportance);
  }
  if (soccerTarget != null) {
    filtered = filtered.filter(
      (c) => c.soccer_score != null && c.soccer_score >= soccerTarget - 20 && c.soccer_score <= soccerTarget + 20
    );
  }

  const filteredPrograms = filtered.map((c) => ({
    name: c.name,
    location: c.location,
    division: c.division,
    conference: c.conference,
    website_domain: c.website_domain,
    soccer_score: c.soccer_score,
    academic_rating: c.academic_rating,
    program_quality_rating: c.soccer_score != null ? c.soccer_score / 10 : null,
  }));

  onProgress({ current: 0, total: filteredPrograms.length, school: '', phase: 'scouting', loaded: filteredPrograms.length });

  // ---- Phase 2: Researching ----
  onPhase(2);
  const allRosters = await entities.GraduatingSenior.filter({ sport: playerSport });
  const rosterMap = {};
  for (const r of allRosters) rosterMap[r.college_name] = r;

  const targetPositionUpper = (player.position || '').toUpperCase();
  const results = [];
  let withRosterData = 0;

  for (let i = 0; i < filteredPrograms.length; i++) {
    const prog = filteredPrograms[i];
    try {
      const record = rosterMap[prog.name];
      let validatedPos = [];
      let validatedStarters = [];
      let totalGraduatingSeniors = 0;
      let allNames = [];
      let dataConfidence;
      let officialRosterUrl;
      let coachingStaff = [];
      let notes;
      let confirmedDivision;

      if (record) {
        withRosterData++;
        totalGraduatingSeniors = record.total_graduating_seniors || 0;
        allNames = record.all_graduating_senior_names || [];
        dataConfidence = record.data_confidence;
        officialRosterUrl = record.official_roster_url;
        coachingStaff = record.coaching_staff || [];
        notes = record.notes;
        confirmedDivision = record.confirmed_division;

        const posEntry = (record.position_data || []).find((pd) => (pd.position || '').toUpperCase() === targetPositionUpper);
        if (posEntry) {
          const allNamesLower = new Set(allNames.map((n) => n.trim().toLowerCase()));
          validatedPos = (posEntry.graduating_senior_names || []).filter((n) => allNamesLower.has(n.trim().toLowerCase()));
          const validatedPosLower = new Set(validatedPos.map((n) => n.trim().toLowerCase()));
          validatedStarters = (posEntry.graduating_starter_names || []).filter((n) => validatedPosLower.has(n.trim().toLowerCase()));
        }
      }

      const starterBonus = validatedStarters.length * 5;
      const positionBonus = validatedPos.length * 2;
      const soccerCloseness = soccerTarget != null && prog.soccer_score != null
        ? Math.max(0, 70 - Math.abs(prog.soccer_score - soccerTarget) * 3)
        : 60;
      const academicBonus = academicImportance != null && prog.academic_rating != null
        ? Math.min(15, 10 + (prog.academic_rating - academicImportance) * 2)
        : 10;
      const match_score = Math.min(100, Math.round(soccerCloseness + academicBonus + starterBonus + positionBonus));

      results.push({
        ...prog,
        total_graduating_seniors: totalGraduatingSeniors,
        all_graduating_senior_names: allNames,
        graduating_seniors_at_position: validatedPos.length,
        graduating_senior_names_at_position: validatedPos,
        graduating_starters_at_position: validatedStarters.length,
        graduating_starter_names_at_position: validatedStarters,
        data_confidence: dataConfidence,
        official_roster_url: officialRosterUrl,
        division: confirmedDivision || prog.division,
        match_score,
        position_need: validatedStarters.length > 0 ? 'High' : validatedPos.length > 0 ? 'Medium' : 'Low',
        reason: notes,
        coaching_staff: coachingStaff,
      });
    } catch {
      // school failed to score — log and skip, count still increments
    }

    if (i % 20 === 0 || i === filteredPrograms.length - 1) {
      onProgress({ current: i + 1, total: filteredPrograms.length, school: prog.name, phase: 'researching' });
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // ---- Phase 3: Ranking & Persistence ----
  onPhase(3);
  results.sort((a, b) => b.match_score - a.match_score);
  const top100 = results.slice(0, 100);
  const withStarters = top100.filter((r) => r.graduating_starters_at_position > 0).length;
  const summary = `Analyzed ${filteredPrograms.length} programs (${withRosterData} with roster data). Top ${top100.length} ranked by match score. ${withStarters} of the top ${top100.length} have graduating starters at the ${player.position} position.`;

  return { recommendations: top100, summary };
}

export default function PlayerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [player, setPlayer] = useState(null);
  const [recommendations, setRecommendations] = useState(null);
  const [summary, setSummary] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [phase, setPhase] = useState(0);
  const [progress, setProgress] = useState({ current: 0, total: 0, school: '' });
  const [page, setPage] = useState(1);
  const [emailTarget, setEmailTarget] = useState(null);

  useEffect(() => {
    (async () => {
      const p = await entities.Player.get(id);
      setPlayer(p);
      if (p.recommendations) {
        try {
          let data;
          const isUrl = typeof p.recommendations === 'string'
            && (p.recommendations.startsWith('http') || p.recommendations.startsWith('/'));
          if (isUrl) {
            const res = await fetch(p.recommendations);
            data = await res.json();
          } else {
            data = JSON.parse(p.recommendations);
          }
          setRecommendations(data.recommendations || data);
          setSummary(data.summary || '');
        } catch {
          // ignore corrupt/missing stored analysis
        }
      }
    })();
  }, [id]);

  async function handleAnalyze() {
    setAnalyzing(true);
    setPhase(0);
    setPage(1);
    try {
      const result = await analyze(player, {
        onPhase: setPhase,
        onProgress: setProgress,
      });
      setRecommendations(result.recommendations);
      setSummary(result.summary);

      const blob = new Blob([JSON.stringify(result)], { type: 'application/json' });
      const file = new File([blob], `recommendations-${id}.json`, { type: 'application/json' });
      const { file_url } = await integrations.Core.UploadFile(file);
      await entities.Player.update(id, { recommendations: file_url, status: 'Analyzed' });
      setPlayer((prev) => ({ ...prev, recommendations: file_url, status: 'Analyzed' }));
    } finally {
      setAnalyzing(false);
    }
  }

  if (!player) return <div className="text-sm text-muted-foreground">Loading...</div>;

  const totalPages = recommendations ? Math.ceil(recommendations.length / PAGE_SIZE) : 0;
  const pageItems = recommendations ? recommendations.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];
  const pageButtons = Array.from({ length: Math.min(totalPages, MAX_PAGE_BUTTONS) }, (_, i) => i + 1);

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

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4 text-center">
          <p className="text-xs text-muted-foreground">Divisions</p>
          <p className="font-semibold mt-1">{(player.preferred_divisions || []).join(', ') || 'Any'}</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-xs text-muted-foreground">GPA</p>
          <p className="font-semibold mt-1">{player.gpa ?? '—'}</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-xs text-muted-foreground">Budget</p>
          <p className="font-semibold mt-1">{player.budget_range || '—'}</p>
        </Card>
      </div>

      {analyzing && (
        <Card className="p-6 space-y-4">
          <PhaseStep icon={Search} title="Scouting" description={`Loading eligible programs for ${player.sport || 'mens-soccer'}...`} active={phase === 1} done={phase > 1} />
          <PhaseStep icon={Sparkles} title="Researching" description={phase === 2 ? `Scoring ${progress.school || '...'} (${progress.current}/${progress.total})` : 'Cross-referencing roster data'} active={phase === 2} done={phase > 2} />
          <PhaseStep icon={CheckCircle2} title="Ranking" description="Finalizing top matches" active={phase === 3} done={false} />
          {phase === 2 && progress.total > 0 && (
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
            </div>
          )}
        </Card>
      )}

      {summary && !analyzing && (
        <div className="rounded-xl bg-primary/5 border border-primary/10 p-4 text-sm">{summary}</div>
      )}

      {!recommendations && !analyzing && (
        <div className="text-center py-20">
          <Sparkles className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Click "Find Matches" to run the AI match analysis.</p>
        </div>
      )}

      {recommendations && !analyzing && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {pageItems.map((college) => (
              <CollegeCard key={college.name} college={college} onEmailCoaches={setEmailTarget} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              {pageButtons.map((n) => (
                <Button key={n} size="sm" variant={n === page ? 'default' : 'outline'} onClick={() => setPage(n)}>
                  {n}
                </Button>
              ))}
            </div>
          )}
        </>
      )}

      {emailTarget && (
        <EmailComposer
          player={player}
          college={emailTarget}
          open={!!emailTarget}
          onOpenChange={(open) => !open && setEmailTarget(null)}
        />
      )}
    </div>
  );
}
