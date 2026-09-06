import { describe, it, expect } from 'vitest';
import { panelBaseline, panelBaselineHash, panelBaselineReport, STATES } from './panelBaseline.js';

/**
 * The panel's regression artefact.
 *
 * Every other baseline in this repository measures what leaves the building or
 * what the server computed, and none of them can see this component. A JSX
 * change moves nothing they hash — which is how the panel spent H1 offering
 * fifteen swaps the send path would refuse, and H2 shipping with no tests at
 * all.
 *
 * WHEN THIS FAILS: read the printed report, decide whether the change is one
 * you meant, and paste the new hash. It is a tripwire, not a rule — the point
 * is that a change to what an operator reads cannot happen silently.
 */

const HASH = '48306d221099ebe2';

describe('the panel says the same thing it said yesterday', () => {
  it('renders all ten operator states', () => {
    const rendered = panelBaseline();
    expect(rendered).toHaveLength(10);
    expect(rendered.map(([n]) => n)).toEqual(STATES.map(([n]) => n));
    // Non-vacuity: an empty render would hash perfectly happily.
    for (const [name, text] of rendered) {
      expect(text.length, name).toBeGreaterThan(30);
    }
  });

  it('matches the recorded hash', () => {
    expect(panelBaselineHash(), `\n\n${panelBaselineReport()}\n`).toBe(HASH);
  });
});
