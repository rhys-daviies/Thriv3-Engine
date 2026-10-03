import React from 'react';
import { Badge } from '@/components/ui/badge';
import { preferenceSummary } from '@/lib/preferenceIntake';
import { majorPreference } from '@/lib/matchmakingV2View';

/**
 * THE ATHLETE'S STATED PREFERENCES, AS ACTIVE RANKING INPUTS — §L, §M.
 *
 * ===========================================================================
 * READ-ONLY, AND SAYING SO.
 *
 * A9.4 owns editing. The chip is NOT a filter control and carries no "×": a
 * removal affordance that did nothing, or that silently changed rankings
 * without a new run, would be worse than no control at all. The line beneath
 * says where these are changed, so the absence of a control here is an answer
 * rather than a dead end.
 *
 * -- THE MAJOR IS A PREFERENCE, NOT A REQUIREMENT ---------------------------
 *
 * This chip says what Thriv3 is weighting. It never says what an institution
 * offers. Thriv3 holds POSITIVE-ONLY major evidence — A8.2 proved
 * `notable_majors` records an institution's largest fields of study, with 321
 * of 349 D1 women's programmes omitting Mathematics — so absence from that
 * list establishes nothing, and the engine returns UNSCOREABLE rather than a
 * zero. Every sentence this screen can print about a major comes from the
 * engine's own refusal vocabulary; see FORBIDDEN_MAJOR_PHRASES.
 * ===========================================================================
 *
 * The three priorities come from `preferenceSummary`, which the Profile tab
 * already uses — including its "Not answered" wording. An unanswered priority
 * is NOT scored as a middle answer, and showing it as blank here while the
 * profile says "Not answered" would be two screens disagreeing.
 */
export default function MatchmakingPreferences({ player }) {
  const major = majorPreference(player);
  const preferences = preferenceSummary(player);

  return (
    <div className="rounded-lg border border-border p-3" data-testid="active-preferences">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Ranking preferences
      </p>
      <div className="flex items-center gap-1.5 flex-wrap">
        {/*
          WHAT IS ACTIVE READS LOUDEST, AND THE BROWSER SETTLED THIS.

          The first version gave an unanswered priority the primary colour and
          the stated major a quiet one, so a screen for an athlete with three
          unanswered priorities was three bright chips saying "Not answered"
          beside a dim one naming the preference actually doing the work —
          majorFit carries the largest preference weight in the engine.

          An unanswered priority still has to be VISIBLE: it is not scored as a
          middle answer, and the Profile tab shows it in italic muted for that
          reason. Same treatment here, so the two screens agree.
        */}
        {major && (
          <Badge data-testid="major-preference">{major.label}</Badge>
        )}
        {preferences.map((p) => (
          <Badge
            key={p.field}
            variant="muted"
            className={p.answered ? undefined : 'italic'}
            data-testid={`preference-${p.field}`}
          >
            {p.label}: {p.text}
          </Badge>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        These are the athlete&rsquo;s stated preferences, and they are part of how these
        matches were ranked. Change them in Edit Profile, then refresh matches.
      </p>
    </div>
  );
}
