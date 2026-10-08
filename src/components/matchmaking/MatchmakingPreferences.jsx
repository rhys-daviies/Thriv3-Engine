import React from 'react';
import { Link } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { preferenceSummary } from '@/lib/preferenceIntake';
import { contributionSummary } from '@/lib/contributionIntake';
import { academicIntentState, ACADEMIC_INTENT } from '@shared/academicMajors.js';
import { majorPreference, changedSinceRun } from '@/lib/matchmakingV2View';
import { positionSummary, recruitmentPreferenceRows, ROW_FIELDS } from '@/lib/recruitmentPreferenceView';

/**
 * THE INPUTS THIS RANKING WAS BUILT FROM — §L, §M, §N, §O.
 *
 * ===========================================================================
 * EVERY VALUE AND EVERY SENTENCE HERE COMES FROM THE CANONICAL INTAKE MODULES.
 *
 * `preferenceSummary` (the three priorities, including its "Not answered"
 * wording), `contributionSummary` (the three contribution states) and
 * `academicIntentState` (the four major states). Not one of them is restated
 * here. A second copy is how a screen comes to describe a state the scorer
 * cannot read — the exact failure `contributionIntake` and `preferenceIntake`
 * were written to prevent, and the reason `$40k+/yr` survived for so long as
 * an option that meant nothing.
 *
 * READ-ONLY, AND SAYING WHERE TO EDIT. A9.4 adds the route, not a second
 * editor: these questions are asked properly in Edit Profile, with labels,
 * radio groups and validation that this compact summary could only
 * approximate.
 * ===========================================================================
 */

/** Marks a field the operator has changed since this ranking was generated — §O. */
function ChangedMark({ when }) {
  if (!when) return null;
  return (
    <span className="ml-1 font-semibold" title="Changed since this ranking was generated">
      {/* A word, not a dot. §Q: no state is carried by a glyph or a colour alone. */}
      · changed
    </span>
  );
}

export default function MatchmakingPreferences({ player, run }) {
  const major = majorPreference(player);
  const preferences = preferenceSummary(player);
  const contribution = contributionSummary(player);
  const changed = changedSinceRun(player, run?.inputs ?? null);
  const intent = academicIntentState(player?.intended_major);
  const positions = positionSummary(player);
  const recruitment = recruitmentPreferenceRows(player);

  return (
    <div className="rounded-lg border border-border p-3" data-testid="active-preferences">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Ranking preferences
        </p>
        {/*
          §H. The route to where these are answered, carrying `return=matching`
          so a save comes back here rather than landing on the Profile tab —
          and comes back WITHOUT generating anything.
        */}
        <Button size="sm" variant="outline" asChild>
          <Link to={`/player/${player?.id}/edit?return=matching`}>
            <Pencil className="h-3 w-3 mr-1.5" />
            Edit inputs
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {/*
          FAMILY CONTRIBUTION IS FIRST — §N. It is the one input that can stop
          matchmaking entirely, and `needsAttention` is the state that does it.
          Its words are `contributionSummary`'s, which renders `$40k+/yr` as the
          band it is and never as a maximum.
        */}
        <Badge
          variant={contribution.needsAttention ? 'amber' : 'muted'}
          data-testid="preference-contribution"
        >
          {contribution.label}: {contribution.value}
          <ChangedMark when={changed.has('contribution_state') || changed.has('max_annual_contribution_usd')} />
        </Badge>

        {major && (
          <Badge data-testid="major-preference">
            {major.label}
            <ChangedMark when={changed.has('intended_major')} />
          </Badge>
        )}

        {preferences.map((p) => (
          <Badge
            key={p.field}
            variant="muted"
            /*
              §N, and A9.3 found this once already: an unanswered optional
              preference must not be the loudest thing on the row. Italic muted
              is the Profile tab's own treatment of the same state, so the two
              screens agree about what "Not answered" looks like.
            */
            className={p.answered ? undefined : 'italic'}
            data-testid={`preference-${p.field}`}
          >
            {p.label}: {p.text}
            <ChangedMark when={changed.has(p.field)} />
          </Badge>
        ))}
      </div>

      {/*
        POSITION AND RECRUITMENT PREFERENCES. The position badge names the
        group the ranking used, because a detailed position is finer than
        anything the matcher reads. Each preference says whether it was
        RANKED (location) or only CHECKED on the cards below, so a stated
        division can never be mistaken for a filter that ran.
      */}
      <div className="flex items-center gap-1.5 flex-wrap mt-1.5" data-testid="recruitment-preference-badges">
        {positions.primary && (
          <Badge variant="muted" data-testid="preference-position">
            Position: {positions.primary}
            {positions.rankedAs && positions.rankedAs !== positions.primary && ` (ranked as ${positions.rankedAs.toLowerCase()})`}
            {positions.secondary && `; also ${positions.secondary}, not ranked`}
            <ChangedMark when={changed.has('position')} />
          </Badge>
        )}
        {recruitment.map((r) => (
          <Badge
            key={r.field}
            variant="muted"
            className={r.stated ? undefined : 'italic'}
            data-testid={`preference-${r.field}`}
          >
            {r.label}: {r.text}
            {r.stated && <span className="text-muted-foreground">{r.ranked ? ' · ranked' : ' · checked'}</span>}
            <ChangedMark when={ROW_FIELDS[r.field].some((f) => changed.has(f))} />
          </Badge>
        ))}
      </div>

      {/*
        THE MAJOR IS SAVED AND THRIV3 CANNOT PLACE IT — §I, §J.

        The dangerous silence in this product. An athlete whose major reads
        "Sports Management" has `majorFit` go NOT_APPLICABLE, which costs no
        coverage and changes no ranking, so the screen looks exactly like one
        where the preference is working. The operator believes a preference is
        being applied that is doing nothing at all.

        The wording is the Evidence tab's, deliberately: same four states, same
        sentences, same suggestion to try the subject itself. And it says what
        THRIV3 cannot map — never what an institution does or does not offer.
      */}
      {intent === ACADEMIC_INTENT.UNSUPPORTED && (
        <p className="mt-2 text-[11px] text-amber-400" data-testid="major-unplaceable">
          &ldquo;{player.intended_major}&rdquo; is saved, but Thriv3 cannot currently map it to an
          academic family, so it is not affecting this ranking. Try the subject itself &mdash;
          &ldquo;business&rdquo;, &ldquo;exercise science&rdquo;, &ldquo;computer science&rdquo;.
        </p>
      )}
      {intent === ACADEMIC_INTENT.UNDECIDED && (
        <p className="mt-2 text-[11px] text-muted-foreground" data-testid="major-undecided">
          &ldquo;{player.intended_major}&rdquo; reads as undecided, so no major preference is applied.
          That is the correct outcome until the athlete has a field in mind.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground mt-2">
        {changed.size > 0 ? (
          <>
            Marked inputs have changed since this ranking was generated. The ranking still
            shows what Thriv3 found at the time &mdash; refresh to rank against the current profile.
          </>
        ) : (
          <>
            These are the athlete&rsquo;s stated preferences, and they are part of how these
            matches were ranked. Editing them does not re-rank on its own.
          </>
        )}
      </p>
    </div>
  );
}
