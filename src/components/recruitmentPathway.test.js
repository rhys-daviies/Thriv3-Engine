import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RecruitmentPathway from './RecruitmentPathway.jsx';
import ProgrammeDecision from './ProgrammeDecision.jsx';
import { pathwayCopyFor, PATHWAY_COPY_KINDS } from '@/lib/pathwayEvidenceCopy';
import { PATHWAY_FIXTURES } from '@/lib/__fixtures__/pathwayEvidence.js';
import { SECTION_OF, SECTIONS } from '@shared/evidence/operatorEvidence.js';
import { provenanceRows } from '@/lib/evidenceProvenance';

/**
 * Everything ONE evidence object puts on the page: its copy and its own
 * provenance drawer.
 *
 * Axis borrowing is a property of a single claim, so it has to be asserted
 * against a single item. Concatenating the whole section and searching it
 * flattens away the element boundaries — one row's drawer runs straight into
 * the next row's headline — and would fail on adjacency that no reader ever
 * sees as one sentence.
 */
const itemText = (i, copy) => [
  copy.headline, copy.detail, ...(copy.names ?? []),
  ...provenanceRows(i).map((r) => `${r.label} ${r.value}`),
].filter(Boolean).join(' ');

/**
 * The pathway section, against real payloads for ten real programmes.
 *
 * Most of what follows is about AXIS BORROWING. Every kind here is a claim
 * about some combination of country, region, position and coach, and the
 * sentence that reads best is nearly always the one that takes an axis from
 * the row above. At Jacksonville the coach item names New Zealand and carries
 * a null position, and the row beneath it names a defender from Australia:
 * "this coach recruits New Zealand defenders" is fluent, plausible, and
 * supported by neither object.
 *
 * The second theme is that nothing here is a forecast. Historical recruiting
 * is not intent, current presence is not demand, and absence is not refusal.
 */

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const pathway = (name) => PATHWAY_FIXTURES[name].sections.RECRUITMENT_PATHWAY;
const render = (name) => renderToStaticMarkup(
  createElement(RecruitmentPathway, { items: pathway(name) }),
);
const item = (name, kind) => pathway(name).find((i) => i.kind === kind);

describe('every pathway kind can be presented', () => {
  it('covers all ten kinds filed into this section', () => {
    const filed = Object.entries(SECTION_OF)
      .filter(([, section]) => section === SECTIONS.RECRUITMENT_PATHWAY)
      .map(([kind]) => kind);
    expect(filed).toHaveLength(10);
    expect(filed.filter((k) => !PATHWAY_COPY_KINDS.includes(k))).toEqual([]);
  });

  it('presents every item in every fixture', () => {
    const missing = [];
    for (const name of Object.keys(PATHWAY_FIXTURES)) {
      for (const i of pathway(name)) if (!pathwayCopyFor(i)) missing.push(`${name}/${i.kind}`);
    }
    expect(missing).toEqual([]);
  });

  it('shows an unknown kind rather than dropping it', () => {
    const html = renderToStaticMarkup(createElement(RecruitmentPathway, {
      items: [{ kind: 'SOME_FUTURE_PATHWAY_KIND', facts: {}, qualification: {} }],
    }));
    expect(text(html)).toContain('No pathway wording');
    expect(text(html)).toContain('SOME_FUTURE_PATHWAY_KIND');
  });

  it('returns null rather than half a row when a fact is missing', () => {
    expect(pathwayCopyFor({ kind: 'COACH_ARRIVAL_SAME_COUNTRY', facts: { coach: 'X' } })).toBeNull();
    expect(pathwayCopyFor({ kind: 'NOT_A_KIND', facts: { count: 3 } })).toBeNull();
    expect(pathwayCopyFor(null)).toBeNull();
  });

  it('renders no number that did not come from the payload', () => {
    // The same guard the roster section carries. A count divided into a rate,
    // a share recomputed from a count, or two counts added would each appear
    // here as a number with no source.
    for (const name of Object.keys(PATHWAY_FIXTURES)) {
      const items = pathway(name);
      if (!items.length) continue;
      const allowed = new Set();
      const collect = (node) => {
        if (typeof node === 'number') {
          allowed.add(String(node));
          // A decimal the server computed — meanPerIntake is 4.75 — reaches the
          // page whole, but the digit scan below sees "4" and "75". Its
          // one-decimal rounding is licensed formatting and is allowed too:
          // 8/3 is displayed as 2.7, not as 2.6666666666666665.
          String(node).split('.').forEach((part) => allowed.add(part));
          String(Number(node.toFixed(1))).split('.').forEach((part) => allowed.add(part));
          if (node > 0 && node < 1) allowed.add(String(Math.round(node * 100)));
        } else if (typeof node === 'string') {
          // Seasons arrive as strings, and intake keys as "2022->2023".
          (node.match(/\d+/g) ?? []).forEach((v) => allowed.add(v));
        } else if (Array.isArray(node)) node.forEach(collect);
        else if (node && typeof node === 'object') {
          // Keys as well as values: `byIntake` is keyed "2022->2023", so the
          // intake windows on screen live in the keys and nowhere else.
          Object.keys(node).forEach(collect);
          Object.values(node).forEach(collect);
        }
      };
      items.forEach((i) => { collect(i.facts); collect(i.qualification); });

      const rendered = text(renderToStaticMarkup(createElement(RecruitmentPathway, { items })));
      const numbers = rendered.replace(/,/g, '').match(/\d+/g) ?? [];
      const unsourced = [...new Set(numbers)].filter((v) => !allowed.has(v));
      expect(unsourced, `${name} rendered numbers with no source`).toEqual([]);
    }
  });
});

