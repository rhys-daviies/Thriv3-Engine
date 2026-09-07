import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { K_TIGHT } from './__fixtures__/validationAthletes.js';
import { emailBodyFor, buildEmailContext, fillTemplate, validateTemplate, canComposeStructured, BODY_SOURCE } from '../../src/lib/emailTemplate.js';
import { countryPhrase, articleCountries, canonicalCountry } from '../recruiting/regions.js';
import { seasonsInWindow, recentSeasons } from './outreachContract.js';
import { OUTREACH_POLICY_VERSION, KNOWN_POLICY_VERSIONS } from './outreachPolicy.js';

/**
 * K3C — the four remediations, each proved where it can be proved cheaply.
 *
 * The corpus-level effects live in `generalisation.test.js`, which drives the
 * real path. This file holds the units that file cannot reach: display
 * grammar, the season-window helper's refusal to change qualification, and the
 * saved-template path, which no production athlete exercises.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const d = fs.existsSync(DB) ? describe : describe.skip;

/* -------------------------------------------------------------------------- */
/* Country display grammar                                                     */
/* -------------------------------------------------------------------------- */

describe('countryPhrase is display grammar and nothing else', () => {
  it('adds the article to the countries that take one', () => {
    for (const [raw, want] of [
      ['United Kingdom', 'the United Kingdom'],
      ['Netherlands', 'the Netherlands'],
      ['Dominican Republic', 'the Dominican Republic'],
      ['Bahamas', 'the Bahamas'],
      ['United Arab Emirates', 'the United Arab Emirates'],
      ['Democratic Republic of the Congo', 'the Democratic Republic of the Congo'],
      ['Congo', 'the Congo'],
      ['Philippines', 'the Philippines'],
      ['Gambia', 'the Gambia'],
    ]) expect(countryPhrase(raw), raw).toBe(want);
  });

  it('leaves alone the countries that do not', () => {
    // Czechia is the one the obvious `Republic|Kingdom|States` regex gets
    // wrong: the Czech Republic takes an article, Czechia does not, and
    // Czechia is the canonical name here. Ukraine is the other — an article
    // there is not a stylistic choice.
    for (const c of ['Czechia', 'Ukraine', 'Norway', 'Japan', 'Ireland', 'Sweden', 'Brazil']) {
      expect(countryPhrase(c), c).toBe(c);
    }
  });

  it('canonicalises before deciding, so an alias gets the right answer', () => {
    expect(countryPhrase('Korea, Republic of')).toBe('South Korea');
  });

  it('returns null rather than a sentence fragment for nothing', () => {
    for (const v of [null, undefined, '', '   ']) expect(countryPhrase(v)).toBeNull();
  });

  it('passes through an unknown but valid country unchanged', () => {
    expect(countryPhrase('Wakanda')).toBe('Wakanda');
  });

  it('lists only canonical names, so no entry is dead', () => {
    // `countryPhrase` canonicalises before consulting the list, so an alias in
    // it can never match. "Czech Republic" was in the first draft and resolves
    // to "Czechia", which takes no article — the entry did nothing, and the
    // failure mode is silent.
    for (const c of articleCountries()) expect(canonicalCountry(c), c).toBe(c);
  });

  it('never changes stored identity', () => {
    // The article is added on the way to a sentence and never on the way to a
    // comparison. If these two ever agree, something is grouping on prose.
    for (const c of articleCountries()) {
      expect(countryPhrase(c), c).toBe(`the ${c}`);
      expect(countryPhrase(c), c).not.toBe(canonicalCountry(c));
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The season window does not change qualification                             */
/* -------------------------------------------------------------------------- */

describe('seasonsInWindow is display-only', () => {
  it('never turns a refused claim into a rendered one', () => {
    // The case the two helpers deliberately disagree on: a future season makes
    // `recentSeasons` refuse the whole list, and the window still contains a
    // valid year. Copy must never be the thing that admits a claim.
    expect(recentSeasons(['2027', '2025'])).toBeNull();
    expect(seasonsInWindow(['2027', '2025'])).toEqual([2025]);
  });

  it('is empty exactly when the claim is stale', () => {
    expect(seasonsInWindow(['2023'])).toEqual([]);
    expect(recentSeasons(['2023'])).toBeNull();
  });

  it('returns the qualifying years ascending and deduplicated', () => {
    expect(seasonsInWindow(['2026', '2023', '2025', '2026'])).toEqual([2025, 2026]);
  });
});

/* -------------------------------------------------------------------------- */
/* Saved templates — the path no production athlete exercises                   */
/* -------------------------------------------------------------------------- */

/**
 * SYNTHETIC, AND DELIBERATELY NOT IN THE CORPUS.
 *
 * K3A found that a mutation of the template path moved no baseline: none of
 * the four production athletes holds a saved template, so all 4,742 pairs take
 * the structured path and the template is dead code to every hash.
 *
 * The fix is not to give a real athlete a template — that is production data,
 * and it would move all six pins for a testing reason. It is this: a fixture
 * that never touches the database, driven through the same `emailBodyFor` a
 * draft calls, asserting the things a custom template must not be able to do.
 */
const SAVED = Object.freeze({
  ...K_TIGHT,
  id: 'K3C-TEMPLATE',
  email_template: [
    'Hi {{coach_name}},',
    '',
    '{{evidence_paragraph}}',
    '',
    'A note about {{player_first_name}} for {{college_name}}.',
    '',
    '{{player_profile_url}}',
  ].join('\n'),
});

const COLLEGE = Object.freeze({ name: 'Appalachian State', sport: 'womens-soccer' });

d('a saved template renders through the production path', () => {
  const evidence = null; // no engine output: the template must stand alone
  const out = () => emailBodyFor(SAVED, COLLEGE, 'Coach Fixture', {
    evidence, profileUrl: 'https://k3c.invalid/p',
  });

  it('takes the TEMPLATE path, not the structured one', () => {
    expect(canComposeStructured(SAVED)).toBe(false);
    expect(out().source).toBe(BODY_SOURCE.TEMPLATE);
  });

  it('resolves the tokens a custom template is allowed to use', () => {
    const { body } = out();
    expect(body).toContain('Hi Coach Fixture,');
    expect(body).toContain('Appalachian State');
    expect(body).toContain('https://k3c.invalid/p');
    expect(body).not.toMatch(/\{\{|\bundefined\b|\bNaN\b|\[object/);
  });

  it('resolves no retired per-kind claim token', () => {
    // The J5/J6 list. A template asking for one gets the literal token back,
    // which is visible and fixable; what it must never get is a claim.
    const RETIRED = ['graduating_seniors_count', 'graduating_seniors_names',
      'has_graduating_seniors', 'graduating_starters_names', 'graduating_total_count',
      'international_players_count', 'players_from_country_count', 'is_conference_champion',
      'postseason_round_label', 'has_postseason_result', 'intended_major_label'];
    const ctx = buildEmailContext(SAVED, COLLEGE, 'Coach Fixture', { evidence: null });
    for (const t of RETIRED) {
      expect(ctx, t).not.toHaveProperty(t);
      expect(fillTemplate(`{{#if ${t}}}LEAK{{/if}}{{${t}}}`, ctx).replace(/\{\{[^}]+\}\}/g, '').trim(), t).toBe('');
    }
  });

  it('rejects retired and unknown tokens at validation', () => {
    const bad = validateTemplate('Hi {{coach_name}} {{graduating_seniors_names}} {{not_a_token}}');
    expect(bad.valid).toBe(false);
    expect(bad.unknown).toContain('graduating_seniors_names');
    expect(bad.unknown).toContain('not_a_token');
    expect(validateTemplate(SAVED.email_template).valid).toBe(true);
  });

  it('cannot synthesise programme fit with no evidence', () => {
    // `evidence_paragraph` is the ONE way a claim reaches a custom template,
    // and with no engine output there is no claim. A template that asks for it
    // anyway must get nothing rather than an invented sentence.
    const { body } = out();
    expect(body).not.toMatch(/the programme has taken|came into the programme|you brought/);
    expect(body).not.toMatch(/listed to graduate|among the programmes you list/);
  });
});

/* -------------------------------------------------------------------------- */
/* Presence opened; absence did not                                            */
/* -------------------------------------------------------------------------- */

/**
 * THE ONE THING K3C MUST NOT HAVE DONE.
 *
 * Opening presence for women's soccer is safe because under-recording can only
 * undercount an observed arrival. The same under-recording makes "nobody from
 * X" unsayable, and that claim is gated somewhere else entirely —
 * `countryAbsence` in `patterns.js`, on the same UNVALIDATED status this
 * generator stopped reading. If the two ever come loose, a missing row becomes
 * a statement that nobody exists.
 */
d('presence opened without opening absence', () => {
  /*
   * Driven in a subprocess, like every other DB-backed suite here: the
   * database client resolves its path at import time and vitest's cwd is not
   * where it looks.
   */
  const probe = (body) => JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
    process.env.RECRUITMATCH_DB = ${JSON.stringify(DB)};
    const { loadProgrammePatterns } = await import(${JSON.stringify(path.join(ROOT, 'server/lib/recruitingPatterns.js'))});
    const { evidenceFor } = await import(${JSON.stringify(path.join(ROOT, 'server/lib/evidenceQueries.js'))});
    const { K_TIGHT } = await import(${JSON.stringify(path.join(ROOT, 'shared/evidence/__fixtures__/validationAthletes.js'))});
    ${body}
  `], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));

  it('still refuses to read a women\'s zero as an observation', () => {
    const w = probe(`const p = loadProgrammePatterns('womens-soccer', 'Appalachian State');
      process.stdout.write(JSON.stringify({ status: p.dataStatus.status,
        country: p.countries.absence, region: p.regions.absence }));`);
    expect(w.status).toBe('UNVALIDATED');
    for (const cut of [w.country, w.region]) {
      expect(cut.reportable).toBe(false);
      expect(cut.reasons.join(' ')).toMatch(/UNVALIDATED/);
    }
  });

  it('lets an observed women\'s arrival be stated', () => {
    const kinds = probe(`const ev = evidenceFor(K_TIGHT, 'Appalachian State', { sport: 'womens-soccer' });
      process.stdout.write(JSON.stringify((ev.composition?.sentences ?? []).map((s) => s.kind)));`);
    expect(kinds).toContain('ARRIVAL_SAME_REGION_POSITION');
  });

  it('turns a missing row into silence, never into an absence claim', () => {
    // Duke has no Irish or UK_IRELAND midfield arrival. The correct output is
    // no country sentence at all — not "no Irish players have come through".
    const out = probe(`const ev = evidenceFor(K_TIGHT, 'Duke', { sport: 'womens-soccer' });
      const s = ev.composition?.sentences ?? [];
      process.stdout.write(JSON.stringify({ kinds: s.map((x) => x.kind), text: s.map((x) => x.text).join(' ') }));`);
    expect(out.text).not.toMatch(/\bno\b|\bnobody\b|\bnone\b|\byet to\b|\bhas not\b/i);
    expect(out.kinds).not.toContain('ARRIVAL_SAME_REGION_POSITION');
    expect(out.kinds).not.toContain('ARRIVAL_SAME_COUNTRY_POSITION');
  });

  it('keeps the proportion and intake-history kinds denied for every sport', async () => {
    const { permissionsFor } = await import('./kinds.js');
    for (const k of ['INTERNATIONAL_SHARE', 'INTERNATIONAL_ROSTER', 'POSITION_INTAKE_HISTORY']) {
      expect(permissionsFor(k).OUTREACH, k).toBe('DENIED');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Policy version                                                              */
/* -------------------------------------------------------------------------- */

describe('P4', () => {
  it('is in force and keeps every earlier version nameable', () => {
    expect(OUTREACH_POLICY_VERSION).toBe('P4');
    expect(KNOWN_POLICY_VERSIONS).toEqual(['LEGACY_UNKNOWN', 'P2', 'P3', 'P4']);
  });
});
