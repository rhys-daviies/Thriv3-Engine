import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { majorLabelFor, CIP_FAMILIES } from './academicMajors.js';

/**
 * L3 — free text in, canonical academic family out.
 *
 * The matcher used `String.includes` against a phrase list, which is unbounded:
 * "art" fires inside "m-art-ial arts", "libe-r-al arts", "E-art-h Science" and
 * "C-art-ography. L2 found two of those; the others turned up when the defect
 * class was probed rather than the phrase. So the fix is token boundaries, not
 * a rule about martial arts.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const d = fs.existsSync(DB) ? describe : describe.skip;

describe('supported vocabulary maps to a canonical family', () => {
  it('maps every approved term', () => {
    for (const [text, want] of [
      ['Computer Science', 'Computer Science'], ['computer science', 'Computer Science'],
      ['Comp Sci', 'Computer Science'], ['CS', 'Computer Science'],
      ['Data Science', 'Computer Science'], ['Information Systems', 'Computer Science'],
      ['Business', 'Business'], ['Business Administration', 'Business'], ['Finance', 'Business'],
      ['Exercise Science', 'Kinesiology'], ['Sport Science', 'Kinesiology'],
      ['Sports Science', 'Kinesiology'], ['Kinesiology', 'Kinesiology'],
      ['Sports Medicine', 'Kinesiology'],
      ['Biology', 'Biology'], ['Marine Biology', 'Biology'],
      ['Nursing', 'Health Professions'],
      ['Engineering', 'Engineering'], ['Mechanical Engineering', 'Engineering'],
      ['Psychology', 'Psychology'], ['Political Science', 'Political Science'],
      ['Communications', 'Communications'],
      ['Art', 'Art & Design'], ['Fine Art', 'Art & Design'], ['Fine Arts', 'Art & Design'],
      ['Art History', 'Art & Design'], ['Graphic Design', 'Art & Design'],
    ]) expect(majorLabelFor(text), text).toBe(want);
  });

  it('is case and punctuation insensitive', () => {
    for (const v of ['COMPUTER SCIENCE', 'computer-science', '  Computer   Science  ', 'cs']) {
      expect(majorLabelFor(v), v).toBe('Computer Science');
    }
    // Punctuation SEPARATES tokens rather than being deleted, so a
    // period-spaced initialism reads as "c s" and does not match. Left
    // unsupported deliberately: nothing observed types it, and collapsing
    // single letters is a bigger rule than the evidence asks for.
    expect(majorLabelFor('C.S.')).toBeNull();
  });
});

describe('unbounded substring matching is gone', () => {
  it('refuses the phrases that only CONTAIN a synonym', () => {
    // Every one of these resolved to a family before L3. "Martial Arts" and
    // "Liberal Arts" were the two L2 named; the rest are the same bug.
    for (const v of ['Martial Arts', 'Liberal Arts', 'Earth Science', 'Cartography',
      'Culinary Arts']) {
      expect(majorLabelFor(v), v).toBeNull();
    }
  });

  it('still matches a synonym that is a whole word inside a longer name', () => {
    // Boundaries, not prefixes: the term has to BE a word, and these are.
    expect(majorLabelFor('Marine Biology')).toBe('Biology');
    expect(majorLabelFor('Mechanical Engineering')).toBe('Engineering');
    expect(majorLabelFor('Sports Management')).toBe('Kinesiology');
  });

  it('guards the CS abbreviation to a standalone token', () => {
    expect(majorLabelFor('CS')).toBe('Computer Science');
    // Must not fire on arbitrary text that merely contains the letters.
    for (const v of ['Physics', 'Economics', 'Classics', 'Mathematics', 'Statistics']) {
      expect(majorLabelFor(v), v).not.toBe('Computer Science');
    }
  });
});

describe('explicit non-answers stay silent', () => {
  it('produces no family for undecided or unsupported text', () => {
    for (const v of ['Undecided', 'Undeclared', 'General Studies', 'History', 'Law',
      'Architecture', '', '   ', null, undefined]) {
      expect(majorLabelFor(v), String(v)).toBeNull();
    }
  });
});

describe('the family taxonomy itself', () => {
  it('is unchanged by L3 — the importer shares these labels', () => {
    // `CIP_FAMILIES` is the source of truth for the PCIP codes that build
    // colleges.notable_majors. Renaming a label here would silently
    // reinterpret every programme record, so L3 touches only the synonyms.
    expect(Object.keys(CIP_FAMILIES).sort()).toEqual([
      'Art & Design', 'Biology', 'Business', 'Communications', 'Computer Science',
      'Criminal Justice', 'Education', 'Engineering', 'English', 'Health Professions',
      'Kinesiology', 'Mathematics', 'Political Science', 'Psychology',
    ]);
  });

  it('maps every synonym onto a real family', () => {
    for (const v of ['sport science', 'sports medicine', 'data science', 'cs']) {
      expect(Object.keys(CIP_FAMILIES), v).toContain(majorLabelFor(v));
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Through the production Evidence path — FIRST TOUCH ONLY                      */
/* -------------------------------------------------------------------------- */

