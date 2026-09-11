import React, { useState } from 'react';
import { Sparkles, Search, CheckCircle2, SlidersHorizontal, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import CollegeCard from '@/components/CollegeCard';
import CriteriaRanking from '@/components/CriteriaRanking';
import EmailComposer from '@/components/EmailComposer';
import BulkEmailComposer from '@/components/BulkEmailComposer';
import SpecificSearch from '@/components/SpecificSearch';
import SpecificSchools from '@/components/SpecificSchools';
import { pickBestContact } from '@shared/coachRoles.js';
import { entities } from '@/api/client';
import { cn } from '@/lib/utils';
import { useMatchingSummary, recruitingSignalsForCollege } from '@/lib/useMatchingSummary';
import { useAthleteProgrammes } from '@/lib/useAthleteProgrammes';
import { usePlayerWorkspace } from './PlayerWorkspace';

const PAGE_SIZE = 20;
const MAX_PAGE_BUTTONS = 5;

/**
 * TWO LISTS, ONE SCREEN, AND THEY ARE NOT THE SAME KIND OF THING.
 *
 *   recommended  what the matching engine ranked. The Top 100.
 *   specific     what somebody ASKED FOR. A relationship, not a rank.
 *
 * Kept apart rather than merged, because a school is in the second list
 * because an athlete mentioned it and giving that a match score would be a
 * number the engine never produced. Nothing in the Specific Schools view
 * writes to the stored analysis, its reserve, or any campaign.
 */
const VIEWS = Object.freeze([
  { key: 'recommended', label: 'Recommended Matches' },
  { key: 'specific', label: 'Specific Schools' },
]);

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
  const [view, setView] = useState('recommended');
  const [showSearch, setShowSearch] = useState(false);

  /**
   * Relationship state, fetched once for the athlete rather than per view.
   *
   * It is NOT part of the stored analysis and never becomes part of it: these
   * rows live in `athlete_programmes`, and the only thing this tab does with
   * `recommendations` is read a rank off it to display alongside a specific
   * school that happens also to be ranked.
   */
  const {
    specific, byCollegeId, loading: programmesLoading, failed: programmesFailed,
    pending, error: programmeError, clearError, add, withdraw,
  } = useAthleteProgrammes(player?.id);

  /**
   * Opening the search also moves to the Specific Schools view, so a school
   * added from it lands somewhere the operator is already looking. Adding one
   * while the Recommended tab was in front would look like nothing happened.
   */
  function openSpecificSearch() {
    setView('specific');
    setShowSearch((v) => !v);
  }

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
   * Recruiting signals for the twenty programmes on THIS page, in ONE request.
   *
   * The page owns the fetch and the cards are handed their answer. A card that
   * fetched for itself would turn one request into twenty, and — worse — would
   * make the request count a function of how the page happens to be paginated,
   * which nothing downstream would notice going wrong.
   *
   * The page rather than the whole stored analysis: a hundred programmes is
   * five times the work for a screen showing twenty, and the operator pages
   * through them. `useMatchingSummary` keys its effect on the name list as
   * JSON, so changing page refetches and a response for the previous page is
   * discarded rather than merged; every lookup below is BY NAME, so even a
   * response that did survive could not be read as this page's — a name that
   * is not in it simply misses.
   *
   * Outreach evidence is deliberately NOT fetched here any more. The card
   * stopped showing it when Recruiting Signals arrived, and a fetch with no
   * consumer is twenty programmes of server work per page for nothing. The
   * composer, the bulk composer and the Evidence tab still call `useEvidence`
   * against the same route, which is where an email is actually written.
   */
  const {
    data: signalData, failed: signalsFailed,
  } = useMatchingSummary(player?.id, pageItems.map((c) => c.name));

  // Counted here as well as inside the dialog so the button says how many
  // programmes on this page actually have a head coach to write to, rather
  // than promising twenty and opening a list of twelve.
  const headCoachCount = pageItems.filter((c) => pickBestContact(c.coaching_staff)).length;

  /**
   * The Recommended view is the tab exactly as it was — same analysis panel,
   * same summary, same empty state, same cards, same paging. Everything below
   * is gated on it so that switching to Specific Schools does not leave the
   * ranked list half-rendered underneath a list it has nothing to do with.
   */
  const recommended = view === 'recommended';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div role="tablist" aria-label="Matching views" className="inline-flex rounded-lg border border-border p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={cn(
                'px-3 h-8 rounded-md text-xs font-medium transition-colors',
                view === v.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {v.label}
              {v.key === 'specific' && specific.length > 0 && (
                <span className="ml-1.5 opacity-70">({specific.length})</span>
              )}
            </button>
          ))}
        </div>

        {/*
          THE PRIMARY CONTROL ON THIS ROW, where "Match priorities" used to be.
          Priorities have not gone anywhere — see the secondary control in the
          Recommended view below — they are simply no longer the thing an
          operator reaches for first here.
        */}
        <Button size="sm" variant={showSearch ? 'default' : 'outline'} onClick={openSpecificSearch}>
          <Search className="h-3.5 w-3.5 mr-1.5" />
          Specific Search
        </Button>
      </div>

      {showSearch && (
        <SpecificSearch
          sport={player?.sport}
          programmes={byCollegeId}
          onAdd={add}
          pending={pending}
          addError={programmeError}
          onDismissAddError={clearError}
        />
      )}

      {view === 'specific' && (
        <SpecificSchools
          specific={specific}
          recommendations={recommendations}
          loading={programmesLoading}
          failed={programmesFailed}
          pending={pending}
          error={programmeError}
          onRemove={withdraw}
        />
      )}

      {recommended && analyzing && (
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

      {recommended && summary && !analyzing && (
        <div className="rounded-xl bg-primary/5 border border-primary/10 p-4 text-sm">{summary}</div>
      )}

      {recommended && !recommendations && !analyzing && (
        <div className="text-center py-20">
          <Sparkles className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Click "Find Matches" to run the AI match analysis.</p>
        </div>
      )}

      {recommended && recommendations && !analyzing && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Button size="sm" onClick={() => setShowBulk(true)} disabled={headCoachCount === 0}>
              <Mail className="h-3.5 w-3.5 mr-1.5" />
              Message all head coaches
              <span className="ml-1.5 opacity-70">({headCoachCount})</span>
            </Button>
            {/*
              KEPT, DEMOTED, NOT DELETED. CriteriaRanking and `applyRanking`
              are untouched; this control is simply no longer the primary
              button on the row above. Losing the only way to re-rank an
              athlete would be a regression, not a relocation, so it lives
              here until it has a permanent home.
            */}
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setShowPriorities((v) => !v)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
              {showPriorities ? 'Hide priorities' : 'Match priorities'}
            </Button>
          </div>

          {showPriorities && (
            <CriteriaRanking player={player} onApply={applyRanking} busy={analyzing} />
          )}

          {/*
            A FAILED REQUEST IS SAID ONCE, HERE.
            The request covers the whole page, so its failure is a fact about
            the page and not about any programme on it. Said per card it would
            be the same sentence twenty times, and each copy would look like a
            statement about the school it sat under. Per-programme
            `unavailable` — one roster the generator could not read while the
            other nineteen were fine — stays local to that card, because that
            one really is about that programme.
          */}
          {signalsFailed && (
            <p className="text-xs text-muted-foreground">
              Recruiting signals could not be loaded for these programmes.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {pageItems.map((college) => (
              <CollegeCard
                key={college.name}
                college={college}
                onEmailCoaches={setEmailTarget}
                playerId={player?.id}
                recruitingSignals={recruitingSignalsForCollege(signalData, college.name)}
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
