// Bundles the Electron main + preload with esbuild.
// Output uses .cjs because package.json sets "type": "module", and Electron's
// preload and main are simplest as CommonJS.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  sourcemap: process.env.NODE_ENV !== 'production',
  logLevel: 'info',
};

export async function buildElectron(watch = false) {
  const opts = [
    { ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' },
    { ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' },
  ];
  if (!watch) {
    await Promise.all(opts.map((o) => build(o)));
    return [];
  }
  const { context } = await import('esbuild');
  const ctxs = await Promise.all(opts.map((o) => context(o)));
  await Promise.all(ctxs.map((c) => c.watch()));
  return ctxs;
}

if (process.argv[1] && process.argv[1].endsWith('build-electron.mjs')) {
  await buildElectron(false);
}