/**
 * `sequence` is deliberately never passed. Sequence-aware suppression at step
 * two belongs to the sending workstream and may legitimately drop
 * ACADEMIC_FIT because an earlier message already used it; asserting academic
 * normalisation through that path would be testing someone else's feature.
 */
d('ACADEMIC_FIT, first touch', () => {
  const probe = (major, college) => JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
    process.env.RECRUITMATCH_DB = ${JSON.stringify(DB)};
    const { evidenceFor } = await import(${JSON.stringify(path.join(ROOT, 'server/lib/evidenceQueries.js'))});
    const athlete = { id: 'L3', full_name: 'L3 Probe', sport: 'mens-soccer',
      nationality: 'United States', position: 'Midfielder', secondary_position: 'None',
      recruiting_class_year: 2027, intended_major: ${JSON.stringify(major)},
      gpa: null, sat_score: null, act_score: null };
    const ev = evidenceFor(athlete, ${JSON.stringify(college)}, { sport: 'mens-soccer' });
    const s = (ev.composition?.sentences ?? []).find((x) => x.kind === 'ACADEMIC_FIT');
    const d = (ev.dispositions ?? []).find((x) => x.kind === 'ACADEMIC_FIT');
    process.stdout.write(JSON.stringify({
      generated: (ev.all ?? []).some((e) => e.kind === 'ACADEMIC_FIT'),
      disposition: d?.disposition ?? null, role: d?.role ?? null,
      rendered: Boolean(s), text: s?.text ?? null,
      sequence: ev.sequence ?? null,
    }));
  `], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));

  it('qualifies a repaired alias where the programme offers the family', () => {
    // SMU lists Kinesiology; Clemson does not, so the pairing matters.
    // Asserted on SELECTION rather than on the rendered sentence: SMU has a
    // stronger hook and a two-claim cap, so the clause can be correctly
    // selected and still lose its slot. Qualification is what the alias fix
    // owns; what wins the slot is the composer's business.
    const out = probe('Sport Science', 'SMU');
    expect(out.generated).toBe(true);
    expect(out.disposition).toBe('SELECTED');
    expect(out.role).toBe('RELEVANCE');
  });

  it('reaches the email, in two vocabularies, where it wins the slot', () => {
    const out = probe('Sport Science', 'Adams State');
    expect(out.rendered).toBe(true);
    // The athlete's words stay theirs; the programme's label stays the
    // programme's. Never "you offer Sport Science", which nobody claimed.
    expect(out.text).toMatch(/looking to study Sport Science/);
    expect(out.text).toMatch(/Kinesiology is among the programmes you list$/);
  });

  it('renders nothing at all for Martial Arts', () => {
    // SMU lists Art & Design, so before L3 this pairing produced "looking to
    // study Martial Arts, and Art & Design is among the programmes you list".
    // A programme without the family would pass this test for the wrong reason.
    const out = probe('Martial Arts', 'SMU');
    expect(out.generated).toBe(false);
    expect(out.rendered).toBe(false);
  });

  it('is first-touch: no sequence is involved', () => {
    expect(probe('Sport Science', 'SMU').sequence).toBeNull();
  });
});
