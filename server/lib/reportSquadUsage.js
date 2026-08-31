/**
 * How this programme has used its squad.
 *
 * One page for two independent models, and they share it because either alone
 * invites the wrong reading. How widely the minutes were spread and who was far
 * enough through college to take them are different facts: a narrow
 * distribution carried by fourth years and a narrow distribution carried by
 * second years are different programmes, and Phase 8 measured the independence
 * — concentration against any year's minute share gives r-squared no higher
 * than 0.04.
 *
 * MINUTE CONCENTRATION, not the share of the roster that appeared. That figure
 * has a denominator the roster page can inflate: Lake Erie names 62 players
 * and 28 have minutes, so "45% of the roster appeared" describes a page rather
 * than a rotation. It is on the model, marked unreliable, and is not drawn
 * here. Neither is the count over 200 minutes — it correlates with the
 * top-eleven share at -0.87 and is the same measure twice.
 *
 * NO CATEGORY. The model refuses banding because a programme varies more
 * between its own seasons than the pool's middle half is wide, so this page
 * prints the seasons, the programme's median and the pool's middle half.
 */
import { charts, THEME, pageHead, spanText } from './philosophyPdf.js';
import { STARTER_MINUTES } from '../../shared/philosophy.js';

const { MUTED, NAVY, MID, PALE, CLARET } = THEME;
const pc = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The three squad sizes, season by season, with the pool behind each. */
function concentrationBlock(k, u) {
  k.heading('How widely the playing time has been spread');
  if (!u.available) {
    if (u.singleSeasonObservation) {
      const o = u.singleSeasonObservation;
      k.note(`One season on file carries enough published minutes to read a distribution. In `
        + `${o.season}, the eleven most-used players took ${pc(o.top11MinuteShare)} of the squad’s `
        + `minutes and ${plural(o.playersWith600Plus, 'player', 'players')} reached `
        + `${STARTER_MINUTES} minutes. One season is one season, and this is not a programme `
        + 'record.');
      return;
    }
    k.note(`${u.reason[0].toUpperCase()}${u.reason.slice(1)}.`);
    return;
  }

  const readable = u.seasons.filter((s) => s.readable);
  charts.columns(k, {
    box: k.slot(122),
    title: null,
    subtitle: 'The share of each season’s published minutes taken by the eleven, fourteen and '
      + 'eighteen most-used players.',
    // Percentages, not fractions: the axis label is `yMax` with the unit
    // appended, and a fractional scale printed a bare "1" at the top of a
    // chart whose bars are all read as percentages.
    yMax: 100,
    unit: '%',
    groups: readable.map((s) => ({
      label: s.season,
      note: pc(s.top11MinuteShare),
      bars: [
        { key: 'top11', value: Math.round(s.top11MinuteShare * 100), color: NAVY },
        { key: 'top14', value: Math.round(s.top14MinuteShare * 100), color: MID },
        { key: 'top18', value: Math.round(s.top18MinuteShare * 100), color: PALE },
      ],
    })),
    unavailable: readable.length ? null : 'no season on file carries enough published minutes',
  });

  const rows = [
    ['Eleven most-used', u.medianTop11Share, u.rangeTop11Share, u.pool?.top11MinuteShare],
    ['Fourteen most-used', u.medianTop14Share, u.rangeTop14Share, u.pool?.top14MinuteShare],
    ['Eighteen most-used', u.medianTop18Share, u.rangeTop18Share, u.pool?.top18MinuteShare],
  ];
  for (const [label, value, range, pool] of rows) {
    const span = range && range.low !== range.high
      ? `${pc(range.low)} to ${pc(range.high)} across the seasons` : 'in every season read';
    k.note(`${label}: ${pc(value)} of the minutes, ${span}`
      + `${pool ? `, against a comparable median of ${pc(pool.median)} and a middle half of `
        + `${pc(pool.middleHalf.low)} to ${pc(pool.middleHalf.high)}` : ''}.`);
  }
  const starters = u.medianPlayersWith600Plus;
  if (starters != null) {
    const p = u.pool?.playersWith600Plus;
    k.note(`${plural(starters, 'player', 'players')} reached ${STARTER_MINUTES} minutes in a `
      + `typical season${p ? `, against a comparable median of ${p.median}` : ''}.`);
  }
  if (u.implausibleSeasons?.length) {
    k.note(`The published minutes for ${u.implausibleSeasons.map((s) => s.season).join(', ')} do `
      + 'not add up to the matches those seasons contained, so read them with that in mind.');
  }
}

/**
 * Roster share against minute share, by year of study.
 *
 * Paired bars rather than two charts, because the CONTRAST is the finding and a
 * reader should not have to hold one page against another to see it: Akron's
 * first-years are 42% of the roster and 11% of the minutes.
 */
