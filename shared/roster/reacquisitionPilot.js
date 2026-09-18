/**
 * WHICH TWENTY, AND WHY THOSE TWENTY.
 *
 * L7P found 138 NCAA programmes that hold a 2025 roster and no 2026 one. They
 * are not a discovery problem — every one already carries a source the pipeline
 * fetched a roster from last season. The question L7Q asks is narrower and more
 * useful: does the architecture that acquired them in 2025 advance them to 2026
 * on its own?
 *
 * Answering it on all 138 would cost a full run and would confound the failure
 * modes. So it is asked of a sample, and a sample invites exactly one kind of
 * dishonesty: picking the twenty most likely to work. This file exists so that
 * nobody — including the author — can do that. Selection is a pure function of
 * the dataset. Same cohort in, same twenty out, and the digest proves it.
 *
 * TWO DECISIONS, KEPT APART:
 *
 *   ALLOCATION   how many seats each (division × gender) stratum gets. Largest
 *                remainder over the cohort's own proportions, with a floor of
 *                one per non-empty stratum so D1 and D2 are represented at all.
 *                D3 is 110 of 138 and stays the largest group by construction.
 *
 *   ORDER        which rows inside a stratum take its seats. Round-robin across
 *                (source shape × provider) groups, so a stratum dominated by one
 *                platform cannot spend all its seats there; and within a group,
 *                ascending `sha256(key)`, which is derived from the programme's
 *                identity and correlates with nothing about how promising its
 *                website looks.
 *
 * Neither step reads a success probability, a player count, a failure reason or
 * a host. A row cannot be made more or less likely to be picked by being easy.
 */
import { createHash } from 'node:crypto';

export const PILOT_SIZE = 20;
export const ALGORITHM = 'L7Q/stratified-roundrobin/v1';

const sha = (s) => createHash('sha256').update(s).digest('hex');

/**
 * The host a roster was really fetched from, seen through an archive URL.
 *
 * A Wayback capture's hostname is `web.archive.org`, which is true and useless:
 * the provider whose page shape the pipeline has to advance is the one inside.
 * Twelve of the 138 carry an archive URL as their 2025 source.
 */
export function underlyingUrl(url) {
  const s = String(url ?? '');
  const m = s.match(/^https?:\/\/web\.archive\.org\/web\/[^/]+\/(https?:\/\/.+)$/);
  return m ? m[1] : s;
}

export const archived = (url) => /^https?:\/\/web\.archive\.org\//.test(String(url ?? ''));

/**
 * The FORM of a known-good source, which is what season advancement has to
 * transform. Named after the path, never after the vendor — two providers serve
 * `/sports/<slug>/roster/<year>` and the pipeline treats them identically,
 * while one provider serves four shapes and the pipeline does not.
 */
export function sourceShape(url) {
  let path;
  try { path = new URL(underlyingUrl(url)).pathname + (new URL(underlyingUrl(url)).search || ''); }
  catch { return 'UNPARSEABLE'; }
  if (/^\/roster\.aspx/i.test(path)) return 'ROSTER_ASPX_QUERY';
  if (/\/sports\/[^/]+\/\d{4}-\d{2}\/roster\/?\d*$/i.test(path)) return 'SPORTS_SLUG_ACADEMIC_YEAR_ROSTER';
  if (/\/sports\/[^/]+\/roster\/\d{4}\/?$/i.test(path)) return 'SPORTS_SLUG_ROSTER_YEAR';
  if (/\/sports\/[^/]+\/roster\/?$/i.test(path)) return 'SPORTS_SLUG_ROSTER';
  if (/\/sport\/[^/]+\/roster\/?$/i.test(path)) return 'SPORT_SLUG_ROSTER';
  if (/-roster-\d{4}\/?$/i.test(path)) return 'SLUG_ROSTER_YEAR_FLAT';
  if (/\/roster\/?$/i.test(path)) return 'BARE_ROSTER';
  return 'OTHER';
}

/** `division|gender` — the stratification the brief asks to be covered. */
export const stratumOf = (r) => `${r.division}|${r.gender}`;

