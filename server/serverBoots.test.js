import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * DOES THE SERVER ACTUALLY START? — A11.
 *
 * ===========================================================================
 * WRITTEN BECAUSE THE WHOLE SUITE PASSED WHILE THE SERVER COULD NOT BOOT.
 *
 * A11 added `import { TOP_N } from '../lib/v2/matchmakingService.js'` to a
 * route, and `matchmakingService` imported `TOP_N` without re-exporting it.
 * Node's ESM loader rejects that at instantiation — the process dies on
 * startup with "does not provide an export named 'TOP_N'".
 *
 * TEN THOUSAND TESTS DID NOT NOTICE. Vitest transforms modules through Vite,
 * whose interop is more forgiving than Node's native loader, and several
 * suites import that very router and passed. The only thing that caught it was
 * starting the real server, by hand, for a browser check.
 *
 * So this runs the real entry point under the real loader. It asserts only
 * that the module graph instantiates and the process reaches its own startup —
 * not that any route behaves, which every other suite covers better.
 *
 * `--check` is not enough: it parses one file and resolves nothing. The import
 * graph is the thing under test, so the server is genuinely started and then
 * stopped.
 * ===========================================================================
 */
describe('the server boots under Node\'s own module loader', () => {
  it('B1. every import in the module graph resolves', async () => {
    /**
     * Imported for side effects and then exited immediately: reaching the end
     * of this means every `import` in the graph — routes, libs, shared —
     * resolved to something that actually exists.
     */
    const { stdout, stderr } = await run(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "await import('./server/index.js'); console.log('BOOTED'); process.exit(0);",
      ],
      {
        cwd: ROOT,
        env: { ...process.env, RECRUITMATCH_DB: ':memory:', PORT: '0' },
        timeout: 60_000,
      },
    );

    expect(
      `${stdout}${stderr}`,
      'the module graph instantiated',
    ).toContain('BOOTED');
    expect(stderr).not.toMatch(/does not provide an export named/);
    expect(stderr).not.toMatch(/SyntaxError|Cannot find module/);
  }, 90_000);
});
