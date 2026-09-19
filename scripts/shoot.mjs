/**
 * Screenshot the app's own page via the DevTools protocol.
 *
 * Deliberately not a desktop capture: this renders only the application's
 * viewport, so nothing else on screen is ever recorded.
 *
 * usage: node scripts/shoot.mjs <exe> <outDir> [locale...]
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const [exe, outDir, ...locales] = process.argv.slice(2);
if (!exe || !outDir) {
  console.error('usage: node scripts/shoot.mjs <exe> <outDir> [locale...]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const PORT = 9444;
const child = spawn(exe, [`--remote-debugging-port=${PORT}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let id = 0;
function send(ws, method, params = {}) {
  const mine = ++id;
  return new Promise((resolve, reject) => {
    const onMessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== mine) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
      resolve(msg.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id: mine, method, params }));
  });
}

const evaluate = async (ws, expression) => {
  const r = await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.result?.description ?? 'threw');
  return r.result?.value;
};

try {
  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
    if (!page) await sleep(500);
  }
  if (!page) throw new Error('app never exposed a debuggable page');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await sleep(1500);

  for (const locale of (locales.length ? locales : ['en'])) {
    // The switcher lives in the rail; click it rather than reaching into state,
    // so the screenshot reflects what a user would actually get.
    await evaluate(ws, `
      (() => {
        const label = ${JSON.stringify(locale)} === 'he' ? 'עברית' : 'English';
        const btn = [...document.querySelectorAll('.langswitch button')]
          .find((b) => b.textContent.trim() === label);
        if (btn) btn.click();
        return !!btn;
      })()
    `);
    await sleep(900);

    const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    const file = path.join(outDir, `app-${locale}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));

    const dir = await evaluate(ws, 'document.documentElement.dir');
    console.log(`${locale}: dir=${dir} -> ${file}`);
  }

  ws.close();
} catch (err) {
  console.error('shoot failed:', err.message);
  process.exitCode = 1;
} finally {
  child.kill();
}
