// Builds the reader harness and drives the real Reader screen in Electron.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { cp } from 'node:fs/promises';

const OUT = 'dist-e2e-reader';

await build({
  root: 'e2e',
  base: './',
  plugins: [react()],
  logLevel: 'warn',
  build: {
    outDir: `../${OUT}`,
    emptyOutDir: true,
    rollupOptions: { input: 'e2e/reader.html' },
  },
});

await cp('test/fixtures/outlined-form.pdf', `${OUT}/outlined-form.pdf`);
await cp('public/cmaps', `${OUT}/cmaps`, { recursive: true });
await cp('public/standard_fonts', `${OUT}/standard_fonts`, { recursive: true });
// pdf.js positions the text layer entirely from this stylesheet; without it the
// spans stack at the origin and every selection test would be meaningless.
await cp('public/pdfjs-textlayer.css', `${OUT}/pdfjs-textlayer.css`);
// Filling a form field with Hebrew fetches this at save time; without it the
// save fails in a way that looks like a bug in the writer.
await cp('public/fonts', `${OUT}/fonts`, { recursive: true });

const child = spawn(process.env.ELECTRON ?? (await import('electron')).default,
  ['scripts/e2e-reader-main.cjs'], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
