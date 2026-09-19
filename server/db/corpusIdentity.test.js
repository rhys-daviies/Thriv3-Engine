import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { corpusIdentity, sharedCorpusNotice } from './corpusIdentity.js';

/**
 * L7ZL-C. The 39,430-row roster change that consumed most of L7ZL was written
 * by another session through a symlink this toolchain never mentioned. These
 * pin the one fact that would have cut that investigation to minutes.
 */

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-'));

describe('L7ZL-C — a shared corpus says so', () => {
  it('names a database reached by a symlink out of the checkout', () => {
    const root = tmp();
    const elsewhere = path.join(tmp(), 'recruitmatch.sqlite');
    fs.writeFileSync(elsewhere, '');
    fs.mkdirSync(path.join(root, 'server/data'), { recursive: true });
    const link = path.join(root, 'server/data/recruitmatch.sqlite');
    fs.symlinkSync(elsewhere, link);

    const id = corpusIdentity(link, fs.realpathSync(root));
    expect(id.shared).toBe(true);
    expect(id.realPath).toBe(fs.realpathSync(elsewhere));
    expect(id.reason).toMatch(/symlink/);
    expect(sharedCorpusNotice(id)).toMatch(/SHARED CORPUS/);
  });

  it('is silent for a database that genuinely belongs to this checkout', () => {
    const root = fs.realpathSync(tmp());
    fs.mkdirSync(path.join(root, 'server/data'), { recursive: true });
    const own = path.join(root, 'server/data/recruitmatch.sqlite');
    fs.writeFileSync(own, '');

    const id = corpusIdentity(own, root);
    expect(id.shared).toBe(false);
    expect(sharedCorpusNotice(id)).toBeNull();
  });

  it('flags a RECRUITMATCH_DB pointing outside the checkout, symlink or not', () => {
    const root = fs.realpathSync(tmp());
    const outside = path.join(fs.realpathSync(tmp()), 'other.sqlite');
    fs.writeFileSync(outside, '');

    const id = corpusIdentity(outside, root);
    expect(id.shared).toBe(true);
    expect(id.reason).toMatch(/RECRUITMATCH_DB/);
  });

  it('treats :memory: as unshared, so tests are never warned about', () => {
    /* Every test file runs at ':memory:'; a notice there would be pure noise. */
    const id = corpusIdentity(':memory:');
    expect(id.shared).toBe(false);
    expect(sharedCorpusNotice(id)).toBeNull();
  });

  it('does not fail on a database that has not been created yet', () => {
    const root = fs.realpathSync(tmp());
    const missing = path.join(root, 'server/data/recruitmatch.sqlite');
    expect(() => corpusIdentity(missing, root)).not.toThrow();
    expect(corpusIdentity(missing, root).shared).toBe(false);
  });

  it('reports THIS checkout honestly, whatever the answer is', () => {
    /*
     * Not asserting shared/not — the arrangement is the operator's to change.
     * Asserting that the question is answered about a real resolved path,
     * which is what was missing.
     */
    const id = corpusIdentity(path.join(process.cwd(), 'server/data/recruitmatch.sqlite'));
    expect(typeof id.shared).toBe('boolean');
    expect(path.isAbsolute(id.realPath)).toBe(true);
  });
});
