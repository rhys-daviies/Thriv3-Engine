import React, { useState } from 'react';
import { Sparkles, Search, CheckCircle2, SlidersHorizontal, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import CollegeCard from '@/components/CollegeCard';
import CriteriaRanking from '@/components/CriteriaRanking';
import EmailComposer from '@/components/EmailComposer';
import BulkEmailComposer from '@/components/BulkEmailComposer';
import { pickBestContact } from '@shared/coachRoles.js';
import { entities } from '@/api/client';
import { useEvidence, evidenceForCollege } from '@/lib/useEvidence';
import { usePlayerWorkspace } from './PlayerWorkspace';

const PAGE_SIZE = 20;
const MAX_PAGE_BUTTONS = 5;

function PhaseStep({ icon: Icon, title, description, active, done }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${done ? 'bg-emerald-500/15 text-emerald-400' : active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
        {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export default function MatchingTab() {
  const { player, setPlayer, recommendations, summary, analyzing, phase, progress, page, setPage, onAnalyze } = usePlayerWorkspace();
  const [emailTarget, setEmailTarget] = useState(null);
  const [showBulk, setShowBulk] = useState(false);
  const [showPriorities, setShowPriorities] = useState(false);

  /**
   * Persist the ranking, then re-rank against the saved player rather than the
   * one in state — the update has not propagated yet, and ranking against the
   * priorities the operator just replaced is the obvious way to get this wrong.
   */
  async function applyRanking(ranking) {
    // Sent as an array, not a JSON string: criterion_ranking is a jsonField on
    // the player entity, so the server serialises it. Passing a string here
    // stores a JSON-encoded JSON string, which reads back as nonsense.
    await entities.Player.update(player.id, { criterion_ranking: ranking });
    const updated = { ...player, criterion_ranking: ranking };
    setPlayer(updated);
    await onAnalyze(updated);
  }

  const totalPages = recommendations ? Math.ceil(recommendations.length / PAGE_SIZE) : 0;
  const pageItems = recommendations ? recommendations.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];
  const pageButtons = Array.from({ length: Math.min(totalPages, MAX_PAGE_BUTTONS) }, (_, i) => i + 1);

  /**
   * Outreach evidence for the twenty programmes on THIS page, in one request.
   *
   * The page rather than the whole stored analysis: a hundred programmes is
   * five times the work for a screen showing twenty, and the operator pages
   * through them. `useEvidence` keys its effect on the joined names, so
   * changing page refetches; every lookup below is BY NAME, so the previous
   * page's response can never be read as this page's — a name that is not in
   * it simply misses, and `loading` covers the gap while the new one is in
   * flight.
   *
   * The composer and the Evidence tab call the same hook against the same
   * route. A second path to evidence would eventually disagree with the one
   * that sends the email.
   */
  const { evidence, loading: evidenceLoading, failed: evidenceFailed } = useEvidence(
    player?.id, pageItems.map((c) => c.name),
  );

  // Counted here as well as inside the dialog so the button says how many
  // programmes on this page actually have a head coach to write to, rather
  // than promising twenty and opening a list of twelve.
  const headCoachCount = pageItems.filter((c) => pickBestContact(c.coaching_staff)).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        {recommendations && !analyzing ? (
          <Button size="sm" onClick={() => setShowBulk(true)} disabled={headCoachCount === 0}>
            <Mail className="h-3.5 w-3.5 mr-1.5" />
            Message all head coaches
            <span className="ml-1.5 opacity-70">({headCoachCount})</span>
          </Button>
        ) : <span />}
        <Button size="sm" variant={showPriorities ? 'default' : 'outline'} onClick={() => setShowPriorities((v) => !v)}>
          <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
          {showPriorities ? 'Hide priorities' : 'Match priorities'}
        </Button>
      </div>

      {showPriorities && (
        <CriteriaRanking player={player} onApply={applyRanking} busy={analyzing} />
      )}

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
              <CollegeCard
                key={college.name}
                college={college}
                onEmailCoaches={setEmailTarget}
                evidence={evidenceForCollege(evidence, college.name)}
                evidenceLoading={evidenceLoading}
                evidenceFailed={evidenceFailed}
              />
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

      {showBulk && (
        <BulkEmailComposer
          player={player}
          colleges={pageItems}
          open={showBulk}
          onOpenChange={setShowBulk}
        />
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
