import React, { useEffect, useRef, useState } from 'react';
import { Search, Loader2, Check } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { athleteProgrammes, matchmaking } from '@/api/client';
import MatchmakingProgrammeStanding from './MatchmakingProgrammeStanding';

/**
 * "WHERE DOES STANFORD SIT FOR THIS ATHLETE?" — A9.5 §C.
 *
 * ===========================================================================
 * A LOOKUP INTO ONE UNIVERSE. NOT A SECOND SCORER.
 *
 * The operator picks a programme from the registry, and this reads that
 * programme's standing OUT OF THE PERSISTED RUN. It never scores a school on
 * its own, and it must not, for a reason that is arithmetic rather than
 * policy: a rank is a position in a population, so a single-programme
 * evaluation would produce a number with no denominator — and whatever number
 * it produced could disagree with the one the Matchmaking list shows for the
 * same school, which is the point at which a consultant stops trusting both.
 *
 * -- IDENTITY COMES FROM THE REGISTRY ROW ----------------------------------
 *
 * The search half is the EXISTING `athleteProgrammes.search`, unchanged: the
 * server answers with candidate rows and the operator picks one. Nothing here
 * turns typed text into a school, and the name sent to the lookup is the
 * registry row's own `name` — the same string the run stored, matched exactly.
 * `server/lib/schoolMatch.js` records what happened the last time something
 * answered when it was unsure: Belmont Abbey's domain published for Belmont,
 * and Kansas given Central Arkansas's academic rating.
 * ===========================================================================
 */

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

