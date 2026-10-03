// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import MatchmakingPreferences from './MatchmakingPreferences';
import IntendedMajorField from '@/components/IntendedMajorField';
import { runView, FORBIDDEN_MAJOR_PHRASES } from '@/lib/matchmakingV2View';
import { persistedRun, PLAYER } from '@/lib/__fixtures__/matchmakingV2Run.js';
import { CONTRIBUTION_STATE } from '@/lib/contributionIntake';

/**
 * THE INPUT CONTROLS — A9.4 §G, §I, §J, §N, §O, §Q.
 *
 * Two things are being protected here. One is that an operator can SEE what a
 * ranking was built from and what has moved since. The other is the A8.2
 * language boundary, which now has a second place to leak from: a field that
 * tells someone their major is unusable is one careless sentence away from
 * telling them no institution offers it.
 */

let container;
let root;

const mount = (ui) => act(() => { root.render(createElement(MemoryRouter, null, ui)); });
const text = () => container.textContent;
const find = (sel) => container.querySelector(sel);
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

/** A run whose snapshot matches PLAYER, so nothing reads as changed. */
const matchingRun = () => runView(persistedRun({
  inputSnapshot: {
    intended_major: PLAYER.intended_major,
    competitive_level_priority: PLAYER.competitive_level_priority,
    playing_opportunity_priority: PLAYER.playing_opportunity_priority,
    academic_strength_priority: PLAYER.academic_strength_priority,
    contribution_state: CONTRIBUTION_STATE.STATED,
    max_annual_contribution_usd: 25000,
  },
}));

const STATED_PLAYER = {
  ...PLAYER,
  contribution_state: CONTRIBUTION_STATE.STATED,
  max_annual_contribution_usd: 25000,
};

/* ------------------------------------------------------------------ */
/* §N — the family contribution is on the Matchmaking screen          */
/* ------------------------------------------------------------------ */

describe('A9.4 §N. the preference summary shows every active input', () => {
  it('N1. a stated contribution is shown in dollars, from the canonical summary', () => {
    mount(createElement(MatchmakingPreferences, { player: STATED_PLAYER, run: matchingRun() }));
    const chip = find('[data-testid="preference-contribution"]').textContent;
    expect(chip).toContain('Maximum family contribution');
    expect(chip).toContain('$25,000 / year');
  });

  it('N2. NOT_A_CONSTRAINT is its own statement, never a large number', () => {
    mount(createElement(MatchmakingPreferences, {
      player: { ...PLAYER, contribution_state: CONTRIBUTION_STATE.NOT_A_CONSTRAINT, max_annual_contribution_usd: null },
      run: matchingRun(),
    }));
    const chip = find('[data-testid="preference-contribution"]').textContent;
    expect(chip).toContain('not a meaningful constraint');
    expect(chip).not.toMatch(/\$\s?\d/);
  });

  it('N3. an unresolved contribution is flagged, and is never rendered as $0', () => {
    mount(createElement(MatchmakingPreferences, {
      player: { ...PLAYER, contribution_state: CONTRIBUTION_STATE.NEEDS_CONFIRMATION, max_annual_contribution_usd: null },
      run: matchingRun(),
    }));
    const chip = find('[data-testid="preference-contribution"]');
    expect(chip.textContent).toContain('Needs confirmation');
    /** The one coercion this product must never make — §G. */
    expect(text()).not.toContain('$0');
    expect(chip.className).toContain('amber');
  });

  it('N4. an unanswered optional preference is not louder than an active one', () => {
    /**
     * A9.3 shipped this backwards once: three bright "Not answered" chips
     * beside a dim chip naming the preference actually doing the work.
     */
    mount(createElement(MatchmakingPreferences, {
      player: { ...STATED_PLAYER, competitive_level_priority: null },
      run: matchingRun(),
    }));
    const unanswered = find('[data-testid="preference-competitive_level_priority"]');
    expect(unanswered.textContent).toContain('Not answered');
    expect(unanswered.className).toContain('italic');
    expect(unanswered.className).toContain('muted');
    /** The major, which IS active, carries the default (primary) treatment. */
    expect(find('[data-testid="major-preference"]').className).not.toContain('muted');
  });
});

/* ------------------------------------------------------------------ */
/* §O — current profile versus the profile this run used              */
/* ------------------------------------------------------------------ */

describe('A9.4 §O. what has changed since this ranking', () => {
  it('O1. nothing is marked when the profile still matches the run', () => {
    mount(createElement(MatchmakingPreferences, { player: STATED_PLAYER, run: matchingRun() }));
    expect(text()).not.toContain('changed');
    expect(text()).toContain('does not re-rank on its own');
  });

  it('O2. only the fields that moved are marked, and in words', () => {
    mount(createElement(MatchmakingPreferences, {
      player: { ...STATED_PLAYER, academic_strength_priority: 5, intended_major: 'Business' },
      run: matchingRun(),
    }));
    expect(find('[data-testid="preference-academic_strength_priority"]').textContent).toContain('changed');
    expect(find('[data-testid="major-preference"]').textContent).toContain('changed');
    /** An untouched field is not marked. */
    expect(find('[data-testid="preference-playing_opportunity_priority"]').textContent)
      .not.toContain('changed');
    /** §Q: the marker is a word, not a dot or a colour. */
    expect(text()).toContain('Marked inputs have changed since this ranking');
  });

  it('O3. a contribution change is marked from either half of the pair', () => {
    mount(createElement(MatchmakingPreferences, {
      player: { ...STATED_PLAYER, max_annual_contribution_usd: 40000 },
      run: matchingRun(),
    }));
    expect(find('[data-testid="preference-contribution"]').textContent).toContain('changed');
  });

  it('O4. a run carrying no snapshot marks nothing rather than marking everything', () => {
    const noSnapshot = runView(persistedRun({ inputSnapshot: null }));
    mount(createElement(MatchmakingPreferences, { player: STATED_PLAYER, run: noSnapshot }));
    expect(text()).not.toContain('changed');
  });
});

