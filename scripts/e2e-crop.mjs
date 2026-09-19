// Builds the cropper harness and drives the real component in Electron.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';

const OUT = 'dist-e2e-crop';

await build({
  root: 'e2e',
  base: './',
  plugins: [react()],
  logLevel: 'warn',
  build: { outDir: `../${OUT}`, emptyOutDir: true, rollupOptions: { input: 'e2e/crop.html' } },
});

const child = spawn(process.env.ELECTRON ?? (await import('electron')).default,
  ['scripts/e2e-crop-main.cjs'], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
