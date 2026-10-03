import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
        THE LINK TO V1 IS GONE FROM HERE — A10 §H, §I.

        ===========================================================================
        ITS REASON IS SPENT, AND ITS PLACE WAS WRONG.

        It said "Requested schools & outreach (previous engine)" because the
        RELATIONSHIP work around a requested school — flag, note, contact
        stance, withdraw, manual outreach — lived only on the V1 tab. A10 moved
        all of it onto the V2 Specific Schools tab, against the same
        `athlete_programmes` rows, so the link now offers a second route to
        work that is already here. §H is explicit that a duplicate competing
        entry point needs a demonstrated workflow reason, and there is none.

        It also sat ABOVE "Generated", which §I does not allow: the four
        primary sections start the page.

        ROLLBACK IS UNAFFECTED. `?matching=v1` is the documented mechanism and
        still works, per request and not sticky, exactly as A9.3 defined it —
        removing a shortcut to it is not removing it. See
        src/lib/matchmakingVersion.js and the V1 rollback suites.
        ===========================================================================
      */}
      <MatchmakingV2Panel player={player} />
    </div>
  );
}

export { MATCHING_V1, MATCHING_V2 };
