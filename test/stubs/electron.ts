// Minimal Electron stand-in so operations.ts can be exercised under vitest.
import path from 'node:path';
export const app = {
  isPackaged: false,
  getAppPath: () => path.resolve('.'),
  getPath: (_name: string) => path.resolve('test/fixtures/_out'),
};