function experienceBlock(k, e) {
  k.heading('Which years of study carried the minutes');
  const one = !e.compositionAvailable ? e.singleSeasonObservation : null;
  if (!e.compositionAvailable && !one) {
    k.note(`${e.compositionReason[0].toUpperCase()}${e.compositionReason.slice(1)}.`);
    return;
  }
  // One season on file — NAIA, where the acquisition reaches a single season.
  // Its own groups, said to be one season, and never called a record.
  const source = one ? { groups: one.groups, loadAvailable: Boolean(one.loadSeason) } : e;
  if (one) {
    k.note(`One season on file can be read by year of study: ${one.compositionSeason}. `
      + 'One season is one season, and this is not a programme record.');
  }
  const groups = source.groups.filter((g) => g.group !== 'UNKNOWN'
    && ((g.rosterSeasons ?? g.rosterPlayers ?? 0) > 0));
  // UNKNOWN only where it is enough of the roster to matter; a page that lists
  // a group holding 1% of the squad has spent a row on nothing.
  const unknown = source.groups.find((g) => g.group === 'UNKNOWN');
  const withUnknown = unknown && (unknown.rosterShare ?? 0) >= 0.03 ? [...groups, unknown] : groups;

  charts.paired(k, {
    box: k.slot(Math.min(150, withUnknown.length * 30 + 14)),
    title: null,
    subtitle: source.loadAvailable
      ? 'The share of the roster each year of study made up, against the share of the published '
        + 'minutes they took.'
      : 'The share of the roster each year of study made up. The minutes could not be read.',
    // The rows carry PERCENTAGES, so the scale has to be one too — handed a
    // fraction here the bars ran forty thousand points off the page.
    max: Math.max(50, ...withUnknown.flatMap((g) => [
      Math.round((g.rosterShare ?? 0) * 100), Math.round((g.minuteShare ?? 0) * 100)])),
    rows: withUnknown.map((g) => ({
      label: g.label[0].toUpperCase() + g.label.slice(1),
      a: g.rosterShare == null ? null : Math.round(g.rosterShare * 100),
      b: g.minuteShare == null ? null : Math.round(g.minuteShare * 100),
    })),
    aLabel: 'navy: share of the roster',
    bLabel: source.loadAvailable ? 'pale: share of the minutes' : null,
    unit: '%',
    unavailable: withUnknown.length ? null : 'no season on file can be read by year of study',
  });

  // `charts.paired` draws its legend just below the box, and the flow cursor
  // is restored to the box's bottom edge — so anything written next lands on
  // it without this.
  k.gap(12);
  if (one) return;
  if (!e.loadAvailable) {
    k.note(`${e.loadReason[0].toUpperCase()}${e.loadReason.slice(1)}. The roster itself reads `
      + 'clearly, so who was here is on file even where what they played is not.');
    return;
  }
  const gaps = [...(e.groups ?? [])]
    .filter((g) => g.group !== 'UNKNOWN' && g.rosterShare != null && g.minuteShare != null)
    .map((g) => ({ ...g, gap: g.minuteShare - g.rosterShare }))
    .sort((x, y) => x.gap - y.gap);
  const lowest = gaps[0];
  const highest = gaps[gaps.length - 1];
  if (lowest && highest && lowest.group !== highest.group) {
    k.note(`${lowest.label[0].toUpperCase()}${lowest.label.slice(1)} players made up `
      + `${pc(lowest.rosterShare)} of the roster and took ${pc(lowest.minuteShare)} of the minutes; `
      + `${highest.label} players ${pc(highest.rosterShare)} and ${pc(highest.minuteShare)}. `
      + 'A year of study holding more of the minutes than of the roster is the whole of what this '
      + 'chart shows.');
  }
}

/** The page. */
export function squadUsagePage(k, model) {
  const s = model.squadProfile;
  const u = s?.utilisation;
  const e = s?.experience;
  pageHead(k, {
    kicker: 'Programme evidence',
    title: 'How this programme uses its squad',
    question: 'How widely are meaningful minutes distributed across the roster, and which stages '
      + 'of college experience carry them?',
    scope: [
      u?.available ? `${plural(u.seasonsObserved, 'season', 'seasons')} of published minutes`
        : (u?.singleSeasonObservation ? 'one season on file' : null),
      u?.poolScope ? `compared against ${u.poolScope}` : null,
      'not a forecast',
    ].filter(Boolean),
  });
  if (u) concentrationBlock(k, u);
  k.gap(6);
  if (e) experienceBlock(k, e);
  const sentences = squadUsageReading(model);
  if (sentences.length) k.reading(sentences);
}

/**
 * What the page says, restated. Every sentence's numbers are printed above it,
 * and nothing here is a reason, a judgement or a forecast.
 */
export function squadUsageReading(model) {
  const u = model.squadProfile?.utilisation;
  const e = model.squadProfile?.experience;
  const out = [];
  if (u?.available && u.pool?.top11MinuteShare) {
    const p = u.pool.top11MinuteShare;
    const wider = u.medianTop11Share < p.middleHalf.low;
    const tighter = u.medianTop11Share > p.middleHalf.high;
    out.push(`The eleven most-used players took ${pc(u.medianTop11Share)} of the minutes in a `
      + `typical season, against a comparable middle half of ${pc(p.middleHalf.low)} to `
      + `${pc(p.middleHalf.high)}`
      + (wider ? ' — outside it on the wider side.' : tighter ? ' — outside it on the tighter side.' : '.'));
  }
  if (e?.loadAvailable) {
    const y1 = e.groups.find((g) => g.group === 'YEAR_1');
    if (y1?.rosterShare != null && y1.minuteShare != null) {
      const gap = y1.rosterShare - y1.minuteShare;
      out.push(`First-year players made up ${pc(y1.rosterShare)} of the roster across those `
        + `seasons and took ${pc(y1.minuteShare)} of the minutes`
        + (Math.abs(gap) < 0.03 ? ' — close to the same share of both.'
          : gap > 0 ? `, a gap of ${Math.round(gap * 100)} points.`
            : `, ${Math.round(-gap * 100)} points more of the minutes than of the roster.`));
    }
    const four = e.yearFourPlus;
    if (four?.rosterShare != null && four.minuteShare != null) {
      out.push(`Players in a fourth year or beyond made up ${pc(four.rosterShare)} of the roster `
        + `and took ${pc(four.minuteShare)} of the minutes.`);
    }
  } else if (e?.compositionAvailable) {
    out.push('The roster can be read by year of study across these seasons; the minutes cannot, '
      + 'so who was here is on file and what they played is not.');
  }
  return out.slice(0, 4);
}
