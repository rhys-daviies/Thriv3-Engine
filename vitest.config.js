import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@shared': path.resolve(process.cwd(), 'shared') },
  },
  test: {
    include: ['server/**/*.test.js', 'shared/**/*.test.js'],
    // Every test file gets its own worker, and therefore its own throwaway
    // in-memory database — never the working one in server/data.
    env: { RECRUITMATCH_DB: ':memory:' },
  },
});
