import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, AlertCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useMatchmakingV2, MM2, MM2_BUSY, MM2_ERROR } from '@/lib/useMatchmakingV2';
import MatchmakingResults from './MatchmakingResults';
import MatchmakingRunBar from './MatchmakingRunBar';
import MatchmakingPreferences from './MatchmakingPreferences';
import MatchmakingSpecificSearch from './MatchmakingSpecificSearch';

/**
 * The family contribution is unanswered — §E.
 *
 * ===========================================================================
 * THIS IS NOT AN ERROR, AND THE SCREEN MUST NOT CALL IT ONE.
 *
 * `familyContribution()` returns null to mean REFUSE, and the engine will not
 * rank without a resolved contribution: an unanswered one is not zero, and
 * financial viability is 20% of Pursuit with a gate at 0.30/0.50 beneath it.
 * Assuming $0 would make every expensive programme look unaffordable and every
 * cheap one look safe, on an assumption nobody made.
 *
 * So this is a BLOCKING STATE with a route out of it — not a red banner, not
 * an empty list, and not a partial ranking with a caveat. The server agrees in
 * its own vocabulary: CONTRIBUTION_UNRESOLVED is a 409, chosen because nothing
 * about the request is wrong and nothing about the athlete is impossible.
 *
 * The CTA goes to Edit Profile, which already owns this question
 * (`contributionIntake`). A9.4 owns bringing that editing nearer; A9.3 points
 * at it rather than rebuilding it.
 * ===========================================================================
 */
