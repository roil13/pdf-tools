// Dev orchestration: Vite dev server + esbuild watch + Electron, restarting
// Electron whenever the main-process bundle changes.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electronPath from 'electron';
import { watch } from 'node:fs';
import { buildElectron } from './build-electron.mjs';

const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local?.[0];
if (!url) throw new Error('Vite did not report a local URL');
console.log(`\n  vite   ${url}`);

await buildElectron(true);

let child = null;
let restarting = false;

function start() {
  child = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url, NODE_ENV: 'development' },
  });
  child.on('exit', (code) => {
    if (!restarting) { void server.close(); process.exit(code ?? 0); }
  });
}

let timer = null;
watch('dist-electron', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!child) return;
    console.log('\n  reloading electron...');
    restarting = true;
    child.once('exit', () => { restarting = false; start(); });
    child.kill();
  }, 150);
});

start();