/**
 * Seats per stratum: a floor of one, then largest remainder on the rest.
 *
 * The floor is the only judgement in this file and it is declared rather than
 * hidden. Pure proportional allocation gives D1 men 0.43 of a seat and
 * therefore none, and a pilot that cannot speak about D1 men answers a smaller
 * question than the one asked. Ties in the remainder break on stratum name, so
 * the result does not depend on iteration order.
 */
export function allocate(sizes, size = PILOT_SIZE) {
  const strata = [...sizes.keys()].sort();
  if (strata.length > size) throw new Error(`cannot floor ${strata.length} strata into ${size} seats`);
  const total = strata.reduce((n, s) => n + sizes.get(s), 0);
  const seats = new Map(strata.map((s) => [s, 1]));
  let rest = size - strata.length;

  const share = new Map(strata.map((s) => [s, (rest * sizes.get(s)) / total]));
  for (const s of strata) {
    const whole = Math.floor(share.get(s));
    seats.set(s, seats.get(s) + whole);
    rest -= whole;
  }
  const byRemainder = [...strata].sort((a, b) => {
    const ra = share.get(a) - Math.floor(share.get(a));
    const rb = share.get(b) - Math.floor(share.get(b));
    return rb - ra || a.localeCompare(b);
  });
  for (let i = 0; rest > 0; i += 1, rest -= 1) seats.set(byRemainder[i % strata.length], seats.get(byRemainder[i % strata.length]) + 1);

  // A stratum can never be allocated more rows than it holds; give the overflow
  // back to the largest strata, which is the only direction that can absorb it.
  let overflow = 0;
  for (const s of strata) {
    const over = seats.get(s) - sizes.get(s);
    if (over > 0) { seats.set(s, sizes.get(s)); overflow += over; }
  }
  const roomy = [...strata].sort((a, b) => (sizes.get(b) - seats.get(b)) - (sizes.get(a) - seats.get(a)) || a.localeCompare(b));
  for (let i = 0; overflow > 0; i += 1) {
    const s = roomy[i % roomy.length];
    if (seats.get(s) < sizes.get(s)) { seats.set(s, seats.get(s) + 1); overflow -= 1; }
  }
  return seats;
}

/**
 * Round-robin across (shape × provider) groups, hash order inside each.
 *
 * The groups are visited largest first so a stratum's dominant form is sampled
 * first and the long tail still gets its turn before the seats run out.
 */
export function orderWithinStratum(rows) {
  const groups = new Map();
  for (const r of rows) {
    const g = `${r.sourceShape}|${r.provider ?? 'UNKNOWN'}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const names = [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length || a.localeCompare(b));
  for (const n of names) groups.get(n).sort((a, b) => sha(a.key).localeCompare(sha(b.key)));
  const out = [];
  for (let i = 0; out.length < rows.length; i += 1) {
    for (const n of names) if (groups.get(n)[i]) out.push(groups.get(n)[i]);
  }
  return out;
}

/** The cohort's identity, so a digest cannot silently describe a different 138. */
export const cohortFingerprint = (rows) => sha([...rows].map((r) => r.key).sort().join('\n'));

/**
 * The twenty, in selection order, with the digest that reproduces them.
 *
 * `rows` must carry `key`, `division`, `gender`, `sourceShape` and `provider`.
 */
export function pilotSample(rows, { size = PILOT_SIZE } = {}) {
  const sizes = new Map();
  for (const r of rows) sizes.set(stratumOf(r), (sizes.get(stratumOf(r)) ?? 0) + 1);
  const seats = allocate(sizes, size);

  const picked = [];
  for (const s of [...sizes.keys()].sort()) {
    const ordered = orderWithinStratum(rows.filter((r) => stratumOf(r) === s));
    picked.push(...ordered.slice(0, seats.get(s)).map((r) => ({ ...r, stratum: s })));
  }
  const keys = picked.map((r) => r.key);
  return {
    algorithm: ALGORITHM,
    size,
    seats: Object.fromEntries([...seats.entries()].sort()),
    cohortFingerprint: cohortFingerprint(rows),
    digest: sha(`${ALGORITHM}\n${cohortFingerprint(rows)}\n${keys.join('\n')}`).slice(0, 16),
    keys,
    rows: picked,
  };
}
