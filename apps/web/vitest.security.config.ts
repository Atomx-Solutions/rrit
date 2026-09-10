import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/security/rls/**/*.test.ts'],
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
