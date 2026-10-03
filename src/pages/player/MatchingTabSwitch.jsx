import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MatchingTab from './MatchingTab';
import MatchmakingV2Panel from '@/components/matchmaking/MatchmakingV2Panel';
import { usePlayerWorkspace } from './PlayerWorkspace';
import { matchmakingVersion, MATCHING_V1, MATCHING_V2 } from '@/lib/matchmakingVersion';

/**
 * WHICH MATCHING TAB THE ROUTE RENDERS — §T.
 *
 * ===========================================================================
 * THE SWITCH IS HERE SO THAT V1 IS NOT TOUCHED AT ALL.
 *
 * The obvious place for a feature switch is inside `MatchingTab`, and it is
 * the wrong one. That file is 709 lines of V1 behaviour with its own suites —
 * matchingTabSignals, actionableSurfaces, outreachPathClarity,
 * manualOutreachEntryPoints and more — and every one of them mounts it with no
 * query parameters. A switch inside it would default those suites onto V2 and
 * they would have to be edited to keep asserting what they already prove.
 *
 * Editing a dozen V1 tests to accommodate a rollout switch is how "V1 is
 * unchanged" stops being checkable. So the branch is one level up: the V1 file
 * and its tests are byte-identical to what they were before A9.3, which is the
 * strongest form of the claim §T asks for and the cleanest rollback.
 * ===========================================================================
 */
export default function MatchingTabSwitch() {
  const [searchParams] = useSearchParams();
  const version = matchmakingVersion(searchParams);
  const { player } = usePlayerWorkspace();

  if (version === MATCHING_V1) {
    return (
      <div className="space-y-4">
        {/*
          WHICH SCREEN THIS IS, said out loud during the rollout. An operator
          comparing two engines on one athlete has to be able to tell at a
          glance which one answered, and a consultant who reached V1 from a
          shared link should not think V2 simply looks like this.
        */}
        <div
          className="rounded-lg border border-border p-2.5 flex items-center justify-between gap-2 flex-wrap"
          data-testid="v1-fallback-notice"
        >
          <p className="text-xs text-muted-foreground">
            Showing the previous matching engine for this athlete.
          </p>
          <Button size="sm" variant="outline" asChild>
            <Link to="?matching=v2">Switch to Matcher V2</Link>
          </Button>
        </div>
        <MatchingTab />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/*
        SPECIFIC SCHOOLS IS NOT REBUILT HERE, AND IS NOT LOST EITHER.

        It lives inside the V1 tab, wired to the workspace's relationship
        helpers, and A9.5 owns bringing it onto the V2 run — the brief is
        explicit that A9.3 does not replace it. Removing the only route to it
        for the length of the rollout would be a functional regression dressed
        up as scope discipline, so the one control that reaches it is kept,
        pointing at the screen that still has it.
      */}
      <div className="flex items-center justify-end">
        <Button size="sm" variant="outline" asChild>
          <Link to={`?matching=${MATCHING_V1}`}>
            <Search className="h-3.5 w-3.5 mr-1.5" />
            Specific Schools (previous engine)
          </Link>
        </Button>
      </div>
      <MatchmakingV2Panel player={player} />
    </div>
  );
}

export { MATCHING_V1, MATCHING_V2 };
