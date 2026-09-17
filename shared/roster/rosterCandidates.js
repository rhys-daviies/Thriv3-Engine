/**
 * Roster URLs worth trying on a host we already trust.
 *
 * L6D found 34 NCAA programmes it could not attempt at all: every acquiring
 * stage transforms a URL the pipeline already holds, and these had none. L7
 * found that 15 of them sit on an athletics host the ledger has verified, and
 * that the space of NCAA roster URLs is not open — every one of the 1,582
 * distinct sources in the 2026 corpus sits under `/sports/<slug>/…roster…`, in
 * eight shapes.
 *
 * So this is the missing step, and it is a catalogue rather than a crawler. It
 * takes a host whose identity is already established, a sport, and a season,
 * and returns the ordered list of URLs the corpus says are worth asking for.
 * It reads nothing, fetches nothing and decides nothing.
 *
 * ---------------------------------------------------------------------------
 * A CANDIDATE IS NOT A SOURCE.
 *
 * "This host belongs to Pace" and "this page is Pace's men's soccer roster" are
 * different claims, and only the first is established when a candidate is
 * generated. Everything that decides the second — the soft-404 check, the
 * turnover gate, roster parsing, source validation, the confidence grade —
 * still runs, unchanged, on whatever comes back. Nothing here shortens that
 * path; it only supplies a first URL where there was none.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT THE BARE `soccer` SLUG.
 *
 * Four corpus URLs use `/sports/soccer/`, all at D1 schools that field a
 * women's programme and no men's. Generating it would mean asking a school with
 * both for "the soccer roster" and having no way to know which one answered.
 * The programmes this exists to unblock have no prior roster, so the turnover
 * gate has nothing to compare against and would not catch a wrong-gender page.
 * 0.25% of observed sources is not worth an identity risk, so the slug is
 * catalogued and not generated.
 */

/**
 * Path shapes, ordered by how often the 2026 NCAA corpus actually used them.
 *
 * `<SLUG>` is the sport segment, `<YEAR>` the season, `<SPAN>` the academic
 * span (2026 → `2026-27`). Counts are the corpus measurement and are here so a
 * future re-measure can see what the order was derived from, not to be summed.
 */
export const SHAPES = Object.freeze([
  { id: 'ROSTER_YEAR', path: '/sports/<SLUG>/roster/<YEAR>', observed: 1444, providers: ['SIDEARM'] },
  { id: 'SPAN_ROSTER_TABLE', path: '/sports/<SLUG>/<SPAN>/roster?view=table', observed: 71, providers: ['PRESTO'] },
  { id: 'ROSTER_SEASON_YEAR', path: '/sports/<SLUG>/roster/season/<YEAR>', observed: 23, providers: ['NUXT', 'SIDEARM'] },
  { id: 'SPAN_ROSTER', path: '/sports/<SLUG>/<SPAN>/roster', observed: 16, providers: ['PRESTO'] },
  { id: 'ROSTER_SEASON_YEAR_TABLE', path: '/sports/<SLUG>/roster/season/<YEAR>?view=table', observed: 14, providers: ['NUXT'] },
  { id: 'ROSTER_BARE', path: '/sports/<SLUG>/roster', observed: 7, providers: ['SIDEARM', 'NUXT'] },
  { id: 'ROSTER_SPAN', path: '/sports/<SLUG>/roster/<SPAN>', observed: 4, providers: ['SIDEARM'] },
  { id: 'ROSTER_YEAR_TABLE', path: '/sports/<SLUG>/roster/<YEAR>?view=table', observed: 3, providers: ['SIDEARM'] },
]);

/**
 * Sport segments, ordered by observed frequency. The bare `soccer` is excluded.
 *
 * `short` marks the abbreviated forms, and the distinction is not cosmetic: the
 * corpus splits on it almost perfectly by provider. Of 1,451 SIDEARM sources
 * 1,439 use the long segment; of 37 PRESTO sources **all 37 use the short one**,
 * and none uses the long. So on a Presto host `wsoc` is not a fallback, it is
 * the answer — L7C spent five failed acquisitions learning that from the other
 * direction.
 */
