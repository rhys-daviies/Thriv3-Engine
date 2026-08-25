import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(process.cwd(), 'shared'),
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
  test: {
    // src/ included so the email template — the one module under src/ that a
    // Node CLI also loads — is covered where it lives rather than only through
    // whatever happens to import it.
    include: ['server/**/*.test.js', 'shared/**/*.test.js', 'worker/**/*.test.js', 'src/**/*.test.js'],
    // Every test file gets its own worker, and therefore its own throwaway
    // in-memory database — never the working one in server/data.
    env: {
      RECRUITMATCH_DB: ':memory:',
      // Generated pages go to a scratch directory, never the publish directory.
      THRIV3_BUILD_DIR: path.resolve(process.cwd(), 'node_modules/.tmp/thriv3-test-build'),
      // Sending refuses to run without these, which is the point of them. Set
      // here so every suite exercises the normal path; the suite that checks
      // the refusal clears them for itself.
      THRIV3_SENDER_IDENTITY: 'Thriv3 (test)',
      THRIV3_POSTAL_ADDRESS: '1 Test Street, Testville, TS 00000',
      THRIV3_UNSUBSCRIBE_BASE_URL: 'https://example.test',
    },
  },
});
