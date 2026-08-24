import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@shared': path.resolve(process.cwd(), 'shared') },
  },
  test: {
    include: ['server/**/*.test.js', 'shared/**/*.test.js', 'worker/**/*.test.js'],
    // Every test file gets its own worker, and therefore its own throwaway
    // in-memory database — never the working one in server/data.
    env: {
      RECRUITMATCH_DB: ':memory:',
      // Generated pages go to a scratch directory, never the publish directory.
      THRIV3_BUILD_DIR: path.resolve(process.cwd(), 'node_modules/.tmp/thriv3-test-build'),
    },
  },
});
