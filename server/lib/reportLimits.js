/**
 * Where the evidence runs out.
 *
 * A sparse programme used to be given a page per refused analysis: a page of
 * experienced arrivals showing one dot at zero and three "not recorded"
 * columns, a page of replacing minutes reading "0 readable of 0
 * position-seasons". Each was accurate, and together they made a report that
 * had assessed a programme thoroughly read like a list of things Thriv3 could
 * not do.
 *
 * This is the same refusals, on one page, said once each and said properly:
 * what was attempted, what stopped it, the threshold it fell short of, and
 * what a reader must not conclude from the absence. Nothing is hidden and no
 * analytical gate moved — the gates decide what appears here, and this page is
 * only how it is presented.
 *
 * A page is only folded in here when its programme-specific half is EMPTY.
 * An analysis with a thin answer keeps its own page: a thin answer is an
 * answer.
 */
import { THEME, pageHead } from './philosophyPdf.js';
import { STARTER_MINUTES, MIN_POSITION_MINUTES } from '../../shared/philosophy.js';
import { MIN_MEASURED_SHARE, MIN_SQUAD } from '../../shared/freshmanMinutes.js';

const { MUTED, INK } = THEME;

export function evidenceLimitsPage(k, model) {
  const limits = model.evidenceLimits ?? [];
  pageHead(k, {
    kicker: 'Programme evidence',
    title: 'Where the evidence runs out',
    question: 'What we set out to measure here, and what stopped us.',
  });
  k.scope([`${limits.length} of the analyses in this report could not be run for this programme`]);

  k.body('Each of these was attempted and refused. A refusal is a statement about what this '
    + 'programme’s published record contains, not about the programme — and none of them is a '
    + 'reason to read anything into the gap.');

  for (const item of limits) {
    k.heading(item.title);
    k.facts([
      ['What we set out to measure', item.attempted],
      ['Why it could not be measured', item.why],
      ['The threshold it fell short of', item.threshold],
    ]);
    k.note(`What this does not mean: ${item.notMeant}`);
  }

  k.gap(4);
  k.aside(`Nothing on this page is a judgement about the programme. Every threshold above exists `
    + 'so the report cannot publish a figure built from whichever rows happened to be legible; '
    + 'they are the same thresholds applied to every programme in this sport.',
  { title: 'Why the thresholds exist' });
}

/**
 * The refusals this programme actually has, with the numbers behind each.
 *
 * Pure derivation from the model. Nothing here re-runs an analysis: each entry
 * reads the same fields the page it replaces would have read, and reports the
 * threshold that page would have reported.
 */
export function evidenceLimitsFor(model) {
  const s = model.summary?.programme;
  const out = [];

  const e = s?.experiencedArrivalReliance;
  if (e && !e.measurable) {
    out.push({
      id: 'experienced-arrival-intake',
      title: 'Experienced arrivals',
      attempted: 'How often this programme adds players who are not first-years, and how much '
        + 'they go on to play.',
      why: 'An arrival can only be seen by comparing a roster with the season before it, and no '
        + 'season on file here has its predecessor on file too.',
      threshold: 'Two consecutive seasons on file.',
      notMeant: 'it does not mean this programme signs nobody. It means an arrival cannot be told '
        + 'apart from a player who was already here.',
    });
  }

  const r = s?.replacementBehaviour;
  if (r && r.observations === 0) {
    out.push({
      id: 'replacing-minutes',
      title: 'Replacing minutes',
      attempted: 'Where a position’s minutes went the season after established players left it.',
      why: 'No position-season here carries enough recorded minutes on both sides of a comparison '
        + 'to divide the minutes three ways.',
      threshold: `${MIN_POSITION_MINUTES.toLocaleString('en-US')} minutes played at a position, in `
        + 'both the season before and the season after.',
      notMeant: 'it does not mean nobody left or that nothing changed. It means the minutes on '
        + 'either side of the change were not published in enough detail to follow.',
    });
  }

  const d = model.lifecycle?.development;
  if (d && !d.minutesCoverage.readable && d.players > 0) {
    out.push({
      id: 'player-development-shares',
      title: 'How players develop after they arrive — the shares',
      attempted: `What share of first-years here go on to reach a ${STARTER_MINUTES}-minute season, `
        + 'year by year.',
      why: `Minutes are published for only ${d.minutesCoverage.measured} of `
        + `${d.minutesCoverage.playerSeasons} first-year seasons here.`,
      threshold: `${Math.round(MIN_MEASURED_SHARE * 100)}% of a cohort’s seasons carrying a `
        + 'published minutes figure.',
      notMeant: 'it does not mean first-years here do not play. The cohort counts are still on '
        + 'the development page; only the percentages are withheld.',
    });
  }

  const dep = model.lifecycle?.departures;
  if (dep && !dep.gate.allowed && dep.departures.total > 0) {
    out.push({
      id: 'observed-destinations',
      title: 'Where we can trace players next',
      attempted: 'The programme each departing player appeared at the following season, and how '
        + 'that programme compares with this one.',
      why: dep.gate.note ?? 'too few departures at this level can be traced to another roster.',
      threshold: 'A division in which enough departures resolve to a destination for a sample to '
        + 'describe anything, and eight or more traced moves at this programme.',
      notMeant: 'it does not mean players who left stopped playing, and it does not mean this '
        + 'programme’s players move less than anybody else’s. It means the rosters we hold cannot '
        + 'follow them.',
    });
  }

  const squad = model.squad;
  if (squad && !squad.rostered) {
    out.push({
      id: 'current-depth',
      title: 'The current squad',
      attempted: `Every player on the ${model.squadSeason} roster, with class, projected minutes `
        + 'and eligibility.',
      why: `No ${model.squadSeason} roster is on file for this programme.`,
      threshold: 'A published roster for the season being recruited into.',
      notMeant: 'it does not mean the squad is empty. It means we have not been able to read it.',
    });
  }

  return out;
}

export { MIN_SQUAD, INK, MUTED };
