/**
 * Who was in charge, season by season, and what that says about the numbers.
 *
 * A programme's freshman usage can move sharply mid-window, and the roster
 * data alone cannot say why. Bentley's freshman share ran 4%, 2%, 26%, 32%
 * across 2022-2025; the coach sequence shows Lauren Lukis, then Sarah Dacey
 * for the last three. Caltech's ran flat under one coach for four years.
 * Hofstra's swung 2%, 0%, 8%, 18% — also under one coach, which makes it
 * genuine unpredictability rather than a change of philosophy. Those are three
 * different things to tell a recruit and the minutes cannot distinguish them.
 *
 * Tenure here is measured inside the observed window, never asserted beyond
 * it. A coach present in every season on file is "4+ seasons", not "since
 * 2007" — we did not see 2021 and will not claim it.
 */

/**
 * The season a new coach's changes actually start showing.
 *
 * Bentley is the worked example: Dacey arrived for 2023 and freshman share
 * was 2% that year — lower than her predecessor's — then 26% and 32%. A first
 * season is played with the roster the previous coach recruited, so crediting
 * it to the new coach reads their inheritance as their policy.
 */
export const FIRST_SEASON_IS_INHERITED = true;

/** Placeholders a staff page prints when there is nobody in the job. */
const VACANT = /^(tba|tbd|tbn|n\/?a|vacant|vacancy|staff|open|pending|interim|to be (announced|named|determined|hired))$/i;

export function isVacancy(name) {
  const n = String(name ?? '').trim().replace(/\.$/, '');
  if (!n) return true;
  const words = n.toLowerCase().split(/\s+/);
  if (words.length && words.every((w) => w === words[0])) return VACANT.test(words[0]);
  return VACANT.test(n);
}

/**
 * A comparable form of a coach's name.
 *
 * Accents, punctuation and case differ between a 2022 page and a 2025 one for
 * the same person, and every one of those differences would otherwise read as
 * a coaching change — inventing a regime shift out of a typographic one.
 */
export function normaliseCoach(name) {
  let raw = String(name ?? '').trim();
  // "Mauzy-Fleming, Meghan" and "Meghan Mauzy-Fleming" are one person. The
  // Python side flips this before writing, but a form that slipped through
  // would surface as a coaching change that never happened — the expensive
  // direction of error, so it is caught on both sides.
  const comma = raw.match(/^([^,]+),\s*([^,]+)$/);
  if (comma && !/\b(jr|sr|ii|iii|iv|ph\.?d|m\.?s|ed\.?d)\b/i.test(comma[2])) {
    raw = `${comma[2]} ${comma[1]}`;
  }
  return raw
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Are these the same person?
 *
 * Surname plus first initial, because staff pages alternate between "J. Smith"
 * and "John Smith" for one man. Deliberately not fuzzier than that: merging
 * two genuinely different coaches would erase the very change this module
 * exists to find, which is the more expensive mistake.
 */
export function sameCoach(a, b) {
  const x = normaliseCoach(a);
  const y = normaliseCoach(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.split(' ');
  const ys = y.split(' ');
  if (xs.length < 2 || ys.length < 2) return false;
  if (xs[xs.length - 1] !== ys[ys.length - 1]) return false;
  return xs[0][0] === ys[0][0];
}

/**
 * The coaching history of one programme across the seasons observed.
 *
 * `rows` is [{ season, coach_name }] in any order; unresolved seasons may be
 * omitted or carry a blank name, and are reported as gaps rather than silently
 * closed over — a gap between two spells of the same name is not proof the
 * same person held the job throughout.
 */
export function tenureFor(rows = []) {
  const seen = new Map();
  for (const r of rows) {
    const season = Number(r?.season);
    if (!Number.isFinite(season)) continue;
    const name = String(r?.coach_name ?? '').trim();
    seen.set(season, isVacancy(name) ? null : name);
  }
  const seasons = [...seen.keys()].sort((a, b) => a - b);
  if (!seasons.length) return null;

  const segments = [];
  const gaps = [];
  for (const season of seasons) {
    const name = seen.get(season);
    if (!name) { gaps.push(season); continue; }
    const last = segments[segments.length - 1];
    // Contiguity matters: the same name either side of an unresolved season
    // is two observations, not one continuous spell.
    if (last && sameCoach(last.coach, name) && last.to === season - 1) {
      last.to = season;
      last.seasons.push(season);
    } else {
      segments.push({ coach: name, from: season, to: season, seasons: [season] });
    }
  }

  const changes = [];
  for (let i = 1; i < segments.length; i += 1) {
    if (segments[i].from === segments[i - 1].to + 1) {
      changes.push({ from: segments[i - 1].coach, to: segments[i].coach, season: segments[i].from });
    }
  }

  const current = segments.length ? segments[segments.length - 1] : null;
  const resolved = seasons.filter((s) => seen.get(s));

  return {
    seasons,
    resolvedSeasons: resolved,
    gaps,
    segments,
    changes,
    current: current
      ? { coach: current.coach, since: current.from, seasons: current.seasons.length }
      : null,
    // One name across every season we actually resolved, and at least two of
    // them — a single observation is not continuity.
    continuous: segments.length === 1 && resolved.length >= 2 && gaps.length === 0,
    vacant: gaps.length > 0 && resolved.length === 0,
  };
}

/**
 * Which seasons should count, and how much, when projecting for a recruit.
 *
 * A season played under a coach who has since left describes a programme that
 * no longer exists. It is down-weighted rather than dropped: it is still
 * evidence about the institution — its facilities, its league, how it
 * recruits — and discarding it would leave some programmes with one season
 * and a confidence they have not earned.
 *
 * The new coach's first season is weighted as theirs but flagged inherited,
 * because it was played with the previous coach's squad.
 */
export const WEIGHT_CURRENT = 1;
export const WEIGHT_PREVIOUS = 0.35;

export function seasonWeights(tenure) {
  if (!tenure || !tenure.current) return null;
  const out = {};
  for (const season of tenure.seasons) {
    const underCurrent = season >= tenure.current.since;
    out[season] = underCurrent ? WEIGHT_CURRENT : WEIGHT_PREVIOUS;
  }
  return out;
}

/** True where this season was the current coach's first, on inherited players. */
export function isInheritedSeason(tenure, season) {
  if (!tenure?.current || !FIRST_SEASON_IS_INHERITED) return false;
  return Number(season) === tenure.current.since && tenure.changes.length > 0;
}
