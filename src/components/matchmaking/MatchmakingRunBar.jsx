import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { generatedAtText } from '@/lib/matchmakingV2View';

/**
 * WHEN THESE MATCHES WERE MADE, AND WHETHER THEY STILL DESCRIBE TODAY — §O, §D.
 *
 * ===========================================================================
 * NO DIGEST, NO SHA, NO SCHEMA VERSION REACHES THIS BAR.
 *
 * The run carries an engine freeze digest, a corpus digest and two schema
 * versions. None of them is here. A consultant's questions are "when was this
 * decided" and "has anything moved since" — a 64-character hex string answers
 * neither, and a screen that prints one teaches people to ignore the line it
 * sits on. The view model does not even carry them: `runView` drops them, so
 * this cannot leak them by accident. §O keeps them for diagnostics; nothing in
 * A9.3 has needed one.
 *
 * -- STALE IS A STATEMENT, NOT A WARNING -----------------------------------
 *
 * A stale run is still exactly what Thriv3 said at the time, and A9.2 made it
 * immutable so it stays readable. So the results below stay rendered, the bar
 * says what changed in the operator's own vocabulary, and refreshing is their
 * decision. "Outdated" rather than an alarm colour, and the reasons listed in
 * full — several can hold at once, and which ones they are changes what the
 * operator does next.
 * ===========================================================================
 */
export default function MatchmakingRunBar({ run, onRefresh, busy }) {
  const generated = generatedAtText(run.computedAt);
  const { current, reasons } = run.staleness;

  return (
    <div
      className="rounded-lg border border-border p-3 flex items-start justify-between gap-3 flex-wrap"
      data-testid="run-bar"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">
            {generated ? `Generated ${generated}` : 'Generated — date not recorded'}
          </span>
          {/*
            The word, not only the colour — §S. "Current" and "Outdated" are
            the whole signal; the Badge tone repeats it for people who read
            colour first.
          */}
          <Badge variant={current ? 'green' : 'amber'} data-testid="run-currency">
            {current ? 'Current' : 'Outdated'}
          </Badge>
          <span className="text-[11px] text-muted-foreground">Matcher V2</span>
        </div>

        {!current && reasons.length > 0 && (
          <ul className="mt-2 space-y-0.5" data-testid="stale-reasons">
            {reasons.map((r) => (
              <li key={r.code} className="text-xs text-muted-foreground">· {r.text}</li>
            ))}
          </ul>
        )}

        {!current && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            These results are the record of what Thriv3 found at the time. They stay
            exactly as they are until you refresh, and refreshing creates a new set
            rather than changing this one.
          </p>
        )}
      </div>

      <Button
        size="sm"
        variant={current ? 'outline' : 'default'}
        onClick={onRefresh}
        disabled={!!busy}
      >
        <RefreshCw className={busy ? 'h-3.5 w-3.5 mr-1.5 animate-spin' : 'h-3.5 w-3.5 mr-1.5'} />
        {busy ? 'Refreshing matches…' : 'Refresh matches'}
      </Button>
    </div>
  );
}