export const SLUGS = Object.freeze({
  'mens-soccer': Object.freeze([
    { slug: 'mens-soccer', observed: 617, short: false },
    { slug: 'msoc', observed: 49, short: true },
    { slug: 'm-soccer', observed: 1, short: true },
  ]),
  'womens-soccer': Object.freeze([
    { slug: 'womens-soccer', observed: 857, short: false },
    { slug: 'wsoc', observed: 53, short: true },
    { slug: 'w-soccer', observed: 1, short: true },
  ]),
});

/** Providers whose sources use the short sport segment, measured not assumed. */
export const SHORT_SLUG_PROVIDERS = Object.freeze(['PRESTO']);

/**
 * How many generated candidates an acquisition run may attempt.
 *
 * Measured, not chosen. Across the 1,605 NCAA roster URLs known to be real,
 * 1,601 are reproduced somewhere in this catalogue, and the ordinal that wins:
 *
 *   #1   1,474   92.1%        #8      5   98.6%
 *   #2      14   92.9%        #9      1   98.6%
 *   #4      32   94.9%        #10     5   98.9%   <- Southwest Minnesota State
 *   #5      45   97.8%        #11     4   99.2%
 *   #7       8   98.3%        #13    10   99.8%
 *                             #16     3  100.0%
 *
 * So sixteen is the observed maximum and covers every known case; nothing
 * beyond it has ever won. The other eight entries stay in the catalogue because
 * they are real shapes, and are not attempted.
 *
 * That 92.1% is also why the single-candidate design survived this long, and
 * the 7.9% is why it had to stop: 127 programmes with a known-good URL would
 * not have been reachable from candidate one alone.
 */
export const MAX_ATTEMPTED_CANDIDATES = 16;

/** Why no candidate was generated. A reason is an answer; silence is not. */
export const CANDIDATE = Object.freeze({
  OK: 'OK',
  NO_TRUSTED_HOST: 'NO_TRUSTED_HOST',
  AMBIGUOUS_HOST: 'AMBIGUOUS_HOST',
  UNSUPPORTED_SPORT: 'UNSUPPORTED_SPORT',
  HOST_NOT_VERIFIED: 'HOST_NOT_VERIFIED',
});

const span = (season) => `${season}-${String((Number(season) + 1) % 100).padStart(2, '0')}`;

/**
 * Ordered candidate URLs for one programme on one verified host.
 *
 * SHAPE-MAJOR, not slug-major: the dominant shape on the second-choice slug is
 * a better bet than a rare shape on the first, because the shape is a property
 * of the site's software and the slug is a naming preference within it. So the
 * order is every slug for the commonest shape, then every slug for the next.
 *
 * `verified` must be asserted by the caller from `domainAuthority`. It is a
 * required argument rather than a default because the whole point of this file
 * is that it never runs on a host nobody has checked — an academic domain, a
 * BASE_ONLY match, or a name someone searched for.
 */
export function rosterCandidatesForVerifiedHost({
  host, sport, season, verified = false, limit = Infinity, platform = null,
} = {}) {
  if (!verified) {
    return { status: CANDIDATE.HOST_NOT_VERIFIED, candidates: [],
      reason: 'candidates are only generated for a host the ledger stands behind' };
  }
  if (!host) {
    return { status: CANDIDATE.NO_TRUSTED_HOST, candidates: [],
      reason: 'no verified athletics host for this institution' };
  }
  const slugs = SLUGS[sport];
  if (!slugs) {
    return { status: CANDIDATE.UNSUPPORTED_SPORT, candidates: [],
      reason: `no catalogued sport segment for ${sport}` };
  }
  const year = String(season);
  const sp = span(season);
  /*
   * PLATFORM FIRST WHERE THE LEDGER KNOWS IT. The shape is a property of the
   * site's software, and the ledger already recorded which software answered
   * when the host was identified. Endicott's roster is the fifth candidate by
   * raw frequency and the first once its host is known to be PRESTO. A stable
   * partition, not a score: the order within each half is unchanged, so the
   * ladder stays the same list in a better order and is identical when the
   * platform is unknown.
   */
  const ordered = platform
    ? [...SHAPES.filter((sh) => sh.providers.includes(platform)),
      ...SHAPES.filter((sh) => !sh.providers.includes(platform))]
    : SHAPES;
  // The slug is a property of the provider too, and on the same evidence. Both
  // orderings are stable partitions, so the ladder is the same set either way.
  const bySlug = platform && SHORT_SLUG_PROVIDERS.includes(platform)
    ? [...slugs.filter((s) => s.short), ...slugs.filter((s) => !s.short)]
    : slugs;
  const out = [];
  for (const shape of ordered) {
    for (const { slug } of bySlug) {
      const path = shape.path.replace('<SLUG>', slug).replace('<YEAR>', year).replace('<SPAN>', sp);
      const url = `https://${host}${path}`;
      if (!out.some((c) => c.url === url)) out.push({ url, shape: shape.id, slug, fetchHost: host });
      if (out.length >= limit) return { status: CANDIDATE.OK, candidates: out, reason: null };
    }
  }
  return { status: CANDIDATE.OK, candidates: out, reason: null };
}

