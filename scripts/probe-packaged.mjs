/**
 * Verifies the PACKAGED build end to end, which `npm run dev` cannot:
 *
 *  - qpdfPath() takes its app.isPackaged branch (process.resourcesPath/qpdf),
 *    a path that has never executed in development
 *  - the renderer is served over app:// rather than file://
 *  - a real PDF can be inspected through the full IPC round trip
 *
 * Drives the app over the Chrome DevTools Protocol, so it exercises the shipped
 * binary rather than a re-creation of it.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const exe = process.argv[2];
if (!exe) {
  console.error('usage: node scripts/probe-packaged.mjs <path to exe>');
  process.exit(2);
}

const PORT = 9333;
const child = spawn(exe, [`--remote-debugging-port=${PORT}`], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not listening yet */ }
    await sleep(500);
  }
  throw new Error('the app never exposed a debuggable page');
}

function evaluate(ws, expression, id) {
  return new Promise((resolve, reject) => {
    const onMessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
      const r = msg.result?.result;
      if (msg.result?.exceptionDetails) return reject(new Error(r?.description ?? 'threw'));
      resolve(r?.value);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({
      id, method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
}

const fail = (m) => { console.log(`FAIL  ${m}`); process.exitCode = 1; };
const pass = (m) => console.log(`OK    ${m}`);

try {
  const page = await findPage();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  // 1. Served over app://, not file://
  const origin = await evaluate(ws, 'location.origin', 1);
  origin.startsWith('app://') ? pass(`served from ${origin}`) : fail(`origin is ${origin}, expected app://`);

  // 2. qpdf resolves and runs from the packaged resources directory
  const versions = await evaluate(ws, 'window.api.versions()', 2);
  if (versions?.ok && /qpdf version/i.test(versions.value?.qpdf ?? '')) {
    pass(`qpdf runs from the packaged path: ${versions.value.qpdf}`);
    pass(`electron ${versions.value.electron} · chrome ${versions.value.chrome}`);
  } else {
    fail(`qpdf did not run: ${JSON.stringify(versions)}`);
  }

  // 3. A real PDF goes through the whole IPC round trip
  const fixture = path.resolve('test/fixtures/outlined-form.pdf');
  const info = await evaluate(ws, `window.api.inspect(${JSON.stringify(fixture)})`, 3);
  if (info?.ok && info.value.pageCount === 10 && info.value.hasAcroForm && info.value.outline.length === 5) {
    pass(`inspected a real PDF: ${info.value.pageCount} pages, form fields, ${info.value.outline.length} bookmarks`);
  } else {
    fail(`inspect returned ${JSON.stringify(info)}`);
  }

  // 4. Runtime assets resolve in the packaged bundle
  const assets = await evaluate(ws, `
    Promise.all(['./tessdata/eng.traineddata.gz','./fonts/NotoSansHebrew-Regular.ttf','./tesseract/worker.min.js']
      .map(async (u) => { try { const r = await fetch(u); return (await r.arrayBuffer()).byteLength; } catch { return 0; } }))
  `, 4);
  assets.every((n) => n > 0)
    ? pass(`OCR assets served: ${assets.join(', ')} bytes`)
    : fail(`some OCR assets missing: ${assets.join(', ')}`);

  ws.close();
} catch (err) {
  fail(String(err.message ?? err));
} finally {
  child.kill();
  await sleep(500);
  console.log(process.exitCode ? '\nPACKAGED PROBE FAILED' : '\nPACKAGED PROBE PASSED');
}
