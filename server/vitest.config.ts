import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: path.resolve(import.meta.dirname, '..'),
  test: {
    environment: 'node',
    include: [
      'server/tests/unit/**/*.test.ts',
      'server/tests/property/**/*.test.ts',
    ],
  },
});