/**
 * The same, for a programme whose host came back ambiguous.
 *
 * Kept separate so a caller cannot pass two hosts and get a merged ladder that
 * silently prefers one. Several genuinely different hosts is a question for a
 * person, not a tiebreak for a generator — L4 is the record of what happens
 * when a lookup takes the first row.
 */
export function candidatesForLookup(lookup, { sport, season, limit = Infinity, platform = null } = {}) {
  if (!lookup || lookup.status === 'NO_UNITID' || lookup.status === 'NO_TRUSTED_HOST') {
    return { status: CANDIDATE.NO_TRUSTED_HOST, candidates: [], host: null, fetchHosts: [],
      reason: lookup?.reason ?? 'no institution identity' };
  }
  if (lookup.status === 'AMBIGUOUS') {
    return { status: CANDIDATE.AMBIGUOUS_HOST, candidates: [], host: null, fetchHosts: [],
      hosts: lookup.hosts, reason: lookup.reason };
  }
  const host = lookup.hosts[0];
  /*
   * HOST-MAJOR, AND THE ORDER OF THE FORMS IS THE WHOLE ARGUMENT.
   *
   * One identity may have more than one approved spelling — Northwood has the
   * apex and the `www.`, both separately verified — and the ladder walks the
   * best-evidenced one to exhaustion before it tries the next.
   *
   * Interleaving was the alternative and it is the one that breaks things. The
   * sixteen-candidate bound is an evidence-based measurement over a SINGLE
   * host's ladder: 92.1% of known sources win at ordinal one, and the deepest
   * observed winner is sixteen. Alternating two spellings doubles every ordinal,
   * so Southwest Minnesota State's winner at ten becomes twenty and falls off
   * the end — a regression, in exchange for reaching a second spelling sooner.
   * Host-major keeps every existing ordinal exactly where it was measured, and
   * the identities that actually need a second form are ordered so they never
   * have to reach one: `fetchHostsForIdentity` puts the spelling the
   * institution's own rosters were fetched from first.
   *
   * The bound stays GLOBAL. `limit` is the length of the whole ordered ladder,
   * not a per-host allowance, so admitting a second spelling can never make an
   * acquisition run longer than it was.
   */
  const forms = lookup.fetchHosts?.length ? lookup.fetchHosts : [host];
  const candidates = [];
  const seen = new Set();
  for (const form of forms) {
    if (candidates.length >= limit) break;
    const gen = rosterCandidatesForVerifiedHost({
      host: form, sport, season, verified: true, platform,
    });
    if (gen.status !== CANDIDATE.OK) {
      if (!candidates.length) return { host, fetchHosts: forms, ...gen };
      break;
    }
    for (const c of gen.candidates) {
      if (seen.has(c.url)) continue;
      seen.add(c.url);
      candidates.push(c);
      if (candidates.length >= limit) break;
    }
  }
  return { status: CANDIDATE.OK, host, fetchHosts: forms, candidates, reason: null };
}
