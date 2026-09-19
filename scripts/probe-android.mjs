/**
 * Drive the app running on an Android device or emulator, over the DevTools
 * protocol -- the mobile counterpart to `scripts/probe-packaged.mjs`.
 *
 * The point is qpdf-wasm. The About screen asks the platform for its versions,
 * and on Capacitor that instantiates the WASM module, claims stdout for JSON
 * mode and runs `--version`. Every mechanic Phase 0 established empirically on
 * the desktop -- the console shim, the argv copy, the stdout-mode warm-up -- is
 * exercised by that one call, in a real WebView rather than in Node.
 *
 * Prerequisites:
 *   the app installed and running, then
 *   adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.lioryosub.pdftoolkit)
 *
 * usage: node scripts/probe-android.mjs
 */
const list = await (await fetch('http://localhost:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('localhost'));
if (!page) { console.log('FAIL  no page target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  const resolve = pending.get(msg.id);
  if (resolve) { pending.delete(msg.id); resolve(msg); }
});

const send = (method, params = {}) => new Promise((resolve) => {
  const mine = ++id;
  pending.set(mine, resolve);
  ws.send(JSON.stringify({ id: mine, method, params }));
});

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (res.error) throw new Error(JSON.stringify(res.error));
  const r = res.result;
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
  }
  return r.result.value;
}

await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Runtime.enable');

let failed = false;
const pass = (m) => console.log(`OK    ${m}`);
const fail = (m) => { console.log(`FAIL  ${m}`); failed = true; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. The renderer is alive and served by Capacitor, not file://.
const origin = await evaluate('location.origin');
origin === 'https://localhost'
  ? pass(`served from ${origin}`)
  : fail(`unexpected origin ${origin}`);

// 2. WebAssembly is available at all -- everything below depends on it.
const hasWasm = await evaluate('typeof WebAssembly === "object"');
hasWasm ? pass('WebAssembly available in the WebView') : fail('no WebAssembly');

// 3. The mobile layout is the one in force.
const layout = await evaluate(`(() => {
  const rail = document.querySelector('.rail');
  const s = getComputedStyle(rail);
  return { dir: s.flexDirection, items: document.querySelectorAll('.rail__item').length };
})()`);
layout.dir === 'row'
  ? pass(`rail is a bottom bar (${layout.items} tools)`)
  : fail(`rail flex-direction is ${layout.dir}`);
layout.items === 9 ? pass('all 8 tools plus About reachable') : fail(`expected 9 rail buttons, saw ${layout.items}`);

// 4. Capacitor's native bridge is present, with the three plugins.
const plugins = await evaluate(`Object.keys(window.Capacitor?.Plugins ?? {}).sort().join(',')`);
['Filesystem', 'FilePicker', 'FileSharer', 'DocumentScanner', 'DocumentStore'].every((p) => plugins.includes(p))
  ? pass(`plugins bridged: ${plugins}`)
  : fail(`missing plugins, saw: ${plugins}`);

// 5. The platform adapter chose Capacitor, not Electron.
const noPreload = await evaluate('window.api === undefined');
noPreload ? pass('no Electron preload bridge, as expected') : fail('window.api exists on Android');

// 6. The scanner is offered here and hidden on the desktop.
const scanTab = await evaluate(`[...document.querySelectorAll('.rail__item')].some(b => /Scan|סריקה/.test(b.textContent))`);
scanTab ? pass('the Scan tool is offered on mobile') : fail('no Scan tool in the rail');

// The app's own plugin, which exists because nothing published can write to a
// place the user picked -- @capacitor/filesystem refuses content:// URIs.
const saveApi = await evaluate(`
  typeof Capacitor.Plugins.DocumentStore?.createDocument === 'function'
  && typeof Capacitor.Plugins.DocumentStore?.writeDocument === 'function'
`);
saveApi ? pass('DocumentStore exposes the save-as and write methods') : fail('DocumentStore is not bridged');

// 7. THE ONE THAT MATTERS: open About, which asks the platform for versions.
//    On Capacitor that instantiates qpdf-wasm and runs it.
await evaluate(`(() => {
  const about = [...document.querySelectorAll('.rail__item')]
    .find(b => /About|אודות/.test(b.textContent));
  if (about) about.click();
  return !!about;
})()`);

let versionText = '';
for (let i = 0; i < 40; i++) {
  await sleep(500);
  versionText = await evaluate(`document.querySelector('.screen')?.textContent ?? ''`);
  if (/\d+\.\d+\.\d+/.test(versionText)) break;
}

const qpdfVersion = /(\d+\.\d+\.\d+)/.exec(versionText)?.[1];
qpdfVersion
  ? pass(`qpdf-wasm ran in the WebView and reported ${qpdfVersion}`)
  : fail(`About never reported a version (text: ${JSON.stringify(versionText.slice(0, 160))})`);

// 8. Nothing threw along the way.
const errors = await evaluate(`(window.__probeErrors ?? []).join(' | ')`);
errors ? fail(`page errors: ${errors}`) : pass('no page errors');

console.log(failed ? '\nANDROID PROBE FAILED' : '\nANDROID PROBE PASSED');
ws.close();
process.exit(failed ? 1 : 0);
