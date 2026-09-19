const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

const DIST = path.resolve('dist');

app.whenReady().then(async () => {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    const target = path.resolve(DIST, rel || 'index.html');
    if (target !== DIST && !target.startsWith(DIST + path.sep)) return new Response('no', { status: 403 });
    try { return await net.fetch(pathToFileURL(target).toString()); }
    catch { return new Response('missing', { status: 404 }); }
  });

  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  await win.loadURL('app://local/index.html');

  const targets = [
    './tesseract/worker.min.js',
    './tesseract/core/tesseract-core-simd-lstm.wasm',
    './tessdata/eng.traineddata.gz',
    './tessdata/heb.traineddata.gz',
    './fonts/NotoSansHebrew-Regular.ttf',
    './cmaps/Adobe-Japan1-UCS2.bcmap',
    './standard_fonts/LiberationSans-Regular.ttf',
  ];

  const results = await win.webContents.executeJavaScript(`
    Promise.all(${JSON.stringify(targets)}.map(async (u) => {
      try {
        const r = await fetch(u);
        const b = await r.arrayBuffer();
        return { u, ok: r.ok, bytes: b.byteLength };
      } catch (e) { return { u, ok: false, error: String(e) }; }
    }))
  `);

  let allOk = true;
  for (const r of results) {
    if (!r.ok || !r.bytes) allOk = false;
    console.log(`${r.ok && r.bytes ? 'OK  ' : 'FAIL'} ${String(r.bytes ?? r.error).padStart(9)}  ${r.u}`);
  }
  console.log(allOk ? 'ALL ASSETS OK' : 'SOME ASSETS FAILED');
  app.quit();
});
