import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { uploadsRouter } from './uploads.js';
import {
  UPLOADS_DIR, UPLOAD_URL_PREFIX, safeUploadFilename, resolveUploadDestination,
} from '../lib/uploadPath.js';
import { resolveAnalysisPath } from '../lib/campaigns.js';

/**
 * A3.1 — the upload endpoint may not write outside its store.
 *
 * The flaw this closes was a filename decision made inline in the route:
 * `${randomUUID()}-${originalname}` handed to `path.join`. The UUID prefix
 * absorbs exactly one `..`, so two levels of traversal looked contained and
 * three escaped — which is why the tests below go past two, and why the
 * assertion is containment of the RESOLVED path rather than the absence of any
 * particular spelling.
 *
 * Both levels are exercised: the helper directly, and the real route over HTTP,
 * because a helper can be correct while a route quietly bypasses it.
 */

/** Where an escaping write would land, so the tests can prove it did not. */
const ESCAPE_TARGETS = [
  path.resolve(UPLOADS_DIR, '..'),
  path.resolve(UPLOADS_DIR, '..', '..'),
  path.resolve(UPLOADS_DIR, '..', '..', '..'),
];

const HOSTILE = [
  '../evil.json',
  '../../evil.json',
  '../../../evil.json',
  '../../../../etc/passwd',
  'a/../../../evil.json',
  '..\\evil.json',
  '..\\..\\..\\evil.json',
  '..\\..\\..\\..\\Windows\\System32\\drivers\\etc\\hosts',
  'a\\..\\../..\\evil.json',
  '../..\\../evil.json',
  '/etc/passwd',
  '/absolute/path/evil.json',
  'C:\\Windows\\System32\\evil.json',
  'C:/Windows/System32/evil.json',
  '\\\\server\\share\\evil.json',
  '.',
  '..',
  '...',
  './.env',
  '.env',
  '',
  '/',
  '\\',
  'foo/',
  'foo\\',
];

const LEGITIMATE = [
  'analysis.json',
  'recommendations-2026.json',
  'my analysis file.json',
  'season.2026.final.report.json',
  'Highlight Reel (final).pdf',
  'recommendations-26bffc70-6a66-41a5-93d4-8209419b34bb.json',
];

let baseUrl;
const written = [];

beforeAll(async () => {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const app = express();
  app.use('/api', uploadsRouter);
  await new Promise((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.unref();
  });
});

afterAll(() => {
  for (const f of written) if (fs.existsSync(f)) fs.unlinkSync(f);
});

/** Everything that exists anywhere an escape could plausibly land. */
function censusOutside() {
  const out = {};
  for (const dir of ESCAPE_TARGETS) {
    out[dir] = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : null;
  }
  return out;
}

let before;
beforeEach(() => { before = censusOutside(); });

async function post(filename, body = '{"recommendations":[],"summary":"x"}') {
  const form = new FormData();
  form.append('file', new Blob([body], { type: 'application/json' }), filename);
  const res = await fetch(`${baseUrl}/api/uploads`, { method: 'POST', body: form });
  return { status: res.status, json: await res.json() };
}

// ---------------------------------------------------------------------------