function ContributionBlocked({ playerId }) {
  return (
    <Card className="p-6 space-y-3" data-testid="contribution-blocked">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
        <div className="space-y-2">
          <p className="font-heading font-semibold">
            Thriv3 needs the family&rsquo;s annual contribution first
          </p>
          <p className="text-sm text-muted-foreground">
            Matching cannot rank programmes until the family has said what they can
            contribute each year. Thriv3 does not assume a figure, and it does not treat
            an unanswered question as zero &mdash; a guess here would change which
            programmes look affordable.
          </p>
          {/*
            §H. `return=matching` completes the loop A9.3 left open: the
            operator is sent from here to answer one question and comes back
            HERE, where the button that produces a ranking is — rather than
            landing on the Profile tab and having to find their way back.

            The save still ranks nothing. Returning is navigation; generating
            is a decision, and it stays the operator's.
          */}
          <Button asChild size="sm">
            <Link to={`/player/${playerId}/edit?return=matching`}>Add the family contribution</Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * Everything else that can go wrong, told apart — §P.
 *
 * Each sentence names what happened AND what to do about it, because they
 * differ: a 422 is an incomplete athlete record, a 500 is ours and retrying is
 * reasonable, a dropped connection is worth retrying immediately, and a
 * missing athlete means the link is stale and no button helps.
 */
function Failure({ error, onRetry }) {
  const COPY = {
    [MM2_ERROR.PLAYER_NOT_FOUND]: {
      title: 'This athlete could not be found',
      body: 'They may have been deleted, or this link is out of date.',
      retry: false,
    },
    [MM2_ERROR.PROFILE_INVALID]: {
      title: 'This athlete’s profile is not ready for matching',
      body: error.message || 'Some required details are missing or inconsistent.',
      retry: false,
    },
    [MM2_ERROR.SIGNED_OUT]: {
      title: 'Your session has ended',
      body: 'Sign in again to see this athlete’s matches.',
      retry: false,
    },
    [MM2_ERROR.NETWORK]: {
      title: 'Thriv3 could not be reached',
      body: 'The request did not get through. Your results have not changed.',
      retry: true,
    },
    [MM2_ERROR.SERVER]: {
      title: 'Matching could not be completed',
      body: 'Something went wrong on our side. Nothing has been changed for this athlete.',
      retry: true,
    },
  }[error.kind] ?? {
    title: 'Matching could not be completed',
    body: error.message || 'An unexpected problem occurred.',
    retry: true,
  };

  return (
    <Card className="p-5 space-y-2" role="alert" data-testid={`failure-${error.kind}`}>
      <p className="font-heading font-semibold">{COPY.title}</p>
      <p className="text-sm text-muted-foreground">{COPY.body}</p>
      {COPY.retry && onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
      )}
    </Card>
  );
}

/**
 * THE MATCHMAKING V2 SCREEN.
 *
 * ===========================================================================
 * THE PERSISTED RUN IS WHAT THIS SHOWS. IT NEVER RECOMPUTES ON ITS OWN — §C.
 *
 * Load reads the latest persisted run. No run is an intentional empty state
 * with one button, not a spinner that eventually produces something. A stale
 * run KEEPS THE SCREEN with its reasons stated above it, because it is a true
 * record of what Thriv3 said and a consultant may be mid-conversation about
 * it. Refresh is a POST that writes a NEW immutable run; the old one is never
 * touched and stays readable by id.
 *
 * -- WHAT STAYS ON SCREEN WHILE WORK HAPPENS -------------------------------
 *
 * `busy` renders over the results rather than instead of them, so a refresh
 * that takes seconds does not blank a ranked list and then restore a nearly
 * identical one. A refresh that FAILS leaves the old run exactly where it was,
 * with the failure stated beside it — the hook does not clear `run` on a
 * generate error, and this is the surface that depends on it.
 * ===========================================================================
 */
export default function MatchmakingV2Panel({ player }) {
  const {
    run, status, busy, error, generate, refresh, reload,
  } = useMatchmakingV2(player?.id);
  const [searching, setSearching] = useState(false);

  /**
   * A contribution refusal replaces the screen only when there is nothing to
   * replace. With a run already loaded it is reported BESIDE the results —
   * the athlete's existing matches are still a true record, and taking them
   * away because a later recomputation was refused would destroy the thing the
   * operator came for.
   */
  const contributionBlocked = error?.kind === MM2_ERROR.CONTRIBUTION_UNRESOLVED;

  if (status === MM2.LOADING) {
    return (
      <div className="py-16 text-center" role="status" aria-live="polite">
        <p className="text-sm text-muted-foreground">Loading this athlete&rsquo;s matches…</p>
      </div>
    );
  }

  if (status === MM2.FAILED) {
    return contributionBlocked
      ? <ContributionBlocked playerId={player?.id} />
      : <Failure error={error} onRetry={reload} />;
  }

  if (status === MM2.NO_RUN) {
    if (contributionBlocked) return <ContributionBlocked playerId={player?.id} />;
    return (
      <div className="space-y-4">
        {error && <Failure error={error} onRetry={generate} />}
        <Card className="p-10 text-center space-y-3" data-testid="no-run">
          <Sparkles className="h-10 w-10 mx-auto text-muted-foreground" />
          <div className="space-y-1">
            <p className="font-heading font-semibold">No matches generated yet</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Thriv3 has not ranked programmes for this athlete. Generating matches
              creates a dated set of results that stays on record.
            </p>
            {/*
              §E. Said HERE rather than discovered by opening a search box that
              cannot answer. A specific school's rank only means anything inside
              a full universe — "#431 of 824" needs the 824 — so there is
              nothing honest to show for one programme until a run exists, and
              scoring one on its own is exactly what this must not do.
            */}
            <p className="text-xs text-muted-foreground max-w-md mx-auto" data-testid="no-run-search-note">
              Looking up a specific school also needs a run: a programme&rsquo;s rank only has
              meaning inside the full universe it was ranked against.
            </p>
          </div>
          <Button onClick={generate} disabled={busy === MM2_BUSY.GENERATING}>
            <Sparkles className="h-4 w-4 mr-1.5" />
            {busy === MM2_BUSY.GENERATING ? 'Generating matches…' : 'Generate matches'}
          </Button>
          {busy === MM2_BUSY.GENERATING && (
            <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
              Ranking every eligible programme. This can take a few seconds.
            </p>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <MatchmakingRunBar run={run} onRefresh={refresh} busy={busy === MM2_BUSY.REFRESHING} />

      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant={searching ? 'default' : 'outline'}
          onClick={() => setSearching((v) => !v)}
          aria-expanded={searching}
        >
          <Search className="h-3.5 w-3.5 mr-1.5" />
          Specific Search
        </Button>
      </div>

      {/*
        §C. The search reads the run that is ON SCREEN — `run` is handed to it
        rather than letting the server pick the current one, so a standing can
        never come from a newer run than the list the operator is reading.
      */}
      {searching && <MatchmakingSpecificSearch player={player} run={run} />}

      {contributionBlocked ? (
        <ContributionBlocked playerId={player?.id} />
      ) : error ? (
        <Failure error={error} onRetry={refresh} />
      ) : null}

      <MatchmakingPreferences player={player} run={run} />

      {/*
        THE PREVIOUS RUN STAYS VISIBLE AND STAYS READABLE while a new one is
        computed — §P. Dimmed and marked `aria-busy`, not unmounted: these are
        still the results of record until the server returns a new run.
      */}
      <div
        aria-busy={busy === MM2_BUSY.REFRESHING}
        className={busy === MM2_BUSY.REFRESHING ? 'opacity-60 transition-opacity' : undefined}
      >
        <MatchmakingResults run={run} />
      </div>
    </div>
  );
}
