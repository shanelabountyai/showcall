import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Integration specs share one local Postgres and truncate between tests.
    fileParallelism: false,
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
});
