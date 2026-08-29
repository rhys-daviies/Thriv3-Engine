import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every workspace tab must read a key the workspace actually provides.
 *
 * `EvidenceTab` destructured `analysis` and then read `analysis.recommendations`.
 * The workspace puts `recommendations` at the TOP LEVEL of the outlet context
 * and has no `analysis` key at all, so the value was permanently undefined and
 * the tab reported "run the analysis on the Matching tab first" however many
 * times it had been run. Nothing failed, nothing logged, and the request to
 * `/api/players/:id/evidence` was never even made — the whole tab was dead and
 * looked merely empty.
 *
 * Destructuring a missing key is silent in JavaScript, which is exactly why
 * this needs a test rather than review. Scanned as source text because the
 * failure is a mismatch between two files that never import each other.
 */

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf-8');

/** The keys `<Outlet context={{ … }} />` actually publishes. */
function providedKeys() {
  const src = read('PlayerWorkspace.jsx');
  const open = src.indexOf('<Outlet context={{');
  expect(open, 'PlayerWorkspace must render <Outlet context={{ … }} />').toBeGreaterThan(-1);
  const close = src.indexOf('}}', open + 18);
  return src.slice(open + 18, close)
    .split(',')
    .map((part) => part.split(':')[0].trim())
    .filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
}

/** What each tab pulls out of the workspace context. */
function consumedKeys(file) {
  const src = read(file);
  const m = src.match(/const\s*\{([^}]*)\}\s*=\s*(?:usePlayerWorkspace|useOutletContext)\s*\(\s*\)/);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((part) => part.split(':')[0].trim())
    .filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
}

const TABS = fs.readdirSync(DIR).filter((f) => /Tab\.jsx$/.test(f));

describe('workspace tabs read keys the workspace provides', () => {
  const provided = providedKeys();

  it('finds the published context keys', () => {
    expect(provided).toContain('player');
    expect(provided).toContain('recommendations');
    // The key whose absence caused the bug. If a future refactor introduces an
    // `analysis` wrapper this test should be updated deliberately, not by
    // a tab quietly reaching for it again.
    expect(provided).not.toContain('analysis');
  });

  it('finds tabs to check', () => {
    expect(TABS.length).toBeGreaterThan(2);
  });

  it.each(TABS)('%s destructures only keys that exist', (file) => {
    const consumed = consumedKeys(file);
    if (consumed === null) return;   // tab takes nothing from the context
    const missing = consumed.filter((k) => !provided.includes(k));
    expect(missing, `${file} reads context keys that do not exist`).toEqual([]);
  });

  /**
   * Consistency, not style. Every other tab goes through the helper; the one
   * that reached for `useOutletContext()` directly is the one that got the
   * shape wrong, because the helper is where the shape is documented.
   */
  it.each(TABS)('%s goes through usePlayerWorkspace', (file) => {
    const src = read(file);
    if (!/usePlayerWorkspace|useOutletContext/.test(src)) return;
    // The IMPORT, not any mention — EvidenceTab's comment names the hook it
    // stopped using, and a test that failed on prose would push people to
    // delete the explanation rather than fix the code.
    expect(src, `${file} should use usePlayerWorkspace, not useOutletContext`)
      .not.toMatch(/import[^;]*\buseOutletContext\b[^;]*from/);
  });
});
