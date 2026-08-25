import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Every CLI script must be loadable by plain Node.
 *
 * Vitest resolves the `@shared` alias and Vite resolves it in the browser, so
 * a src/ module importing `@shared/x.js` passes every other check and still
 * kills any script that imports it — which is exactly what happened:
 * `emailTemplate.js` switched to the alias and `npm run draft` died on
 * ERR_MODULE_NOT_FOUND for two commits while 578 tests stayed green.
 *
 * Import resolution happens before any code runs, so `--check`-style loading
 * is enough to catch it. The scripts are invoked with no arguments and are
 * expected to fail on usage; what must never appear is a module-resolution
 * error.
 */
const SCRIPTS = readdirSync(new URL('.', import.meta.url).pathname)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  .sort();

describe('CLI scripts resolve under plain Node', () => {
  it('finds scripts to check', () => {
    expect(SCRIPTS.length).toBeGreaterThan(5);
  });

  it.each(SCRIPTS)('%s has no unresolvable imports', (file) => {
    const script = path.join(new URL('.', import.meta.url).pathname, file);
    let output = '';
    try {
      // A throwaway database, so a script that runs to completion cannot touch
      // the working one. Most exit on usage long before they read anything.
      output = execFileSync(process.execPath, [script], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
        env: { ...process.env, RECRUITMATCH_DB: ':memory:' },
      });
    } catch (err) {
      output = `${err.stdout || ''}${err.stderr || ''}`;
    }
    expect(output).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module/);
  });
});
