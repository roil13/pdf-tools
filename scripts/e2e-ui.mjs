// Builds the UI harness and drives the real Edit Pages screen in Electron.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { cp } from 'node:fs/promises';

const OUT = 'dist-e2e-ui';

await build({
  root: 'e2e',
  base: './',
  plugins: [react()],
  logLevel: 'warn',
  build: {
    outDir: `../${OUT}`,
    emptyOutDir: true,
    rollupOptions: { input: 'e2e/ui.html' },
  },
});

await cp('test/fixtures/outlined-form.pdf', `${OUT}/outlined-form.pdf`);
await cp('public/cmaps', `${OUT}/cmaps`, { recursive: true });
await cp('public/standard_fonts', `${OUT}/standard_fonts`, { recursive: true });

const child = spawn(process.env.ELECTRON ?? (await import('electron')).default,
  ['scripts/e2e-ui-main.cjs'], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
