import React from 'react';
import { Link } from 'react-router-dom';

/**
 * WHEN A "MORE VIEWS" PAGE HAS NO PREVIOUS-ENGINE LIST — Phase 5 (#6).
 *
 * Decision Evidence and Evidence list the programmes from the previous
 * matching engine's saved analysis. They used to say "Run the analysis on the
 * Matching tab first", but the Matching tab runs Matcher V2, which never
 * produces that list - so the instruction could not be followed. And "widen
 * the division or conference filters" named filters V2 does not have.
 *
 * This says what the view actually is, and where Matcher V2's equivalent
 * lives: each V2 match card opens Decision Evidence for its own programme.
 */
export default function PreviousEngineListNotice({ playerId, view = 'decision', empty = false }) {
  const what = view === 'decision' ? 'Decision Evidence' : 'Evidence';
  return (
    <div className="space-y-2 text-sm text-muted-foreground" data-testid="previous-engine-notice">
      <p>
        {empty
          ? `This list comes from the previous matching engine's saved analysis, which matched no programmes for this athlete.`
          : `This list comes from the previous matching engine, and this athlete has no saved analysis from it.`}
      </p>
      <p>
        Matcher V2&rsquo;s matches are on the Analysis &amp; Matching tab.
        {view === 'decision'
          ? ' Open a match card and choose “View full evidence” to see the Decision Evidence for that programme.'
          : ' Open a match card and choose “View full evidence” to see what is known about that programme.'}
      </p>
      {playerId && (
        <Link to={`/player/${encodeURIComponent(playerId)}/matching`} className="text-primary hover:underline" data-testid="previous-engine-notice-link">
          Go to Analysis &amp; Matching
        </Link>
      )}
      <span className="sr-only">{what}</span>
    </div>
  );
}
