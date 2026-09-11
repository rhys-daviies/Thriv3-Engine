import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ACTIONABLE } from '@/lib/useActionableRecommendations';

/**
 * WHAT A TAB SHOWS WHILE IT DOES NOT YET KNOW WHAT IS ACTIONABLE.
 *
 * One component rather than the same two sentences in four tabs, and
 * deliberately NOT the whole state machine: `unanalysed` stays with each tab,
 * because "run the analysis first" is worded for the screen it appears on and
 * Philosophy's version carries its own illustration and a Find Matches button.
 * This owns only the two states every tab says identically.
 *
 * THE FAILURE CASE SHOWS NOTHING RATHER THAN THE RAW LIST. A relationship
 * fetch that failed means we cannot say which schools this athlete's operator
 * has taken out — and a ranked list assembled without that is not a degraded
 * answer, it is the exact list this feature exists to stop showing. Retry is
 * offered because there is already a retry path: the workspace's `reload`.
 */
export default function ActionableRecommendationsState({ status, onRetry }) {
  if (status === ACTIONABLE.LOADING) {
    return (
      <p className="text-sm text-muted-foreground flex items-center justify-center gap-2 py-16">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading this athlete&rsquo;s recommendations...
      </p>
    );
  }

  if (status === ACTIONABLE.FAILED) {
    return (
      <div className="py-16 text-center space-y-3">
        <p className="text-sm text-destructive" role="alert">
          This athlete&rsquo;s school list could not be loaded, so the recommendations are not
          shown &mdash; some of them may have been removed from this athlete&rsquo;s Top 100.
        </p>
        {onRetry && <Button size="sm" variant="outline" onClick={() => onRetry()}>Try again</Button>}
      </div>
    );
  }

  return null;
}

/** True for the two states this component owns. */
export function isActionablePending(status) {
  return status === ACTIONABLE.LOADING || status === ACTIONABLE.FAILED;
}
