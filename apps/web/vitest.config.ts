import { defineConfig } from 'vitest/config'

// Keep the suite reproducible across developer machines and CI. Tests that need
// concurrency must opt in locally instead of depending on scheduler timing.
process.env.TZ = 'UTC'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    fileParallelism: false,
    maxConcurrency: 1,
    retry: 0,
    sequence: {
      hooks: 'list',
      shuffle: false,
    },
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
})
