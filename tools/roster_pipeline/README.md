# Roster acquisition pipeline

Lives here, not in a session scratchpad. On 2026-08-26 a session restart deleted
the scratchpad and with it this code, an 11,000-page fetch cache, and the state
file recording 1,475 already-resolved programmes. The code was recoverable only
because every file had been created by a shell heredoc that the transcript
recorded verbatim; `lib.py` came back byte-identical at 28,648 bytes. That was
luck, not a backup.

  RB_SEASON   season to acquire            (2022..2026)
  RB_REF      verified season to compare against; defaults to RB_SEASON+1,
              which is right for a BACKFILL. For the current season there is
              nothing after it, so point it at the season before.
  RB_CURRENT  =1 for a season not yet played. Drops the "page must name its
              season" rule (live pages carry no year) and replaces it with a
              turnover gate: a genuine new roster repeats under 85% of last
              season's names. Measured on 2022->23, 23->24 and 24->25, that
              holds for 99% of ~1,700 programmes; a stale page scores ~100%.
              Also skips the minutes stages -- there is nothing to count yet.

  ./run_season.sh 2023              backfill a played season, with minutes
  ./run_season_current.sh 2026 2025 acquire a season in progress, rosters only

State goes to `~/Documents/Thriv3/<season> Roster Sheets/_state/`, the page
cache to `~/Library/Caches/recruitmatch-rb/pages`. Neither is session-scoped.