describe('safeUploadFilename', () => {
  it('keeps a legitimate name recognisable', () => {
    expect(safeUploadFilename('analysis.json')).toMatch(/^[0-9a-f-]{36}-analysis\.json$/);
    expect(safeUploadFilename('recommendations-2026.json')).toMatch(/-recommendations-2026\.json$/);
    // Multiple dots survive; only LEADING ones are stripped.
    expect(safeUploadFilename('season.2026.final.json')).toMatch(/-season\.2026\.final\.json$/);
  });

  /**
   * The stored name is handed back as `/uploads/<name>` and the browser fetches
   * that URL directly, so a `#`, `?` or `%` in a filename is a broken request
   * as well as a hazard. They become underscores rather than being kept.
   */
  it('makes the name URL-safe, so the reference it produces can be fetched', () => {
    expect(safeUploadFilename('my analysis file.json')).toMatch(/-my_analysis_file\.json$/);
    expect(safeUploadFilename('a#b?c%d.json')).toMatch(/-a_b_c_d\.json$/);
    const encoded = safeUploadFilename('rep ort#1.json');
    expect(encodeURIComponent(encoded)).toBe(encoded);
  });

  it('reduces any path to its last segment, under either separator', () => {
    // path.basename alone would return the whole of the backslash cases on a
    // POSIX host, which is why the split is on both.
    expect(safeUploadFilename('../../../evil.json')).toMatch(/-evil\.json$/);
    expect(safeUploadFilename('..\\..\\..\\evil.json')).toMatch(/-evil\.json$/);
    expect(safeUploadFilename('a/../..\\..\\evil.json')).toMatch(/-evil\.json$/);
    expect(safeUploadFilename('/etc/passwd')).toMatch(/-passwd$/);
    expect(safeUploadFilename('C:\\Windows\\System32\\evil.json')).toMatch(/-evil\.json$/);
  });

  it('never returns a name containing a separator, a dot-name or a control character', () => {
    for (const name of [...HOSTILE, ...LEGITIMATE]) {
      const out = safeUploadFilename(name);
      expect(out).not.toMatch(/[/\\]/);
      expect(out).not.toMatch(/[\u0000-\u001f\u007f]/);
      expect(path.basename(out)).toBe(out);
      expect(out).not.toBe('.');
      expect(out).not.toBe('..');
      expect(out.startsWith('.')).toBe(false);
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('strips control characters, including a NUL that would truncate a syscall', () => {
    expect(safeUploadFilename('evil\u0000.json')).toMatch(/-evil\.json$/);
    expect(safeUploadFilename('a\u0000/../../b.json')).toMatch(/-b\.json$/);
    expect(safeUploadFilename('\u001fname.json')).toMatch(/-name\.json$/);
  });

  it('falls back to a bare identifier when nothing usable is left', () => {
    for (const empty of ['.', '..', '...', '', '/', '\\', 'foo/', 'foo\\', null, undefined, 42, {}]) {
      expect(safeUploadFilename(empty)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('keeps a dotfile’s name but not its dot', () => {
    // '.env' becomes '<uuid>-env': still recognisable, no longer a name that
    // means anything to a shell, a web server or a directory listing.
    expect(safeUploadFilename('.env')).toMatch(/^[0-9a-f-]{36}-env$/);
    expect(safeUploadFilename('./.env')).toMatch(/^[0-9a-f-]{36}-env$/);
    expect(safeUploadFilename('.htaccess')).toMatch(/^[0-9a-f-]{36}-htaccess$/);
  });

  it('bounds the length so the whole filename stays writable', () => {
    const long = `${'a'.repeat(500)}.json`;
    expect(safeUploadFilename(long).length).toBeLessThanOrEqual(36 + 1 + 120);
  });

  /**
   * The prefix is for uniqueness, not for safety. This is the property the old
   * code did not have: it relied on the prefix eating a `..`, which works for
   * exactly one level.
   */
  it('is safe with the identifier removed', () => {
    for (const name of HOSTILE) {
      const bare = safeUploadFilename(name).replace(/^[0-9a-f-]{36}-?/, '');
      expect(bare).not.toMatch(/[/\\]/);
      expect(bare.startsWith('.')).toBe(false);
    }
  });

  it('does not collide across two uploads of the same name', () => {
    expect(safeUploadFilename('analysis.json')).not.toBe(safeUploadFilename('analysis.json'));
  });
});

describe('resolveUploadDestination', () => {
  it('always lands inside the upload store', () => {
    for (const name of [...HOSTILE, ...LEGITIMATE]) {
      const { destination, filename, fileUrl } = resolveUploadDestination(name);
      expect(destination.startsWith(UPLOADS_DIR + path.sep)).toBe(true);
      expect(path.dirname(destination)).toBe(UPLOADS_DIR);
      expect(path.resolve(destination)).toBe(destination);
      expect(fileUrl).toBe(`${UPLOAD_URL_PREFIX}${filename}`);
    }
  });

  it('produces a reference the campaign snapshot reader will accept', () => {
    // The write side and the read side are separate guards. This is the seam
    // between them: anything this produces must satisfy resolveAnalysisPath.
    for (const name of [...HOSTILE, ...LEGITIMATE]) {
      const { destination, fileUrl } = resolveUploadDestination(name);
      fs.writeFileSync(destination, '{}');
      written.push(destination);
      expect(resolveAnalysisPath(fileUrl)).toBe(destination);
    }
  });
});

// ---------------------------------------------------------------------------

describe('POST /api/uploads', () => {
  it('stores a legitimate file and returns a usable reference', async () => {
    const body = '{"recommendations":[{"name":"A","match_score":90}],"summary":"s"}';
    const { status, json } = await post('recommendations-2026.json', body);

    expect(status).toBe(200);
    expect(json.file_url).toMatch(/^\/uploads\/[0-9a-f-]{36}-recommendations-2026\.json$/);

    const stored = path.join(UPLOADS_DIR, path.basename(json.file_url));
    written.push(stored);
    expect(fs.readFileSync(stored, 'utf8')).toBe(body);
    // The shape `players.recommendations` holds, unchanged by this fix.
    expect(json.file_url.startsWith(UPLOAD_URL_PREFIX)).toBe(true);
  });

  it('accepts every legitimate name and keeps each one inside the store', async () => {
    for (const name of LEGITIMATE) {
      const { status, json } = await post(name);
      expect(status).toBe(200);
      const stored = path.resolve(UPLOADS_DIR, path.basename(json.file_url));
      written.push(stored);
      expect(fs.existsSync(stored)).toBe(true);
      expect(stored.startsWith(UPLOADS_DIR + path.sep)).toBe(true);
    }
  });

  /**
   * THE REGRESSION THIS PHASE EXISTS FOR.
   *
   * Every one of these used to be written wherever the name pointed. Two
   * outcomes are acceptable and both are asserted: the file is stored inside
   * the store under a sanitised name, or the request is refused and nothing is
   * written at all. What is NOT acceptable is anything appearing above the
   * store, which the census checks after the whole batch.
   *
   * A degenerate name — '.', '..', '', '/', '\\', 'foo/' — never reaches the
   * handler in this environment: the multipart parser drops the part rather
   * than presenting a file, so the route answers "No file provided". That is a
   * property of the parser, not a guarantee this code makes, which is why the
   * assertion below accepts either outcome rather than pinning the set.
   */
  it('writes nothing outside the store, whatever the file is called', async () => {
    for (const name of HOSTILE) {
      const { status, json } = await post(name, `payload for ${name}`);
      expect([200, 400]).toContain(status);

      if (status === 200) {
        const stored = path.resolve(UPLOADS_DIR, path.basename(json.file_url));
        written.push(stored);
        expect(stored.startsWith(UPLOADS_DIR + path.sep)).toBe(true);
        expect(path.dirname(stored)).toBe(UPLOADS_DIR);
        expect(fs.existsSync(stored)).toBe(true);
      } else {
        expect(json.file_url).toBeUndefined();
      }
    }
    expect(censusOutside()).toEqual(before);
  });

  it('creates no new entry in any directory above the store', async () => {
    for (const name of HOSTILE) {
      const { status, json } = await post(name);
      if (status === 200) written.push(path.resolve(UPLOADS_DIR, path.basename(json.file_url)));
    }
    /**
     * Compared against what was there BEFORE, not against a list of forbidden
     * names: the repository root is three levels above the test store and
     * legitimately contains a `.env`, so "does this directory contain a .env"
     * is not the question. "Did this endpoint put anything here" is.
     */
    for (const dir of ESCAPE_TARGETS) {
      if (!fs.existsSync(dir)) continue;
      const appeared = fs.readdirSync(dir).filter((e) => !(before[dir] || []).includes(e));
      expect(appeared).toEqual([]);
    }
  });

  it('traversal names that DO reach the handler are stored, flattened', async () => {
    // The cases the old code actually wrote outside the store. Each keeps a
    // recognisable name and loses every path component.
    for (const [name, expected] of [
      ['../../../evil.json', /-evil\.json$/],
      ['../../../../etc/passwd', /-passwd$/],
      ['a/../../../evil.json', /-evil\.json$/],
      ['..\\..\\..\\evil.json', /-evil\.json$/],
      ['C:\\Windows\\System32\\evil.json', /-evil\.json$/],
    ]) {
      const { status, json } = await post(name);
      expect(status).toBe(200);
      expect(json.file_url).toMatch(expected);
      const stored = path.resolve(UPLOADS_DIR, path.basename(json.file_url));
      written.push(stored);
      expect(path.dirname(stored)).toBe(UPLOADS_DIR);
    }
    expect(censusOutside()).toEqual(before);
  });

  it('refuses a request with no file', async () => {
    const res = await fetch(`${baseUrl}/api/uploads`, { method: 'POST', body: new FormData() });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/No file provided/);
    expect(censusOutside()).toEqual(before);
  });

  /**
   * End to end across the two slices: a real upload through the route produces
   * a reference that A3's campaign creation can resolve and read back.
   */
  it('produces an analysis the campaign snapshot reader can open', async () => {
    const analysis = JSON.stringify({
      recommendations: [{ id: 'c1', name: 'Butler', match_score: 82 }],
      summary: 'Ranked 1166 eligible programs on six weighted criteria.',
    });
    const { json } = await post('recommendations-abc.json', analysis);
    const resolved = resolveAnalysisPath(json.file_url);
    written.push(resolved);

    expect(resolved.startsWith(UPLOADS_DIR + path.sep)).toBe(true);
    expect(JSON.parse(fs.readFileSync(resolved, 'utf8')).recommendations).toHaveLength(1);
  });

  it('produces a reference the read-side guard accepts even from a hostile name', async () => {
    const { json } = await post('../../../../etc/passwd', '{"recommendations":[],"summary":""}');
    written.push(path.resolve(UPLOADS_DIR, path.basename(json.file_url)));
    expect(() => resolveAnalysisPath(json.file_url)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('the existing store is untouched by this fix', () => {
  it('keeps the reference shape stored analyses already use', () => {
    // `players.recommendations` holds values of exactly this shape today, and
    // 98 of them exist. Nothing here renames or migrates a file.
    const existing = '/uploads/00836aa6-a325-488f-a3c5-7c14f63d4209-recommendations-26bff.json';
    expect(existing.startsWith(UPLOAD_URL_PREFIX)).toBe(true);
    expect(path.basename(existing.slice(UPLOAD_URL_PREFIX.length)))
      .toBe(existing.slice(UPLOAD_URL_PREFIX.length));
    // And the sanitiser would produce the same shape for that same name.
    expect(safeUploadFilename('recommendations-26bff.json')).toMatch(/-recommendations-26bff\.json$/);
  });
});