describe('a coach claim keeps its own axes', () => {
  const coach = item('Jacksonville', 'COACH_ARRIVAL_SAME_COUNTRY');
  const t = text(render('Jacksonville'));

  it('carries a null position in the fixture, as most real ones do', () => {
    expect(coach.facts.position).toBeNull();
    expect(coach.facts.country).toBe('New Zealand');
  });

  it('names the coach and the country, and no position', () => {
    const copy = pathwayCopyFor(coach);
    expect(copy.headline).toContain('New Zealand');
    expect(copy.headline).toContain(coach.facts.coach);
    for (const word of ['defender', 'defenders', 'forward', 'midfield', 'goalkeeper']) {
      expect(`${copy.headline} ${copy.detail}`.toLowerCase()).not.toContain(word);
    }
  });

  it('does not borrow a position from the region item beside it', () => {
    const region = item('Jacksonville', 'ARRIVAL_SAME_REGION_POSITION');
    expect(region.facts.position).toBe('DEFENSE');
    // The forbidden synthesis: coach + country + position, assembled from two
    // objects neither of which carries all three. Asserted per item, drawer
    // included — no single claim names both the coach and a position.
    const coachText = itemText(coach, pathwayCopyFor(coach));
    expect(coachText).toContain(coach.facts.coach);
    expect(coachText).not.toMatch(/defender|forward|midfield|goalkeeper/i);
    expect(t).not.toMatch(/New Zealand defender/i);
  });

  it('does not lend its coach to the region item', () => {
    const region = pathwayCopyFor(item('Jacksonville', 'ARRIVAL_SAME_REGION_POSITION'));
    expect(`${region.headline} ${region.detail}`).not.toContain(item('Jacksonville', 'COACH_ARRIVAL_SAME_COUNTRY').facts.coach);
  });

  it('still names no position when the evidence does carry one', () => {
    // Portland's coach item has a position set — 42 of 177 do. Naming it would
    // be accurate there and absent everywhere else, so an operator comparing
    // two programmes would read our record-keeping as a difference between
    // them. The arrivals beneath carry their own positions.
    const withPosition = item('Portland', 'COACH_ARRIVAL_SAME_COUNTRY');
    expect(withPosition.facts.position).not.toBeNull();
    const copy = pathwayCopyFor(withPosition);
    expect(copy.headline.toLowerCase()).not.toContain(withPosition.facts.position.toLowerCase());
  });

  it('reports the coach\'s own intake figures and no others', () => {
    const copy = pathwayCopyFor(coach);
    expect(copy.detail).toContain(
      `${coach.facts.intakesWithArrival} of ${coach.facts.attributableIntakes} intakes`,
    );
  });
});

