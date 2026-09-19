// Launches the PRODUCTION build and asks the renderer to fetch each runtime
// asset over app://. This is the path that works in dev (http) and would
// silently fail under file://, so it is worth proving.
import { spawn } from 'node:child_process';
import electronPath from 'electron';

const child = spawn(electronPath, ['scripts/probe-main.cjs'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'production' },
});
let out = '';
child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
child.stderr.on('data', (d) => process.stderr.write(d));
child.on('exit', (code) => process.exit(out.includes('ALL ASSETS OK') ? 0 : (code || 1)));