export default function MatchmakingSpecificSearch({
  player, run, onSelected,
  /**
   * ADD THE SEARCHED PROGRAMME TO SPECIFIC SCHOOLS — A10 §H.
   *
   * ===========================================================================
   * THIS IS V1's `add`, HANDED DOWN UNCHANGED. It is the same upsert against
   * the same `athlete_programmes` row that the V1 Specific Search has always
   * written, which is the whole reason a school added here appears in the V1
   * tab too and a school added there appears here. There is no V2 copy of the
   * consultant's list, so there is nothing for the two engines to disagree
   * about.
   *
   * SEPARATE FROM "Record for outreach", AND DELIBERATELY SO. They are two
   * different decisions and the brief is explicit that neither may imply the
   * other: adding a school to the list says somebody asked for it, recording a
   * selection says which ranking informed an outreach decision. Neither drafts
   * nor sends anything.
   * ===========================================================================
   *
   * Null when the caller has no list to add to, in which case the control is
   * not rendered at all rather than rendered inert.
   */
  onAdd = null,
  /** Is this programme already on the athlete's list? `(collegeName) => bool` */
  isOnList = null,
  addPending = null,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);

  /** The programme whose standing is open, and the standing itself. */
  const [chosen, setChosen] = useState(null);
  const [standing, setStanding] = useState(null);
  const [loadingStanding, setLoadingStanding] = useState(false);

  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(null);
  const [recordError, setRecordError] = useState(null);

  const latest = useRef(0);

  /**
   * Asked of the list the workspace already holds, not of the server. The
   * upsert is idempotent anyway — `UNIQUE (athlete_id, college_name, sport)`
   * makes a second add a no-op update of the same row — so this is about not
   * offering an action that would do nothing, never about preventing damage.
   */
  const alreadyOnList = Boolean(chosen && isOnList && isOnList(chosen.name));

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      setResults(null); setSearching(false);
      setError(trimmed.length === 0 ? null : 'SHORT');
      return undefined;
    }
    const ticket = (latest.current += 1);
    const timer = setTimeout(() => {
      setSearching(true); setError(null);
      athleteProgrammes.search({ sport: player?.sport, q: trimmed })
        .then((body) => {
          if (ticket !== latest.current) return;
          setResults(body.results || []); setSearching(false);
        })
        .catch((err) => {
          if (ticket !== latest.current) return;
          setError(err?.message || 'The programme search could not be reached.');
          setResults(null); setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, player?.sport]);

  /**
   * Look a chosen programme up IN THE RUN THAT IS ON SCREEN.
   *
   * `runId` is passed explicitly rather than letting the server pick the
   * current one. The operator may be reading a historical run, and a standing
   * taken from a newer run than the one displayed would be a different answer
   * shown under the same heading.
   */
  const choose = async (row) => {
    setChosen(row);
    setStanding(null);
    setRecorded(null);
    setRecordError(null);
    setLoadingStanding(true);
    try {
      setStanding(await matchmaking.programme(player.id, {
        name: row.name, sport: row.sport || player?.sport, runId: run?.runId ?? null,
      }));
    } catch (err) {
      setRecordError(err?.message || 'That programme could not be looked up.');
    } finally {
      setLoadingStanding(false);
    }
  };

  /**
   * Record the selection against THIS run.
   *
   * It writes provenance and nothing else — no campaign, no draft, no send.
   * §L is explicit that outreach is never launched automatically, and a search
   * box that started one would be the worst possible place for that to happen.
   */
  const record = async () => {
    setRecording(true);
    setRecordError(null);
    try {
      const out = await matchmaking.select(player.id, {
        collegeName: standing.programme.name,
        sport: chosen.sport || player?.sport,
        runId: standing.runId,
        source: 'SPECIFIC_SEARCH',
      });
      setRecorded(out);
      if (onSelected) onSelected(out);
    } catch (err) {
      setRecordError(err?.message || 'That selection could not be recorded.');
    } finally {
      setRecording(false);
    }
  };

  return (
    <Card className="p-4 space-y-3" data-testid="v2-specific-search">
      <div>
        <p className="text-sm font-medium">Specific Search</p>
        <p className="text-xs text-muted-foreground">
          Find a programme and see where it sits in this athlete&rsquo;s current matches.
          This looks the school up in the ranking that already exists &mdash; it does not re-rank anything.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Search for a school by name"
          aria-label="Search for a school by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error === 'SHORT' && (
        <p className="text-xs text-muted-foreground">Type at least {MIN_QUERY} characters to search.</p>
      )}
      {error && error !== 'SHORT' && <p className="text-xs text-destructive" role="alert">{error}</p>}

      {searching && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Searching the programme registry&hellip;
        </p>
      )}

      {results && results.length === 0 && !searching && (
        <p className="text-xs text-muted-foreground">
          No active programme in the registry matches &ldquo;{query.trim()}&rdquo;. Nothing is
          matched on a guess &mdash; check the spelling, or the school may not be one Thriv3 holds.
        </p>
      )}

      {results && results.length > 0 && !searching && (
        <ul className="divide-y divide-border rounded-lg border border-border" data-testid="search-results">
          {results.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 p-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{row.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {[row.division, row.conference, [row.city, row.state].filter(Boolean).join(', ')]
                    .filter(Boolean).join(' · ')}
                </p>
              </div>
              <Button
                size="sm"
                variant={chosen?.id === row.id ? 'default' : 'outline'}
                onClick={() => choose(row)}
              >
                Where does it rank?
              </Button>
            </li>
          ))}
        </ul>
      )}

      {loadingStanding && (
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          Reading this athlete&rsquo;s matches&hellip;
        </p>
      )}

      {standing && (
        <>
          <MatchmakingProgrammeStanding standing={standing} name={chosen?.name} />

          {/*
            SELECTING FROM A HISTORICAL RUN IS ALLOWED, AND IS SAID OUT LOUD — §F, §Q.

            Not forbidden: a consultant mid-conversation about Tuesday's list is
            acting on what they were shown, and that is exactly what the
            provenance record is for. What must not happen is them doing it
            without knowing, or the record quietly being re-pointed at a newer
            run afterwards.
          */}
          {run && !run.staleness.current && (
            <p className="text-xs text-amber-400" data-testid="standing-stale-notice">
              These matches are outdated. This is what Thriv3 found when they were generated;
              anything recorded now is recorded against that older ranking. Refresh matches above
              to rank against the current profile.
            </p>
          )}

          {standing.programme && (
            recorded ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5" data-testid="selection-recorded">
                <Check className="h-3.5 w-3.5" />
                Recorded for outreach against these matches. Nothing has been sent.
              </p>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" onClick={record} disabled={recording}>
                  {recording ? 'Recording…' : 'Record for outreach'}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Records the decision and which ranking informed it. It does not draft or send anything.
                </span>
              </div>
            )
          )}

          {recordError && <p className="text-xs text-destructive" role="alert">{recordError}</p>}

          {/*
            ADDING IS OFFERED FOR A PROGRAMME THE RUN DOES NOT HOLD, TOO.

            `standing.programme` being null means this athlete's evaluated pool
            does not contain the school — which is one of the commonest reasons
            a family asks about it by name. Refusing to add it then would make
            the list unable to hold exactly the schools it exists for. The row
            carries its truthful V2 state either way; it is never given a rank.
          */}
          {onAdd && chosen && (
            alreadyOnList ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5" data-testid="already-on-list">
                <Check className="h-3.5 w-3.5" />
                Already in this athlete&rsquo;s specific schools.
              </p>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAdd(chosen)}
                  disabled={addPending === chosen.id}
                  data-testid="add-to-specific-schools"
                >
                  {addPending === chosen.id ? 'Adding…' : 'Add to Specific Schools'}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Adds it to this athlete&rsquo;s list. It does not draft or send anything.
                </span>
              </div>
            )
          )}
        </>
      )}
    </Card>
  );
}