describe('country and region stay different things', () => {
  it('names countries rather than the region key', () => {
    const region = item('Maryland', 'HISTORICAL_SAME_REGION');
    expect(region.facts.region).toBe('OCEANIA');
    const copy = pathwayCopyFor(region);
    expect(`${copy.headline} ${copy.detail}`).not.toContain('OCEANIA');
    expect(copy.headline).toContain(region.facts.countries[0]);
  });

  it('states the country the regional count excludes', () => {
    const region = item('Maryland', 'HISTORICAL_SAME_REGION');
    expect(region.facts.excludingCountry).toBe('New Zealand');
    // Set on all 507 real instances, and what makes the count honest: the
    // regional figure deliberately leaves out the athlete's own country so it
    // cannot double-count the country evidence.
    expect(pathwayCopyFor(region).detail).toContain('counted separately from New Zealand');
  });

  it('says a regional arrival is the wider cut, not a country match', () => {
    const copy = pathwayCopyFor(item('Jacksonville', 'ARRIVAL_SAME_REGION_POSITION'));
    expect(copy.detail).toContain('wider region rather than their own country');
  });

  it('does not fuse a country item and a region item into one claim', () => {
    // Denver carries country, country+position and current-country evidence.
    const t = text(render('Denver'));
    const country = item('Denver', 'HISTORICAL_SAME_COUNTRY').facts.country;
    // No sentence naming both the country and a region-wide framing at once.
    expect(t).not.toMatch(new RegExp(`${country}[^.]*wider region`, 'i'));
  });
});

describe('a named arrival is shown when there is one, and never invented', () => {
  it('shows the name and season together', () => {
    const arrival = item('Portland', 'ARRIVAL_SAME_COUNTRY_POSITION');
    expect(arrival.facts.namedArrival).toBeTruthy();
    const copy = pathwayCopyFor(arrival);
    expect(copy.names).toEqual([`${arrival.facts.namedArrival}, ${arrival.facts.namedArrivalSeason}`]);
  });

  it('says nothing at all when the evidence exposes no name', () => {
    const missing = pathway('Denver').find((i) => 'namedArrival' in i.facts && i.facts.namedArrival === null);
    expect(missing).toBeTruthy();
    const copy = pathwayCopyFor(missing);
    // Absent means "this evidence does not name one", never "there were none"
    // — the count above it says how many there were.
    expect(copy.names).toBeNull();
    const t = text(renderToStaticMarkup(createElement(RecruitmentPathway, { items: [missing] })));
    expect(t).not.toMatch(/no named|none named|no arrivals/i);
    expect(t).toContain(String(missing.facts.count));
  });
});

describe('current presence and recruiting history read differently', () => {
  it('labels a current-roster item as current', () => {
    const current = item('Wake Forest', 'CURRENT_SAME_COUNTRY');
    expect(current.qualification.temporality).toBe('CURRENT');
    expect(text(render('Wake Forest'))).toContain('Current roster');
  });

  it('labels a historical item as recruiting history', () => {
    const historical = item('Charlotte', 'HISTORICAL_SAME_COUNTRY');
    expect(historical.qualification.temporality).toBe('HISTORICAL');
    expect(text(render('Charlotte'))).toContain('Recruiting history');
  });

  it('words current presence as presence, not as recruiting', () => {
    const copy = pathwayCopyFor(item('Wake Forest', 'CURRENT_SAME_COUNTRY'));
    expect(copy.headline).toContain('on the current roster');
    expect(copy.detail).toContain('says nothing about current recruiting');
  });

  it('does not turn current plus historical into a pattern', () => {
    // Denver has both. "Consistently recruits from New Zealand" is the claim
    // that would be assembled from them, and neither object makes it.
    const t = text(render('Denver'));
    expect(item('Denver', 'CURRENT_SAME_COUNTRY')).toBeTruthy();
    expect(item('Denver', 'HISTORICAL_SAME_COUNTRY')).toBeTruthy();
    for (const claim of [/consistently/i, /regularly recruits/i, /a pattern of/i, /every year/i]) {
      expect(t).not.toMatch(claim);
    }
  });
});

