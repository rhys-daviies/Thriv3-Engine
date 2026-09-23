import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { snapshotDatabase } from '../lib/dbSnapshot.js';
import {
  corpusIdentity, sharedCorpusNotice, corpus, corpusChangeToken, assertCanonicalWrite,
  CanonicalWriteRefused, CANONICAL_SHARED, WORKTREE_LOCAL, EPHEMERAL_TEST, STAGE_SNAPSHOT,
} from './corpusIdentity.js';

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
    expect(id.reason).toMatch(/resolves outside this checkout/);
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


/* ------------------------------------------------------------------------- *
 * L7ZM
 * ------------------------------------------------------------------------- */

/** A checkout whose database is a symlink to somewhere else — the real case. */
function sharedCheckout() {
  const root = fs.realpathSync(tmp());
  const canonical = path.join(fs.realpathSync(tmp()), 'recruitmatch.sqlite');
  fs.writeFileSync(canonical, '');
  fs.mkdirSync(path.join(root, 'server/data'), { recursive: true });
  const link = path.join(root, 'server/data/recruitmatch.sqlite');
  fs.symlinkSync(canonical, link);
  return { root, canonical, link };
}

describe('L7ZM — corpus categories', () => {
  it('calls a symlink into another checkout CANONICAL_SHARED', () => {
    const { root, link } = sharedCheckout();
    expect(corpus(link, { root, env: {} }).category).toBe(CANONICAL_SHARED);
  });

  it('calls the owning checkout WORKTREE_LOCAL — including the main one', () => {
    /*
     * Deliberate. The main checkout's database is both local AND canonical, and
     * canonical data operations BELONG there. What needs announcing is a side
     * checkout reaching across, not the tree that owns the file.
     */
    const root = fs.realpathSync(tmp());
    fs.mkdirSync(path.join(root, 'server/data'), { recursive: true });
    const own = path.join(root, 'server/data/recruitmatch.sqlite');
    fs.writeFileSync(own, '');
    expect(corpus(own, { root, env: {} }).category).toBe(WORKTREE_LOCAL);
  });

  it('calls :memory: EPHEMERAL_TEST', () => {
    expect(corpus(':memory:', { env: {} }).category).toBe(EPHEMERAL_TEST);
  });

  it('only calls a corpus STAGE_SNAPSHOT when it is DECLARED', () => {
    /* Never inferred from a filename — that is identity by appearance again. */
    const { root, link } = sharedCheckout();
    expect(corpus(link, { root, env: {} }).category).toBe(CANONICAL_SHARED);
    expect(corpus(link, { root, env: { THRIV3_CORPUS: 'snapshot' } }).category).toBe(STAGE_SNAPSHOT);
  });
});

describe('L7ZM — the report header says which corpus it measured', () => {
  it('warns on a shared corpus', () => {
    const { root, link } = sharedCheckout();
    expect(sharedCorpusNotice(corpus(link, { root, env: {} }))).toMatch(/SHARED CORPUS/);
  });

  it('does NOT cry "shared" at a declared snapshot', () => {
    /*
     * The first version keyed off `shared` alone and shouted SHARED CORPUS at a
     * deliberately frozen copy. Wrong, and the kind of noise that teaches
     * people to skip the banner.
     */
    const { root, link } = sharedCheckout();
    const notice = sharedCorpusNotice(corpus(link, { root, env: { THRIV3_CORPUS: 'snapshot' } }));
    expect(notice).toMatch(/STAGE SNAPSHOT/);
    expect(notice).not.toMatch(/SHARED CORPUS/);
  });

  it('lets a stage state both facts at once', () => {
    /* "stable for THIS corpus" AND "canonical may have moved since". */
    const { root, link } = sharedCheckout();
    const notice = sharedCorpusNotice(corpus(link, { root, env: { THRIV3_CORPUS: 'snapshot' } }));
    expect(notice).toMatch(/stable and reproducible/);
    expect(notice).toMatch(/canonical may have\n\s+moved since/);
  });

  it('stays quiet for a local corpus and for tests', () => {
    const root = fs.realpathSync(tmp());
    fs.mkdirSync(path.join(root, 'server/data'), { recursive: true });
    const own = path.join(root, 'server/data/recruitmatch.sqlite');
    fs.writeFileSync(own, '');
    expect(sharedCorpusNotice(corpus(own, { root, env: {} }))).toBeNull();
    expect(sharedCorpusNotice(corpus(':memory:', { env: {} }))).toBeNull();
  });
});

describe('L7ZM — the canonical write contract', () => {
  it('REFUSES a maintenance write to a corpus another checkout shares', () => {
    const { root, link } = sharedCheckout();
    expect(() => assertCanonicalWrite({ script: 'projectRosterMinutes.js', argv: [], path: link, env: {} }))
      .toThrow(CanonicalWriteRefused);
  });

  it('names the real file and the way out, not just "refused"', () => {
    const { canonical, link } = sharedCheckout();
    try {
      assertCanonicalWrite({ script: 'projectRosterMinutes.js', argv: [], path: link, env: {} });
      throw new Error('should have refused');
    } catch (e) {
      expect(e.code).toBe('CANONICAL_WRITE_REFUSED');
      expect(e.message).toContain(fs.realpathSync(canonical));
      expect(e.message).toContain('--canonical');
      expect(e.message).toContain('RECRUITMATCH_DB');
    }
  });

  it('ALLOWS it once the caller says --canonical', () => {
    const { link } = sharedCheckout();
    expect(() => assertCanonicalWrite({ script: 'x', argv: ['--canonical'], path: link, env: {} })).not.toThrow();
  });

  it('never gets in the way of a local, a snapshot, or a test', () => {
    /* Stop condition 9: the guard must not touch normal writes. */
    const root = fs.realpathSync(tmp());
    fs.mkdirSync(path.join(root, 'server/data'), { recursive: true });
    const own = path.join(root, 'server/data/recruitmatch.sqlite');
    fs.writeFileSync(own, '');
    const { link } = sharedCheckout();
    expect(() => assertCanonicalWrite({ script: 'x', argv: [], path: own, root, env: {} })).not.toThrow();
    expect(() => assertCanonicalWrite({ script: 'x', argv: [], path: ':memory:', root, env: {} })).not.toThrow();
    expect(() => assertCanonicalWrite({
      script: 'x', argv: [], path: link, root, env: { THRIV3_CORPUS: 'snapshot' },
    })).not.toThrow();
  });
});

