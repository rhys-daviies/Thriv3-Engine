import React, { useEffect, useRef, useState } from 'react';
import { Search, Plus, Check, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { athleteProgrammes as api } from '@/api/client';

/**
 * "Can you contact Stanford?"
 *
 * The operator types a name, the registry answers with programmes, and the
 * operator PICKS ONE. Every part of that sentence is load-bearing.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE RESOLVES A NAME TO A SCHOOL. There is no web search, no model,
 * no nearest-match, and no way to add a programme the registry does not hold —
 * the Add button exists only on a row the server returned, and what gets
 * stored is that row's `college_id`. The reason is in
 * server/lib/schoolMatch.js: the matcher that DID answer when it was unsure
 * published Belmont Abbey's domain for Belmont and gave Kansas the academic
 * rating of Central Arkansas. A school we do not hold is an empty list, and
 * the empty list says so in words.
 * ---------------------------------------------------------------------------
 *
 * A SPECIFIC REQUEST IS NOT A RECOMMENDATION. Adding Stanford records that the
 * athlete asked for Stanford. It does not rank Stanford, does not put it in
 * the Top 100, and does not touch the stored analysis or its reserve.
 */

/** Matches the server's own minimum, so the message can be shown before a request. */
const MIN_QUERY = 2;

/** Long enough that typing a name is one request, short enough to feel live. */
const DEBOUNCE_MS = 250;

/** Every error this panel can show, keyed on the server's machine-readable code. */
function searchMessage(err) {
  if (!err) return null;
  switch (err.code) {
    case 'SEARCH_QUERY_TOO_SHORT':
      return `Type at least ${MIN_QUERY} characters to search.`;
    case 'SPORT_REQUIRED':
      return 'This athlete has no sport set, so there is no programme list to search.';
    default:
      // The server's own sentence, not one invented here. A failure with no
      // explanation is the one an operator cannot act on.
      return err.message || 'The programme search could not be reached.';
  }
}

function addMessage(err) {
  if (!err) return null;
  switch (err.code) {
    case 'COLLEGE_INACTIVE':
      return 'That programme is not currently active and cannot be added.';
    case 'COLLEGE_SPORT_MISMATCH':
      return 'That programme is in a different sport from this athlete.';
    case 'COLLEGE_NOT_FOUND':
      return 'That programme is no longer in the registry. Search again.';
    default:
      return err.message || 'The school could not be added.';
  }
}

function where(row) {
  return [row.city, row.state].filter(Boolean).join(', ');
}

export default function SpecificSearch({
  sport, programmes, onAdd, pending = null, addError = null, onDismissAddError,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  // Guards against an earlier response landing after a later one. The operator
  // types faster than the registry answers, and results for "Stan" arriving
  // after results for "Stanford" would show the wrong list under the right box.
  const latest = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      // Said before a request rather than after a refusal: a search box that
      // shows nothing for one character looks identical to one that found
      // nothing, and those are different facts.
      setResults(null);
      setSearching(false);
      setError(trimmed.length === 0 ? null : { code: 'SEARCH_QUERY_TOO_SHORT' });
      return undefined;
    }

    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      setSearching(true);
      setError(null);
      api.search({ sport, q: trimmed })
        .then((body) => {
          if (ticket !== latest.current) return;
          setResults(body.results || []);
          setSearching(false);
        })
        .catch((err) => {
          if (ticket !== latest.current) return;
          setError(err);
          setResults(null);
          setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, sport]);

  const message = searchMessage(error);
  const addProblem = addMessage(addError);

  return (
    <Card className="p-4 space-y-3" data-testid="specific-search">
      <div>
        <p className="text-sm font-medium">Specific Search</p>
        <p className="text-xs text-muted-foreground">
          Add a programme this athlete has asked for, whether or not it ranks in their Top 100.
          Adding one records the request — it does not change the ranking.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Search for a school by name"
          value={query}
          aria-label="Search for a school by name"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {addProblem && (
        <p className="text-xs text-destructive" role="alert">
          {addProblem}{' '}
          {onDismissAddError && (
            <button type="button" className="underline" onClick={onDismissAddError}>Dismiss</button>
          )}
        </p>
      )}

      {message && <p className="text-xs text-muted-foreground">{message}</p>}

      {searching && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Searching the programme registry...
        </p>
      )}

      {results && results.length === 0 && !searching && (
        <p className="text-xs text-muted-foreground">
          No active {sport ? `${sport.replace('-', ' ')} ` : ''}programme in the registry matches
          &ldquo;{query.trim()}&rdquo;. Nothing is added on a guess — check the spelling, or the
          school may not be one we hold.
        </p>
      )}

      {results && results.length > 0 && !searching && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {results.map((row) => {
            const existing = programmes.get(row.id);
            const requested = existing?.request_state === 'requested';
            const busy = pending === row.id;
            return (
              <li key={row.id} className="flex items-center justify-between gap-3 p-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{row.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[row.division, row.conference, where(row)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/*
                    Said out loud when a relationship already exists for some
                    other reason. The add below lands on that SAME row, and an
                    operator who cannot see that is one who thinks they are
                    creating something.
                  */}
                  {existing?.flagged && <Badge variant="amber">Flagged</Badge>}
                  {requested ? (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" /> Added
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => onAdd(row)}>
                      {busy
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Plus className="h-3.5 w-3.5 mr-1" />}
                      {busy ? 'Adding' : 'Add to Specific Schools'}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