describe('the two international measurements stay separate', () => {
  const t = text(render('Duke'));

  it('renders the roster count from its own facts', () => {
    const f = item('Duke', 'INTERNATIONAL_ROSTER').facts;
    expect(t).toContain(`${f.count} international players from ${f.uniqueCountries} countries`);
  });

  it('renders the share from its own facts', () => {
    const f = item('Duke', 'INTERNATIONAL_SHARE').facts;
    expect(t).toContain(`${Math.round(f.share * 100)}% of the squad is international`);
    expect(t).toContain(`${f.count} of ${f.squadSize} players.`);
  });

  it('recomputes neither from the other', () => {
    const roster = item('Duke', 'INTERNATIONAL_ROSTER').facts;
    const share = item('Duke', 'INTERNATIONAL_SHARE').facts;
    // The share row uses the server's own `share`, not a division of the
    // roster item's count by its own squad size — which would round
    // differently the moment the two items disagreed about either.
    const copy = pathwayCopyFor(item('Duke', 'INTERNATIONAL_SHARE'));
    expect(copy.headline).toContain(`${Math.round(share.share * 100)}%`);

    // Fed a share that contradicts the counts, the copy still reports the
    // share it was given. Nothing here re-derives it.
    const contradictory = pathwayCopyFor({
      kind: 'INTERNATIONAL_SHARE',
      facts: { count: 19, squadSize: 29, share: 0.05 },
    });
    expect(contradictory.headline).toContain('5%');
    expect(contradictory.detail).toContain('19 of 29');

    // And the roster row never mentions a percentage at all.
    expect(pathwayCopyFor(item('Duke', 'INTERNATIONAL_ROSTER')).headline).not.toContain('%');
    expect(roster.count).toEqual(share.count);
  });

  it('does not suggest a more international squad means a better fit', () => {
    for (const claim of [/good fit/i, /strong fit/i, /open to internationals/i, /welcoming/i]) {
      expect(t).not.toMatch(claim);
    }
  });

  it('keeps both beneath the athlete-specific evidence', () => {
    const jax = text(render('Jacksonville'));
    expect(jax.indexOf('Squad and intake overall'))
      .toBeGreaterThan(jax.indexOf('arrivals from New Zealand'));
    expect(jax.indexOf('international players'))
      .toBeGreaterThan(jax.indexOf('Squad and intake overall'));
  });
});

describe('intake history is a measurement, not a forecast', () => {
  const intake = item('Hamilton (Ryan)', 'POSITION_INTAKE_HISTORY');
  const copy = pathwayCopyFor(intake);
  const t = text(render('Hamilton (Ryan)'));

  it('states the count and the number of measured intakes', () => {
    expect(copy.headline).toContain(String(intake.facts.count));
    expect(copy.headline).toContain(`${intake.facts.observedIntakes} measured`);
  });

  it('reports the mean the server computed, and computes none of its own', () => {
    // Rounded for display only. Carleton's is 8/3 and printed in full read
    // "Averaging 2.6666666666666665 per intake" — true, and unreadable.
    const shown = Number(intake.facts.meanPerIntake.toFixed(1));
    expect(copy.detail).toContain(`Averaging ${shown} per intake`);
    expect(copy.detail).not.toMatch(/\.\d{3,}/);
  });

  it('breaks the intakes down by window', () => {
    expect(copy.timeline.map((r) => r.label))
      .toEqual(Object.keys(intake.facts.byIntake).map((k) => k.replace('->', '→')));
    expect(t).toContain('→');
  });

  it('makes no claim about what happens next', () => {
    for (const claim of [/likely/i, /expect/i, /will (take|recruit|need)/i, /need(s)? about/i,
      /due (another|for)/i, /each year they/i, /prefers/i]) {
      expect(t).not.toMatch(claim);
    }
  });

  it('does not put coach context in this section', () => {
    // COACH_CONTEXT is filed under PROGRAMME_CONTEXT, not here. Hamilton has
    // one, and it must not leak into the pathway story.
    expect(pathway('Hamilton (Ryan)').map((i) => i.kind)).not.toContain('COACH_CONTEXT');
    expect(t).not.toMatch(/tenure|has coached|in charge since/i);
  });
});

