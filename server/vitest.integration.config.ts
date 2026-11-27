import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: path.resolve(import.meta.dirname, '..'),
  test: {
    environment: 'node',
    include: ['server/tests/integration/**/*.int.test.ts'],
    fileParallelism: false,
    globalSetup: ['server/tests/integration/globalSetup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
