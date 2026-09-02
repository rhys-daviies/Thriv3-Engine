/**
 * THE RUNTIME CONTRACT — Phase 13K.
 *
 * Each of these is a way a hosted process could have started up insecure, and
 * the test is that it refuses instead. The point is not that `runtimeProblems`
 * returns strings; it is that no combination of missing configuration produces
 * a running service with no session secret, an ephemeral database or a session
 * cookie sent over plain http.
 */
import { describe, it, expect } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { resolveConfig, runtimeProblems, assertRuntime, describeRuntime, DEFAULTS } from './runtimeConfig.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-runtime-'));

/** A hosted environment that passes, so each test can break exactly one thing. */
const HOSTED = Object.freeze({
  NODE_ENV: 'production',
  THRIV3_SESSION_SECRET: 'f'.repeat(64),
  THRIV3_APP_ORIGIN: 'https://app.example.com',
  API_HOST: '0.0.0.0',
  THRIV3_TRUST_PROXY: '1',
  RECRUITMATCH_DB: path.join(tmp, 'recruitmatch.sqlite'),
  THRIV3_REPORT_STORE: path.join(tmp, 'reports'),
  THRIV3_UPLOAD_DIR: path.join(tmp, 'uploads'),
});

const problemsFor = (overrides) => runtimeProblems({ ...HOSTED, ...overrides });

describe('a valid hosted configuration', () => {
  it('has no problems', () => {
    expect(problemsFor({})).toEqual([]);
  });

  it('describes its own boundary in one line', () => {
    const line = describeRuntime(resolveConfig(HOSTED));
    expect(line).toContain('production');
    expect(line).toContain('reachable from the network');
    expect(line).toContain('authentication required');
    expect(line).toContain('Secure');
  });
});

describe('development is convenient and production is not', () => {
  it('needs nothing at all locally', () => {
    expect(runtimeProblems({})).toEqual([]);
  });

  it('binds loopback by default, in both modes', () => {
    // 13J's rule survives hosting: reachable from the network is a decision
    // somebody writes down, never a default.
    expect(resolveConfig({}).host).toBe('127.0.0.1');
    expect(DEFAULTS.host).toBe('127.0.0.1');
  });

  it('trusts no proxy by default', () => {
    expect(resolveConfig({}).trustProxy).toBe(0);
    // Never `true`: trusting every proxy means believing whatever
    // X-Forwarded-For and X-Forwarded-Proto a caller invents.
    expect(resolveConfig({ THRIV3_TRUST_PROXY: '1' }).trustProxy).toBe(1);
  });

  it('allows the Vite dev origins locally and nothing extra in production', () => {
    const dev = resolveConfig({ CLIENT_PORT: '5183' });
    expect(dev.appOrigins).toContain('http://localhost:5183');
    // localhost and 127.0.0.1 are different origins to a browser, which is the
    // detail that makes a working CSRF check look broken.
    expect(dev.appOrigins).toContain('http://127.0.0.1:5183');
    expect(resolveConfig(HOSTED).appOrigins).toEqual(['https://app.example.com']);
  });
});

describe('the session secret', () => {
  it('is required in production', () => {
    expect(problemsFor({ THRIV3_SESSION_SECRET: undefined }).join(' '))
      .toMatch(/THRIV3_SESSION_SECRET is not set/);
  });

  it('is refused when it is too short, or a placeholder', () => {
    // Short is caught by length, whatever it says — 'changeme' never reaches
    // the placeholder list because it is eight characters.
    expect(problemsFor({ THRIV3_SESSION_SECRET: 'short' }).join(' ')).toMatch(/characters/);
    expect(problemsFor({ THRIV3_SESSION_SECRET: 'changeme' }).join(' ')).toMatch(/characters/);
    // Long enough to pass the length check and still not a secret.
    expect(problemsFor({ THRIV3_SESSION_SECRET: 'x'.repeat(32) }).join(' '))
      .toMatch(/placeholder/);
  });

  it('is not invented in production, ever', async () => {
    const { sessionSecretFor } = await import('./runtimeConfig.js');
    expect(() => sessionSecretFor({ production: true, sessionSecret: null })).toThrow();
    // Locally a random per-boot secret is used rather than a fixed one in the
    // repository, because a fixed development secret becomes a production one
    // the first time somebody copies the file.
    const local = sessionSecretFor({ production: false, sessionSecret: null });
    expect(local).toHaveLength(64);
    expect(sessionSecretFor({ production: false, sessionSecret: null })).toBe(local);
  });
});