describe('transfer behaviour is what the squad is made of', () => {
  const transfer = item('Clemson', 'TRANSFER_BEHAVIOUR');
  const copy = pathwayCopyFor(transfer);
  const t = text(render('Clemson'));

  it('counts current-squad players who came from elsewhere', () => {
    expect(copy.headline).toBe(`${transfer.facts.arrivals} of ${transfer.facts.squadSize} came from another programme`);
  });

  it('may say how many play this position, because one object states both', () => {
    expect(copy.detail).toContain(`${transfer.facts.atPosition} of those play this athlete’s position`);
  });

  it('claims nothing about appetite, need or funding', () => {
    for (const claim of [/open to transfers/i, /prefer(s)? transfers/i, /scholarship/i,
      /roster need/i, /looking for/i, /would take/i, /willing/i]) {
      expect(t).not.toMatch(claim);
    }
  });
});

describe('an empty section is unknown, not negative', () => {
  const html = render('Notre Dame');

  it('has no pathway evidence in the fixture', () => {
    expect(pathway('Notre Dame')).toEqual([]);
  });

  it('says what is missing without saying the programme would not recruit', () => {
    expect(text(html)).toContain('No recruiting-pathway evidence on file');
    for (const claim of [/no pathway/i, /does not recruit/i, /unlikely/i, /poor fit/i]) {
      expect(text(html)).not.toMatch(claim);
    }
  });

  it('still shows the section, so the operator can see it was looked at', () => {
    // The heading stays; the framing paragraph does not. It explains how to
    // read rows, and there are none.
    expect(text(html)).toContain('Recruitment pathway');
    expect(text(html)).not.toContain('Recruiting history and roster make-up');
  });
});