/* ------------------------------------------------------------------ */
/* §I / §J — the major control                                        */
/* ------------------------------------------------------------------ */

function MajorHarness({ initial }) {
  const [v, setV] = useState(initial);
  return createElement('div', null,
    createElement(IntendedMajorField, { value: v, onChange: setV }),
    createElement('output', { 'data-testid': 'value' }, JSON.stringify(v)));
}

const value = () => find('[data-testid="value"]').textContent;
const typeMajor = (s) => {
  const input = find('input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  act(() => {
    setter.call(input, s);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('A9.4 §I. the intended major is editable, removable and clearly optional', () => {
  it('I1. a placeable major says so, naming the family Thriv3 read', () => {
    mount(createElement(MajorHarness, { initial: 'exercise science' }));
    expect(find('[data-testid="major-intent-VALID"]')).toBeTruthy();
    expect(text()).toContain('will use it when ranking');
  });

  it('I2. an UNPLACEABLE major is called out — the silent failure this field exists for', () => {
    /**
     * `majorFit` returns NOT_APPLICABLE for an unplaceable major, which costs
     * no coverage and changes no ranking. Without this notice the operator
     * sees a saved major, a chip on the Matchmaking screen, and no indication
     * whatsoever that it is doing nothing.
     */
    /**
     * "Equine Studies" rather than the first thing that came to mind. The
     * taxonomy is better than it looks: "Sports Management" places as
     * Kinesiology, which is why an earlier draft of this test asserted
     * UNSUPPORTED and failed. These are real degrees that Thriv3's fourteen
     * families genuinely cannot place, which is the case an operator meets.
     */
    mount(createElement(MajorHarness, { initial: 'Equine Studies' }));
    expect(find('[data-testid="major-intent-UNSUPPORTED"]')).toBeTruthy();
    expect(text()).toContain('cannot currently map this');
    expect(text()).toContain('will not affect ranking');
  });

  it('I3. "undecided" is a real answer, not an error', () => {
    mount(createElement(MajorHarness, { initial: 'Undecided' }));
    expect(find('[data-testid="major-intent-UNDECIDED"]')).toBeTruthy();
    expect(text()).toContain('correct outcome until the athlete has a field in mind');
  });

  it('I4. empty is optional and says so, with no Remove offered', () => {
    mount(createElement(MajorHarness, { initial: '' }));
    expect(find('[data-testid="major-intent-MISSING"]')).toBeTruthy();
    expect(text()).toContain('Optional');
    expect(find('[data-testid="remove-major"]')).toBeNull();
  });

  it('I5. typing changes the verdict live, and Remove clears the value', () => {
    mount(createElement(MajorHarness, { initial: '' }));
    typeMajor('Equine Studies');
    expect(find('[data-testid="major-intent-UNSUPPORTED"]')).toBeTruthy();

    typeMajor('business');
    expect(find('[data-testid="major-intent-VALID"]')).toBeTruthy();

    click(find('[data-testid="remove-major"]'));
    expect(value()).toBe('""');
    expect(find('[data-testid="major-intent-MISSING"]')).toBeTruthy();
    expect(find('[data-testid="remove-major"]')).toBeNull();
  });

  it('I6. Remove is a real keyboard-operable button, and the verdict is announced — §Q', () => {
    mount(createElement(MajorHarness, { initial: 'business' }));
    const remove = find('[data-testid="remove-major"]');
    expect(remove.tagName).toBe('BUTTON');
    expect(remove.getAttribute('type')).toBe('button');
    expect(remove.textContent.trim()).toBe('Remove');

    const input = find('input');
    const note = find('[role="status"]');
    expect(note).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBe(note.getAttribute('id'));
    expect(container.querySelector(`label[for="${input.getAttribute('id')}"]`)).toBeTruthy();
  });
});

describe('A9.4 §J. the major language boundary holds at the point of entry', () => {
  it('J1. no state of this field can claim an institution does not offer a major', () => {
    for (const major of ['', 'business', 'Undecided', 'Equine Studies', 'Viticulture', 'mathematics', 'Sports Management']) {
      act(() => { root.render(createElement(MemoryRouter, null, createElement(MajorHarness, { initial: major }))); });
      const rendered = text().toLowerCase();
      for (const banned of FORBIDDEN_MAJOR_PHRASES) {
        expect(rendered, `"${banned}" rendered for "${major}"`).not.toContain(banned);
      }
      /** And nothing claims to know a catalogue. */
      for (const banned of ['no programmes offer', 'not available at', 'no school offers']) {
        expect(rendered).not.toContain(banned);
      }
    }
  });

  it('J2. every sentence is about what THRIV3 can map, not about institutions', () => {
    mount(createElement(MajorHarness, { initial: 'Equine Studies' }));
    expect(text()).toContain('Thriv3 cannot currently map');
    expect(text().toLowerCase()).not.toContain('institution');
    expect(text().toLowerCase()).not.toContain('college does');
  });

  it('J3. the Matchmaking summary repeats the same boundary for an unplaceable major', () => {
    mount(createElement(MatchmakingPreferences, {
      player: { ...STATED_PLAYER, intended_major: 'Equine Studies' },
      run: matchingRun(),
    }));
    const notice = find('[data-testid="major-unplaceable"]');
    expect(notice).toBeTruthy();
    expect(notice.textContent).toContain('not affecting this ranking');
    for (const banned of FORBIDDEN_MAJOR_PHRASES) {
      expect(text().toLowerCase()).not.toContain(banned);
    }
  });
});