describe('L7ZM — a measurement can tell that the corpus moved under it', () => {
  const seed = (file) => {
    const w = new Database(file);
    w.pragma('journal_mode = WAL');
    w.exec('CREATE TABLE roster_players (id INTEGER PRIMARY KEY, n TEXT)');
    w.prepare('INSERT INTO roster_players (n) VALUES (?)').run('before');
    return w;
  };

  it('CROSS-WORKTREE: a second connection writing is visible to the reader', () => {
    /*
     * The L7ZL-C situation in miniature: A measures, B writes, A must be able to
     * say so. data_version is what makes another process's commit visible.
     */
    const file = path.join(tmp(), 'canonical.sqlite');
    const writer = seed(file);
    const reader = new Database(file, { readonly: true });

    const atStart = corpusChangeToken(reader);
    writer.prepare('INSERT INTO roster_players (n) VALUES (?)').run('during');
    expect(corpusChangeToken(reader)).not.toBe(atStart);

    reader.close(); writer.close();
  });

  it('is quiet when nothing writes, so a clean run stays clean', () => {
    const file = path.join(tmp(), 'canonical.sqlite');
    const writer = seed(file);
    const reader = new Database(file, { readonly: true });
    const atStart = corpusChangeToken(reader);
    reader.prepare('SELECT COUNT(*) FROM roster_players').get();
    expect(corpusChangeToken(reader)).toBe(atStart);
    reader.close(); writer.close();
  });

  it('ISOLATED STAGE: a snapshot holds still while canonical moves', () => {
    /*
     * Both facts have to be able to coexist — "my before/after is valid for
     * snapshot X" AND "canonical has since moved". That is the whole point of
     * measuring against a snapshot rather than a corpus other trees write.
     */
    const file = path.join(tmp(), 'canonical.sqlite');
    const writer = seed(file);
    const snap = path.join(tmp(), 'stage.sqlite');
    snapshotDatabase(file, snap, { overwrite: true });

    const onSnapshot = new Database(snap, { readonly: true });
    const before = corpusChangeToken(onSnapshot);

    writer.prepare('INSERT INTO roster_players (n) VALUES (?)').run('after the snapshot');

    expect(corpusChangeToken(onSnapshot)).toBe(before);           // stage stable
    expect(onSnapshot.prepare('SELECT COUNT(*) n FROM roster_players').get().n).toBe(1);
    expect(writer.prepare('SELECT COUNT(*) n FROM roster_players').get().n).toBe(2);  // canonical moved

    onSnapshot.close(); writer.close();
  });

  it('WAL SAFETY: a snapshot carries committed rows still sitting in the WAL', () => {
    /*
     * The failure `snapshotDatabase` exists to prevent, and the one that cost
     * L7ZL a restore: copying the .sqlite file alone loses whatever is
     * committed but not yet checkpointed. VACUUM INTO reads through a real
     * transaction, so it sees them.
     */
    const file = path.join(tmp(), 'canonical.sqlite');
    const writer = seed(file);
    writer.prepare('INSERT INTO roster_players (n) VALUES (?)').run('committed, still in WAL');
    expect(fs.existsSync(`${file}-wal`)).toBe(true);

    const snap = path.join(tmp(), 'stage.sqlite');
    snapshotDatabase(file, snap, { overwrite: true });

    const onSnapshot = new Database(snap, { readonly: true });
    expect(onSnapshot.prepare('SELECT COUNT(*) n FROM roster_players').get().n).toBe(2);
    onSnapshot.close(); writer.close();
  });
});

describe('L7ZM — corpus identity is NOT materialisation freshness', () => {
  it('keeps the two questions in separate modules', async () => {
    /*
     * Phase 20. "Which database am I using" and "does this derived table match
     * its inputs" are different questions that happen to share one SQLite
     * primitive. Merging them would mean a change to either silently retunes
     * the other, so each owns its own copy of two lines.
     */
    const materialisation = await import('../lib/recruitingMaterialisation.js');
    const identity = await import('./corpusIdentity.js');

    expect(Object.keys(materialisation)).toEqual(
      expect.arrayContaining(['FRESH', 'STALE', 'LEGACY_UNVERIFIED', 'materialisationState']));
    expect(Object.keys(identity)).toEqual(
      expect.arrayContaining(['CANONICAL_SHARED', 'WORKTREE_LOCAL', 'corpus']));

    /*
     * Neither IMPORTS the other. Checked against code with comments stripped:
     * L7ZI hit exactly this, where a guard text-searched a file and convicted
     * the prose explaining why the coupling was avoided.
     */
    const code = (u) => fs.readFileSync(new URL(u, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code('./corpusIdentity.js')).not.toContain('recruitingMaterialisation');
    expect(code('../lib/recruitingMaterialisation.js')).not.toContain('corpusIdentity');
  });
});