describe('where the data lives', () => {
  it('refuses the in-tree defaults in production', () => {
    const missing = problemsFor({
      RECRUITMATCH_DB: undefined, THRIV3_REPORT_STORE: undefined, THRIV3_UPLOAD_DIR: undefined,
    });
    // Both defaults are inside the source tree, which on a container host is
    // discarded on the next deploy — and a generated report is a document that
    // was sent to somebody.
    expect(missing.join(' ')).toMatch(/RECRUITMATCH_DB is not set/);
    expect(missing.join(' ')).toMatch(/THRIV3_REPORT_STORE is not set/);
    expect(missing.join(' ')).toMatch(/does not survive a deploy|thrown away/);
  });

  it('requires the upload directory, because an analysis is a file', () => {
    // FOUND BY A RESTORE, not by reading the schema. `players.recommendations`
    // holds a PATH into this directory, so an app restored without it signs
    // in, lists every athlete and says "No matches yet" for all of them.
    const missing = problemsFor({ THRIV3_UPLOAD_DIR: undefined }).join(' ');
    expect(missing).toMatch(/THRIV3_UPLOAD_DIR is not set/);
    expect(missing).toMatch(/is a FILE in this directory/);
    expect(problemsFor({ THRIV3_UPLOAD_DIR: 'uploads' }).join(' '))
      .toMatch(/must be an absolute path/);
  });

  it('requires absolute paths', () => {
    expect(problemsFor({ RECRUITMATCH_DB: 'data/db.sqlite' }).join(' '))
      .toMatch(/must be an absolute path/);
  });

  it('refuses a database directory that does not exist', () => {
    expect(problemsFor({ RECRUITMATCH_DB: '/no/such/place/db.sqlite' }).join(' '))
      .toMatch(/database directory is not usable/);
  });

  it('refuses the three paths spread across different volumes', () => {
    // One volume, so one snapshot holds the history rows, the artefacts they
    // point at and the analyses athletes point at. Restoring them from
    // different moments is how a history comes to promise documents the store
    // does not have.
    expect(problemsFor({ THRIV3_REPORT_STORE: '/elsewhere/reports' }).join(' '))
      .toMatch(/must share\s+one persistent volume/);
    expect(problemsFor({ THRIV3_UPLOAD_DIR: '/elsewhere/uploads' }).join(' '))
      .toMatch(/must share\s+one persistent volume/);
  });
});

describe('who may talk to it', () => {
  it('requires the app origin', () => {
    expect(problemsFor({ THRIV3_APP_ORIGIN: undefined }).join(' '))
      .toMatch(/THRIV3_APP_ORIGIN is not set/);
  });

  it('refuses http in production', () => {
    // A session cookie on http is a credential sent in clear.
    expect(problemsFor({ THRIV3_APP_ORIGIN: 'http://app.example.com' }).join(' '))
      .toMatch(/only accepted over HTTPS/);
  });

  it('refuses an origin with a path or a wildcard', () => {
    expect(problemsFor({ THRIV3_APP_ORIGIN: 'https://app.example.com/app' }).join(' '))
      .toMatch(/not a bare origin/);
    expect(problemsFor({ THRIV3_APP_ORIGIN: '*' }).join(' ')).toMatch(/not a bare origin/);
  });

  it('requires the bind address to be deliberate', () => {
    expect(problemsFor({ API_HOST: undefined }).join(' ')).toMatch(/API_HOST is not set/);
  });

  it('catches the sign-in failure nobody can debug', () => {
    // HTTPS origin, no trusted proxy: Express sees plain http, refuses to set
    // a Secure cookie, and sign-in fails with no error anywhere.
    expect(problemsFor({ THRIV3_TRUST_PROXY: '0' }).join(' '))
      .toMatch(/refuse to set a Secure cookie/);
    expect(problemsFor({ THRIV3_TRUST_PROXY: undefined }).join(' '))
      .toMatch(/THRIV3_TRUST_PROXY is not set/);
  });

  it('derives cookie security from the origin, so the two cannot disagree', () => {
    expect(resolveConfig(HOSTED).cookieSecure).toBe(true);
    expect(resolveConfig({ ...HOSTED, THRIV3_APP_ORIGIN: 'http://app.example.com' }).cookieSecure)
      .toBe(false);
    expect(resolveConfig({}).cookieSecure).toBe(false);
  });
});

describe('the work factor', () => {
  it('has a defensible default and a bounded range', () => {
    expect(DEFAULTS.scryptCost).toBe(16);
    expect(problemsFor({ THRIV3_SCRYPT_COST: '10' }).join(' ')).toMatch(/must be 14–20/);
    expect(problemsFor({ THRIV3_SCRYPT_COST: '25' }).join(' ')).toMatch(/must be 14–20/);
    expect(problemsFor({ THRIV3_SCRYPT_COST: '17' })).toEqual([]);
  });
});

describe('startup', () => {
  it('exits, loudly, listing every problem at once', () => {
    const lines = [];
    let code = null;
    assertRuntime({
      env: { NODE_ENV: 'production' },
      log: { error: (line) => lines.push(String(line)) },
      exit: (value) => { code = value; },
    });
    expect(code).toBe(1);
    const printed = lines.join('\n');
    expect(printed).toMatch(/REFUSED TO START/);
    // Every fault in one message, not one per restart.
    expect(printed).toMatch(/THRIV3_SESSION_SECRET/);
    expect(printed).toMatch(/RECRUITMATCH_DB/);
    expect(printed).toMatch(/THRIV3_REPORT_STORE/);
    expect(printed).toMatch(/THRIV3_UPLOAD_DIR/);
    expect(printed).toMatch(/THRIV3_APP_ORIGIN/);
    expect(printed).toMatch(/API_HOST/);
    expect(printed).toMatch(/docs\/hosting\.md/);
  });

  it('returns the configuration when there is nothing wrong', () => {
    let exited = false;
    const config = assertRuntime({
      env: HOSTED,
      log: { error: () => {} },
      exit: () => { exited = true; },
    });
    expect(exited).toBe(false);
    expect(config.production).toBe(true);
    expect(config.host).toBe('0.0.0.0');
  });
});
