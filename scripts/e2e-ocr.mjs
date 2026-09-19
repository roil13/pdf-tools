// Builds the OCR harness, then runs it in a real Electron renderer over app://.
import { build } from 'vite';
import { spawn } from 'node:child_process';
import electronPath from 'electron';
import { cp, mkdir } from 'node:fs/promises';

const OUT = 'dist-e2e';

await build({
  root: 'e2e',
  base: './',
  logLevel: 'warn',
  build: { outDir: `../${OUT}`, emptyOutDir: true },
});

// The harness fetches these by URL, same as the app does.
await mkdir(`${OUT}/fonts`, { recursive: true });
await cp('public/fonts', `${OUT}/fonts`, { recursive: true });
await cp('public/tesseract', `${OUT}/tesseract`, { recursive: true });
await cp('public/tessdata', `${OUT}/tessdata`, { recursive: true });
await cp('public/cmaps', `${OUT}/cmaps`, { recursive: true });
await cp('public/standard_fonts', `${OUT}/standard_fonts`, { recursive: true });
await cp('test/fixtures/scan.pdf', `${OUT}/scan.pdf`);
await cp('test/fixtures/img', `${OUT}/img`, { recursive: true });

const child = spawn(electronPath, ['scripts/e2e-main.cjs'], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
