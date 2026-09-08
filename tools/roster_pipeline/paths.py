# -*- coding: utf-8 -*-
"""Where the pipeline reads and writes, without assuming one developer's home.

L6C moved this code under version control. It did NOT refactor it: fourteen
files call `os.path.expanduser('~/Documents/Thriv3/...')` directly, and
rewriting all of them in the same change that establishes ownership would make
"did the move alter behaviour?" unanswerable.

So this is the seam, not the finished job. `build_targets.py` uses it because
L6B changed that file and L6D depends on it; the other thirteen still expand
their own paths and are a later refactor. With RB_ROOT unset the answer is
byte-identical to what they compute, so mixing the two is safe.
"""
import os


def sheets_root():
    """The directory holding '<season> Roster Sheets'. Override with RB_ROOT."""
    return os.path.expanduser(os.environ.get('RB_ROOT', '~/Documents/Thriv3'))


def season_dir(season):
    """'<root>/<season> Roster Sheets'."""
    return os.path.join(sheets_root(), f'{season} Roster Sheets')