describe('the order is the server\'s', () => {
  it('renders athlete-specific items in the order they arrived', () => {
    const t = text(render('Denver'));
    const at = pathway('Denver')
      .filter((i) => pathwayCopyFor(i).scope !== 'programme')
      .map((i) => t.indexOf(pathwayCopyFor(i).headline));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('does not re-rank a list handed to it in another order', () => {
    const reversed = [...pathway('Denver')].reverse();
    const t = text(renderToStaticMarkup(createElement(RecruitmentPathway, { items: reversed })));
    const order = reversed
      .filter((i) => pathwayCopyFor(i).scope !== 'programme')
      .map((i) => t.indexOf(pathwayCopyFor(i).headline));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('the section sits beneath Roster Opportunity and adds to Top Reasons', () => {
  const full = renderToStaticMarkup(
    createElement(ProgrammeDecision, { model: PATHWAY_FIXTURES.Jacksonville }),
  );
  const t = text(full);

  it('renders after the roster section', () => {
    expect(t.indexOf('Recruiting history and roster make-up'))
      .toBeGreaterThan(t.indexOf('Current roster structure'));
  });

  it('renders after the ranked reasons', () => {
    expect(t.indexOf('Recruiting history and roster make-up'))
      .toBeGreaterThan(t.indexOf('reasons identified'));
  });

  it('keeps evidence that is also a top reason', () => {
    const reason = PATHWAY_FIXTURES.Jacksonville.topReasons
      .find((r) => r.primary.kind === 'COACH_ARRIVAL_SAME_COUNTRY');
    expect(reason).toBeTruthy();
    expect(t).toContain('This coach has recruited from New Zealand');   // the reason
    expect(t).toContain('from New Zealand under Ali Simmons');          // the section
  });

  it('adds detail the reason does not carry', () => {
    // The Top Reason names the coach and one arrival. The section adds the
    // intake counts, the season span and the measurement window.
    expect(t).toContain('intakes attributable to this coaching period');
    expect(t).toContain('Recruiting history');
  });

  it('leaves the roster section untouched', () => {
    expect(t).toContain('3 defenders in the graduating class');
    expect(t).toContain('Eligibility runs out across 2026–2027');
    expect(t).toContain('Across the whole squad');
  });

  it('renders no raw JSON or backend vocabulary', () => {
    expect(full).not.toContain('{"');
    expect(full).not.toContain('[object Object]');
    for (const leak of ['COACH_ARRIVAL_SAME_COUNTRY', 'INTERNATIONAL_SHARE', 'OCEANIA',
      'ATTRIBUTED', 'INHERITED', 'minConfidence', 'requiresWindow', 'requiresComparison',
      'COUNTRY_POSITION', 'dedupeGroup']) {
      expect(t).not.toContain(leak);
    }
  });
});

describe('no claim is assembled from two evidence objects', () => {
  /**
   * The four syntheses the payload makes easy and the evidence never supports.
   *
   * Each is checked by rendering the two items TOGETHER — separately they
   * cannot produce the claim, so a test on one item alone would pass whatever
   * the component did. Every row is built from one object's facts, so the
   * combined render must contain neither the fused sentence nor any phrase
   * that reads as one.
   */
  const renderTogether = (items) => text(renderToStaticMarkup(
    createElement(RecruitmentPathway, { items }),
  ));

  it('coach + country + null position never gains a position from a neighbour', () => {
    const coach = item('Jacksonville', 'COACH_ARRIVAL_SAME_COUNTRY');
    const region = item('Jacksonville', 'ARRIVAL_SAME_REGION_POSITION');
    expect(coach.facts.position).toBeNull();
    expect(region.facts.position).toBe('DEFENSE');
    expect(region.facts.countries).toEqual(['Australia']);

    const t = renderTogether([coach, region]);
    // Neither "New Zealand defender" nor a single claim carrying both.
    expect(t).not.toMatch(/New Zealand defender/i);
    const coachText = itemText(coach, pathwayCopyFor(coach));
    const regionText = itemText(region, pathwayCopyFor(region));
    expect(coachText).not.toMatch(/defender|forward|midfield/i);
    // And the region item names no coach, and claims no arrival FROM New
    // Zealand. It does mention the country — as the one its count deliberately
    // excludes, which is the opposite claim and has to stay visible.
    expect(regionText).not.toContain(coach.facts.coach);
    expect(regionText).not.toMatch(/recruited[^.]*from New Zealand/i);
    expect(regionText).toContain('Counted separately from New Zealand');
  });

  it('country + region-position never becomes one country-region-position claim', () => {
    const country = item('Denver', 'HISTORICAL_SAME_COUNTRY');
    const region = item('Portland', 'ARRIVAL_SAME_COUNTRY_POSITION');
    const t = renderTogether([country, region]);
    // Each keeps its own axes; no sentence carries the first item's country
    // together with the second's position.
    const rows = t.split(String.fromCharCode(46));
    for (const row of rows) {
      const hasCountry = row.includes(country.facts.country);
      const hasRegionFraming = /wider region/i.test(row);
      expect(hasCountry && hasRegionFraming).toBe(false);
    }
  });

  it('current + historical country never becomes a recruiting pattern', () => {
    const current = item('Denver', 'CURRENT_SAME_COUNTRY');
    const historical = item('Denver', 'HISTORICAL_SAME_COUNTRY');
    expect(current.facts.country).toBe(historical.facts.country);

    const t = renderTogether([current, historical]);
    // The two counts are never added, and the pair is never characterised.
    const sum = current.facts.count + historical.facts.count;
    expect(t).not.toContain(`${sum} New Zealand`);
    for (const claim of [/consistently/i, /a pattern/i, /repeatedly/i, /over the years/i,
      /keeps recruiting/i, /has a history of recruiting/i]) {
      expect(t).not.toMatch(claim);
    }
  });

  it('international count + share never produce a third figure', () => {
    const roster = item('Duke', 'INTERNATIONAL_ROSTER');
    const share = item('Duke', 'INTERNATIONAL_SHARE');
    const t = renderTogether([roster, share]);

    // Only the server's own percentage appears — not one computed from the
    // roster count, and not a count reconstructed from the share.
    const percentages = [...new Set(t.match(/\d+%/g) ?? [])];
    expect(percentages).toEqual([`${Math.round(share.facts.share * 100)}%`]);

    const recomputedCount = Math.round(share.facts.share * share.facts.squadSize);
    if (recomputedCount !== share.facts.count) {
      expect(t).not.toContain(`${recomputedCount} international`);
    }
    // The country count is never presented as a share of anything. Anchored
    // so it does not match inside a longer figure — uniqueCountries is 6 and
    // the real share is 66%.
    expect(t).not.toMatch(new RegExp(`(?<!\\d)${roster.facts.uniqueCountries}%`));
  });
});
