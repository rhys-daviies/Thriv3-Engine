import React, { useState } from 'react';
import { Sparkles, Search, CheckCircle2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import CollegeCard from '@/components/CollegeCard';
import CriteriaRanking from '@/components/CriteriaRanking';
import EmailComposer from '@/components/EmailComposer';
import BulkEmailComposer from '@/components/BulkEmailComposer';
import SpecificSearch from '@/components/SpecificSearch';
import SpecificSchools from '@/components/SpecificSchools';
import ProgrammeRelationship from '@/components/ProgrammeRelationship';
import SuppressedProgrammes from '@/components/SuppressedProgrammes';
import ManualOutreachDialog from '@/components/ManualOutreachDialog';
import { BOTH_PATHS_HINT } from '@/lib/outreachLabels';
import ProgrammeContactSummary from '@/components/ProgrammeContactSummary';
import { CONTACT_UNAVAILABLE_NOTICE } from '@/lib/outreachLabels';
import { contactIntelligenceKey } from '@shared/contactIntelligenceKey.js';
import { DEFAULT_SPORT } from '@shared/sportProfiles.js';
import { useContactIntelligence, CONTACT_INTELLIGENCE } from '@/lib/useContactIntelligence';
import { pickBestContact } from '@shared/coachRoles.js';
import { entities } from '@/api/client';
import { cn } from '@/lib/utils';
import { useMatchingSummary, recruitingSignalsForCollege } from '@/lib/useMatchingSummary';
import { usePlayerWorkspace } from './PlayerWorkspace';
import ActionableRecommendationsState, { isActionablePending } from '@/components/ActionableRecommendationsState';

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
  const {
    player, setPlayer, recommendations, summary, analyzing, phase, progress, page, setPage, onAnalyze,
    // Derived once in PlayerWorkspace and shared by every tab that claims to
    // show this athlete's recommendation set — see
    // src/lib/useActionableRecommendations.js.
    actionableRecommendations, actionableStatus, reload,
    programmes: relationships, specific, byCollegeId, byCollegeName,
    loading: programmesLoading, failed: programmesFailed,
    pending, error: programmeError, clearError, add, withdraw,
    flag, unflag, setVisibility, saveNote,
  } = usePlayerWorkspace();
  const [emailTarget, setEmailTarget] = useState(null);
  /**
   * The relationship being written to by hand, addressed by its own id so the
   * dialog resolves the programme, the staff and the contact stance from the
   * server rather than from whatever this page is holding.
   */
  const [manualTarget, setManualTarget] = useState(null);

  /**
   * ONE REQUEST FOR THE WHOLE ATHLETE, read by every card on every page.
   *
   * Not per card, and not per page of cards: a hundred programmes would be a
   * hundred requests, and paging would change the count. Cards do a Map lookup
   * and a miss means nobody has written to that programme.
   *
   * It needs NO relationship — the history is keyed on the programme, so a
   * recommendation nobody has flagged still shows that it was emailed last
   * week, without a row being created to say so.
   */
  const {
    byProgramme: contactByProgramme, status: contactStatus, reload: reloadContact,
  } = useContactIntelligence(player?.id);
  /**
   * UNKNOWN, NOT NONE. An absent programme means "no history" when the load
   * succeeded and "we could not find out" when it did not. The difference is
   * announced once, in the page notice below; the surfaces receive this only
   * so they can WITHHOLD what they would otherwise show, never so they can
   * each repeat that something failed.
   */
  const contactUnavailable = contactStatus === CONTACT_INTELLIGENCE.FAILED;
  /**
   * THE SPORT THESE RECOMMENDATIONS ARE FOR, and half of every programme key.
   *
   * `analyze()` scouts colleges filtered by `player.sport || DEFAULT_SPORT`, so
   * every card on this list is that sport whether or not the athlete record
   * spells it out. Relationship rows carry their own `sport` column and are
   * looked up with that instead — the surfaces do not assume they match.
   */
  const athleteSport = player?.sport || DEFAULT_SPORT;
  const [showBulk, setShowBulk] = useState(false);
  /**
   * MATCH PRIORITIES HAS NO VISIBLE TRIGGER ANY MORE, AND IS NOT DELETED.
   *
   * Specific Search replaced it as this tab's entry point. Nothing sets
   * `showPriorities` to true, so `CriteriaRanking` does not render — which is
   * deliberate twice over: the agreed product direction is that this is no
   * longer the operator's way in here, and the component throws on its first
   * render on `main` today (`previewing` is read in a useMemo at
   * CriteriaRanking.jsx:38 and declared with `const` nine lines below it,
   * introduced in a139ab0). Exposing a control that crashes would be worse
   * than exposing none.
   *
   * The state, the handler and the render stay so that relocating priorities
   * is moving one block with a new trigger, rather than rebuilding a feature
   * from its git history. The crash is recorded as a separate cleanup item and
   * is deliberately NOT fixed here.
   */
  const [showPriorities] = useState(false);
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

  /**
   * THE ACTIONABLE HUNDRED. Derived in the workspace, not here, so Decision,
   * Evidence and Philosophy read the same list rather than three subtly
   * different ones. `recommendations` remains the model's untouched answer and
   * is still on the context for anything that needs it.
   */
  const visible = actionableRecommendations;

  const totalPages = visible ? Math.ceil(visible.length / PAGE_SIZE) : 0;
  const pageItems = visible ? visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];
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

  /**
   * THE RELATIONSHIP FOR A RANKED PROGRAMME, BY ID WHERE THERE IS ONE.
   *
   * Both maps come from the same per-athlete fetch, so both are already scoped
   * to this athlete and their sport. What the id buys is identity: a
   * relationship stores the `college_id` it resolved against, and a
   * recommendation carries the same `colleges` row id, so matching on it cannot
   * be fooled by two programmes sharing a name. The name is the fallback for
   * the rows whose `college_id` is null — the column is nullable, and a
   * relationship with no registry row is still a relationship.
   *
   * NULL IS A REAL ANSWER and the common one: most ranked programmes have no
   * relationship, and that is what keeps the relationship-scoped workflow off
   * cards it would have to invent a row for.
   */
  const relationshipFor = (college) => (college?.id && byCollegeId.get(college.id))
    || byCollegeName.get(college?.name)
    || null;

  /**
   * ONE DIALOG FOR THE WHOLE TAB, and every surface routes to it.
   *
   * Specific Schools, the relationship footer on a ranked card, and the
   * removed-programmes panel all call this with a relationship ROW; what is
   * kept is its id, so the dialog re-reads the programme, the staff and the
   * contact stance from the server rather than trusting whatever this page was
   * holding. Mounting a dialog per card would be twenty instances on a page.
   */
  const openManualOutreach = (relationship) => setManualTarget(relationship?.id ?? null);

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
          THE ENTRY POINT ON THIS ROW, and the only one. It replaced the
          priorities control that used to sit here; that control has no visible
          trigger anywhere in this tab any more. See the note on
          `showPriorities` above for what survives and why.
        */}
        <Button size="sm" variant={showSearch ? 'default' : 'outline'} onClick={openSpecificSearch}>
          <Search className="h-3.5 w-3.5 mr-1.5" />
          Specific Search
        </Button>
      </div>

      {/*
        ONE NOTICE AND ONE RETRY, AT THE PAGE, AND NOWHERE ELSE.

        The request is athlete-level: one call answers for every programme on
        screen, so a failure is a fact about this page rather than about any
        school on it. Said per card it would be twenty identical sentences,
        each one reading as a claim about the programme it sat under, and a
        retry per card would be twenty ways to make the same request.

        So the unknown state lives here, and while it stands the cards withhold
        contact intelligence entirely — no summary, and no marker either.
      */}
      {contactUnavailable && (
        <div
          className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5"
          role="status"
        >
          <p className="text-xs text-muted-foreground">{CONTACT_UNAVAILABLE_NOTICE}</p>
          <Button size="sm" variant="outline" onClick={() => reloadContact()}>Try again</Button>
        </div>
      )}

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
          onManualOutreach={openManualOutreach}
          contactByProgramme={contactByProgramme}
          contactUnavailable={contactUnavailable}
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

      {/*
        THE RECOMMENDED VIEW WAITS. The tab bar and Specific Search stay put —
        they do not depend on visibility — but the ranked cards are not drawn
        until the athlete's own decisions are known, because drawing them early
        means drawing a school that was removed.
      */}
      {recommended && recommendations && !analyzing && isActionablePending(actionableStatus) && (
        <ActionableRecommendationsState status={actionableStatus} onRetry={reload} />
      )}

      {recommended && recommendations && !analyzing && !isActionablePending(actionableStatus) && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Button size="sm" onClick={() => setShowBulk(true)} disabled={headCoachCount === 0}>
              <Mail className="h-3.5 w-3.5 mr-1.5" />
              Message all head coaches
              <span className="ml-1.5 opacity-70">({headCoachCount})</span>
            </Button>
          </div>

          {/*
            NO TRIGGER, AND THAT IS THE POINT. `showPriorities` is never set
            true, so this panel does not render — see the note on the state
            declaration above for why the whole wiring is kept rather than
            deleted. Relocating priorities means giving this block a new home
            and a new trigger, not rebuilding it.
          */}
          {showPriorities && (
            <CriteriaRanking player={player} onApply={applyRanking} busy={analyzing} />
          )}

          {/*
            The way back. Removing a school takes its card — and the control
            that would restore it — off the page, so the decision would
            otherwise be one-way.
          */}
          <SuppressedProgrammes
            suppressed={relationships.filter((p) => p.visibility === 'suppressed')}
            pending={pending}
            onRestore={setVisibility}
            onManualOutreach={openManualOutreach}
            contactByProgramme={contactByProgramme}
            contactUnavailable={contactUnavailable}
          />

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
                /*
                  Only where both paths are reachable at once. A card with no
                  relationship has one way to write to it and needs no sentence
                  telling it apart from a button that is not there.
                */
                outreachHint={relationshipFor(college) ? BOTH_PATHS_HINT : null}
                footer={(
                  <>
                  {/*
                    SHOWN WHETHER OR NOT A RELATIONSHIP EXISTS. Prior outreach
                    is a fact about the programme, and surfacing it creates
                    nothing — no row is written to say a school was emailed.
                  */}
                  <ProgrammeContactSummary
                    summary={contactByProgramme.get(contactIntelligenceKey(college.name, athleteSport))}
                    withhold={contactUnavailable}
                    className="mt-3 pt-3 border-t border-border"
                  />
                  <ProgrammeRelationship
                    collegeName={college.name}
                    collegeId={college.id}
                    relationship={relationshipFor(college)}
                    busy={pending === college.id}
                    error={programmeError?.collegeId === college.id ? programmeError : null}
                    promotedFrom={college.promoted ? college.source_rank : null}
                    onFlag={flag}
                    onUnflag={unflag}
                    onSetVisibility={setVisibility}
                    onSaveNote={saveNote}
                    onManualOutreach={openManualOutreach}
                  />
                  </>
                )}
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

      {manualTarget && (
        <ManualOutreachDialog
          player={player}
          relationshipId={manualTarget}
          open={!!manualTarget}
          onOpenChange={(v) => !v && setManualTarget(null)}
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
