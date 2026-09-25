"""
WHICH DATABASE A PYTHON TOOL IS TALKING TO.

The JavaScript side settled this in L7ZM: `server/db/client.js` honours
RECRUITMATCH_DB and `server/db/corpusIdentity.js` says whether the resolved
file is one other checkouts can reach. The nine Python tools in this directory
honoured none of it — four named an absolute path on one machine, four built a
path from the current working directory, and every one of them ignored
RECRUITMATCH_DB. A stage that pointed the whole toolchain at a snapshot still
had its Python half reading and, in two cases, writing canonical.

This is the smallest thing that makes the contract true on both sides. It is
not a framework and does not want to become one: a path, a category, and a
refusal, in the same vocabulary as the JavaScript so that a reader who knows
one knows the other.

ONE OVERRIDE, deliberately. RECRUITMATCH_DB is the variable the JavaScript
already uses; a second name for the same idea would mean two ways to be wrong
about which corpus you are on.
"""

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

#: The database a tool reads when nothing overrides it. Module-relative, not
#: cwd-relative, so a tool run from anywhere still finds its own checkout's
#: corpus — which is also what the four `server/data/...` tools MEANT.
DEFAULT_DB = REPO_ROOT / "server" / "data" / "recruitmatch.sqlite"

MEMORY = ":memory:"

# Same four categories as server/db/corpusIdentity.js, same meanings.
EPHEMERAL_TEST = "EPHEMERAL_TEST"
STAGE_SNAPSHOT = "STAGE_SNAPSHOT"
CANONICAL_SHARED = "CANONICAL_SHARED"
WORKTREE_LOCAL = "WORKTREE_LOCAL"


def resolve_db(default=None):
    """
    The database this process should use.

    RECRUITMATCH_DB wins outright when set; otherwise the caller's own default
    stands, unchanged. Tools that genuinely need a different default keep it by
    passing one — the override is the only thing being made universal.
    """
    env = os.environ.get("RECRUITMATCH_DB", "").strip()
    if env:
        return MEMORY if env == MEMORY else str(Path(env).expanduser())
    return str(default if default is not None else DEFAULT_DB)


def read_only_uri(path):
    """A `mode=ro` URI for `sqlite3.connect(..., uri=True)`."""
    if path == MEMORY:
        return "file::memory:?cache=shared"
    return "file:" + str(Path(path).resolve()) + "?mode=ro"


def corpus_category(path, root=None):
    """
    Which kind of corpus `path` is — reachability, exactly as the JS decides it.

    A file resolving outside this checkout is one another checkout can reach,
    which is the property that matters. A snapshot is DECLARED with
    THRIV3_CORPUS=snapshot and never guessed from a filename.
    """
    if path == MEMORY:
        return EPHEMERAL_TEST
    if os.environ.get("THRIV3_CORPUS") == "snapshot":
        return STAGE_SNAPSHOT
    base = Path(root) if root else REPO_ROOT
    try:
        real = Path(path).resolve()
    except OSError:
        real = Path(path)
    try:
        real.relative_to(base.resolve())
        return WORKTREE_LOCAL
    except ValueError:
        return CANONICAL_SHARED


class CanonicalWriteRefused(SystemExit):
    """Same refusal the JavaScript raises, so the two read alike."""


def assert_canonical_write(script, path, argv=None, root=None):
    """
    Refuse a maintenance write to a corpus other checkouts share, unless the
    caller says --canonical.

    Mirrors `assertCanonicalWrite` in server/db/corpusIdentity.js: silent for a
    test corpus, a declared snapshot, and the checkout that owns the file —
    including the main checkout, where canonical work belongs. It asks only in
    the case that actually caused the L7ZL misattribution, a side checkout
    reaching across into bytes someone else owns.
    """
    argv = sys.argv if argv is None else argv
    category = corpus_category(path, root)
    if category != CANONICAL_SHARED or "--canonical" in argv:
        return category
    raise CanonicalWriteRefused(
        "\nCANONICAL_WRITE_REFUSED\n"
        f"  {script} would write a SHARED canonical corpus:\n"
        f"    {Path(path).resolve()}\n"
        "  Other checkouts and sessions read these rows, and a surprise change there\n"
        "  costs someone else a day of misattribution. Re-run with --canonical to say\n"
        "  you mean it, or set RECRUITMATCH_DB to a copy.\n"
    )
