// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import MatchmakingResults, { pageWindow } from './MatchmakingResults';
import MatchmakingResultCard from './MatchmakingResultCard';
import MatchmakingPreferences from './MatchmakingPreferences';
import { runView, FORBIDDEN_MAJOR_PHRASES, programmeView } from '@/lib/matchmakingV2View';
import {
  persistedRun, PLAYER, LIMITED_DATA_PROGRAMME, UNSUPPORTED_PROGRAMME, MAJOR_REFUSAL_PROGRAMME,
} from '@/lib/__fixtures__/matchmakingV2Run.js';

let container;
let root;

const mount = (ui) => act(() => { root.render(createElement(MemoryRouter, null, ui)); });
const text = () => container.textContent;
const all = (sel) => [...container.querySelectorAll(sel)];
const find = (sel) => container.querySelector(sel);
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const RUN = () => runView(persistedRun());

describe('Matchmaking V2 — results surface', () => {
  /* ------------------------------------------------------------------ */
  /* Bands and rank — §F, §N                                            */
  /* ------------------------------------------------------------------ */

  it('S1. the default view is the Top 100, and #101 is not in it', () => {
    mount(createElement(MatchmakingResults, { run: RUN() }));
    expect(text()).toContain('Lindenwood');
    expect(text()).toContain('Catawba');
    expect(text()).not.toContain('Millikin');
  });

  it('S2. every band renders its words AND its rank range, never colour alone', () => {
    mount(createElement(MatchmakingResults, { run: RUN() }));
    const chips = all('[data-testid="band-chip"]').map((c) => c.textContent);

    expect(chips[0]).toContain('Priority outreach');
    expect(chips[0]).toContain('1–25');
    expect(chips.some((c) => c.includes('Strong pursuit') && c.includes('26–50'))).toBe(true);
    expect(chips.some((c) => c.includes('Viable consideration') && c.includes('51–100'))).toBe(true);
    /**
     * §S. Strip every class and the band is still legible — the colour is a
     * second signal, never the only one.
     */
    for (const chip of all('[data-testid="band-chip"]')) {
      expect(chip.textContent.trim().length).toBeGreaterThan(5);
    }
  });

  it('S3. exact rank stays visible beside the band', () => {
    mount(createElement(MatchmakingResults, { run: RUN() }));
    expect(text()).toContain('#1');
    expect(text()).toContain('#100');
  });

  it('S4. Full universe exposes #101+, LIMITED_DATA and unsupported together', () => {
    mount(createElement(MatchmakingResults, { run: RUN() }));
    const [, fullTab] = all('[role="tab"]');
    click(fullTab);

    expect(text()).toContain('Millikin');
    expect(text()).toContain('Trinity Christian');
    expect(text()).toContain('Garden City Community');
    expect(find('[data-testid="band-chip"]').textContent).toContain('Priority outreach');
  });

  it('S5. the run’s own counts are shown, not a recount of the loaded page', () => {
    mount(createElement(MatchmakingResults, { run: RUN() }));
    const counts = find('[data-testid="universe-counts"]').textContent;
    expect(counts).toContain('828 ranked');
    expect(counts).toContain('89');
    expect(counts).toContain('288');
  });

  it('S6. Pursuit is a whole number and carries a note that ties can happen', () => {
    mount(createElement(MatchmakingResultCard, {
      programme: programmeView(persistedRun().programmes[0]),
    }));
    click(find('button'));
    expect(text()).toMatch(/Pursuit\s*67/);
    expect(text()).not.toContain('0.665');
    expect(text()).toContain('Scores are rounded');
  });

  /* ------------------------------------------------------------------ */
  /* The two non-ranked states — §J, §K                                 */
  /* ------------------------------------------------------------------ */

  it('S7. LIMITED_DATA says what THRIV3 lacks, carries no band, and is not a verdict', () => {
    mount(createElement(MatchmakingResultCard, { programme: programmeView(LIMITED_DATA_PROGRAMME) }));
    click(find('button'));

    expect(find('[data-testid="programme-SUPPORTED_LIMITED_DATA"]')).toBeTruthy();
    expect(find('[data-testid="band-chip"]')).toBeNull();
    expect(text()).toContain('Not enough evidence to rank');
    expect(text()).toContain('does not hold enough evidence');
    expect(text()).toContain('not a judgement about the programme');

    /** The engine's own refusal sentence is shown, so it is inspectable. */
    expect(text()).toContain('Thriv3 holds no current roster for this programme');

    for (const banned of ['poor match', 'weak', 'unlikely', 'bad fit']) {
      expect(text().toLowerCase()).not.toContain(banned);
    }
  });

  it('S8. UNSUPPORTED is visually and verbally distinct from LIMITED_DATA', () => {
    mount(createElement(MatchmakingResultCard, { programme: programmeView(UNSUPPORTED_PROGRAMME) }));
    click(find('button'));

    expect(find('[data-testid="programme-UNSUPPORTED_ASSOCIATION"]')).toBeTruthy();
    expect(text()).toContain('Association not modelled');
    expect(text()).toContain('eligibility rules');
    /** It must NOT imply the athlete cannot go there — §K. */
    expect(text()).toContain('can attend these institutions');
    expect(text()).not.toContain('Not enough evidence to rank');
  });

  it('S9. the two states do not share a chip or a left rule', () => {
    mount(createElement('div', null,
      createElement(MatchmakingResultCard, { key: 'a', programme: programmeView(LIMITED_DATA_PROGRAMME) }),
      createElement(MatchmakingResultCard, { key: 'b', programme: programmeView(UNSUPPORTED_PROGRAMME) })));

    const limited = find('[data-testid="programme-SUPPORTED_LIMITED_DATA"]');
    const unsupported = find('[data-testid="programme-UNSUPPORTED_ASSOCIATION"]');
    expect(limited.className).not.toBe(unsupported.className);
    expect(find('[data-testid="state-chip-SUPPORTED_LIMITED_DATA"]').textContent)
      .not.toBe(find('[data-testid="state-chip-UNSUPPORTED_ASSOCIATION"]').textContent);
  });

  /* ------------------------------------------------------------------ */
  /* The major — §L                                                     */
  /* ------------------------------------------------------------------ */

  it('S10. the intended major is shown as an active ranking preference', () => {
    mount(createElement(MatchmakingPreferences, { player: PLAYER }));
    expect(find('[data-testid="major-preference"]').textContent)
      .toBe('Major preference: Exercise Science');
    /** Read-only in A9.3: no removal affordance that would do nothing. */
    expect(find('[data-testid="major-preference"] button')).toBeNull();
    expect(text()).toContain('Change them in Edit Profile');
  });

  it('S11. no absent-major wording can render, from any of the three states', () => {
    /**
     * THE LANGUAGE BOUNDARY, RENDERED RATHER THAN ASSERTED ON A CONSTANT.
     *
     * A8.2 removed "absent from notable_majors implies not offered" from the
     * engine. This renders every surface that could put it back — including
     * the one refusal code that names a major — and reads the actual DOM.
     */
    const programmes = [
      ...persistedRun().programmes,
      MAJOR_REFUSAL_PROGRAMME,
    ].map(programmeView);

    for (const programme of programmes) {
      act(() => { root.render(createElement(MemoryRouter, null,
        createElement(MatchmakingResultCard, { programme }))); });
      click(find('button'));
      const rendered = text().toLowerCase();
      for (const banned of FORBIDDEN_MAJOR_PHRASES) {
        expect(rendered, `"${banned}" rendered for ${programme.name}`).not.toContain(banned);
      }
    }
  });

  it('S12. the major refusal states what the recorded list covers', () => {
    mount(createElement(MatchmakingResultCard, { programme: programmeView(MAJOR_REFUSAL_PROGRAMME) }));
    click(find('button'));
    expect(text()).toContain('largest fields of study');
    expect(text()).toContain('whether it is offered is not established');
  });

  it('S13. all three stated priorities are shown, with "Not answered" kept visible', () => {
    mount(createElement(MatchmakingPreferences, { player: { ...PLAYER, academic_strength_priority: null } }));
    expect(find('[data-testid="preference-competitive_level_priority"]')).toBeTruthy();
    expect(find('[data-testid="preference-playing_opportunity_priority"]')).toBeTruthy();
    expect(find('[data-testid="preference-academic_strength_priority"]').textContent)
      .toContain('Not answered');
  });

  /* ------------------------------------------------------------------ */
  /* Explanation, privacy, accessibility — §I, §24, §S                  */
  /* ------------------------------------------------------------------ */

  it('S14. the explanation exposes layer evidence and no internal machinery', () => {
    mount(createElement(MatchmakingResultCard, {
      programme: programmeView(persistedRun().programmes[0]),
    }));
    click(find('button'));

    expect(text()).toContain('Coach recruitability');
    expect(text()).toContain('Financial viability');
    expect(text()).toContain('Athlete opportunity');
    expect(text()).toContain('Measured');

    /** None of the engine's internals — §I. */
    for (const banned of ['weight', 'basis', 'midrank', 'smoothstep', 'percentile', 'calibrat']) {
      expect(text().toLowerCase()).not.toContain(banned);
    }
  });

  it('S15. coverage is reported only where it is short of full', () => {
    mount(createElement(MatchmakingResultCard, { programme: programmeView(LIMITED_DATA_PROGRAMME) }));
    click(find('button'));
    /** Financial is fully covered and says nothing; nothing claims "100%". */
    expect(text()).not.toContain('100% of this layer');
  });

  it('S16. the disclosure is a real button with announced state — §S', () => {
    mount(createElement(MatchmakingResultCard, {
      programme: programmeView(persistedRun().programmes[0]),
    }));
    const button = find('button');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBeTruthy();
    click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  /* ------------------------------------------------------------------ */
  /* Paging the full universe — §G, §Q                                  */
  /* ------------------------------------------------------------------ */

  it('S17. the pager can address the last page of a 1,205-programme run', () => {
    /**
     * V1's pager renders `min(totalPages, 5)` buttons and would leave pages 6
     * to 61 unreachable. This is the test that would have caught shipping it.
     */
    const window61 = pageWindow(1, 61);
    expect(window61).toContain(61);
    expect(window61).toContain(1);
    expect(pageWindow(30, 61)).toEqual([1, null, 28, 29, 30, 31, 32, null, 61]);
    expect(pageWindow(1, 1)).toEqual([1]);
  });

  it('S18. only one page of cards is mounted, with the whole run still in state', () => {
    const run = runView(persistedRun());
    mount(createElement(MatchmakingResults, { run }));
    /** Six ranked programmes are inside the Top 100; the run holds eleven. */
    expect(all('[data-testid^="programme-"]')).toHaveLength(6);
    expect(run.programmes).toHaveLength(11);
  });

  it('S19. switching scope returns to the first page rather than an empty one', () => {
    mount(createElement(MatchmakingResults, { run: RUN() }));
    const [topTab, fullTab] = all('[role="tab"]');
    click(fullTab);
    expect(text()).toContain('Lindenwood');
    click(topTab);
    expect(text()).toContain('Lindenwood');
    expect(all('[data-testid^="programme-"]').length).toBeGreaterThan(0);
  });

  it('S20. no person-level data reaches a result surface', () => {
    mount(createElement(MatchmakingResults, { run: RUN() }));
    const rendered = text();
    for (const banned of ['@', 'guardian', 'phone', 'player-1', 'run-0001']) {
      expect(rendered.toLowerCase()).not.toContain(banned);
    }
  });
});
