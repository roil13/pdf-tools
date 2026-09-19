import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Separate from vite.config.ts, whose `root: 'src'` would hide test/.
export default defineConfig({
  resolve: {
    alias: {
      // operations.ts reaches for Electron's `app` to locate the qpdf binary;
      // the stub lets the integration tests drive the real qpdf headlessly.
      electron: path.resolve('test/stubs/electron.ts'),
    },
  },
  test: {
    root: '.',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
});
