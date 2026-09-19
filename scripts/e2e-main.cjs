const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

const DIST = path.resolve('dist-e2e');

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
  win.webContents.on('console-message', (_e, _lvl, msg) => {
    if (!/Autofill|devtools/i.test(msg)) console.log('  [renderer]', msg);
  });

  await win.loadURL('app://local/index.html');

  const deadline = Date.now() + 180000;
  let result = null;
  while (Date.now() < deadline) {
    result = await win.webContents.executeJavaScript('window.e2e ?? null');
    if (result) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!result) { console.log('TIMED OUT'); app.exit(1); return; }
  if (!result.ok) { console.log('FAILED:\n' + result.error); app.exit(1); return; }

  console.log('\nsteps:');
  for (const s of result.steps) console.log('  - ' + s);
  console.log('\nOCR text:\n' + result.ocrText.split('\n').map((l) => '  ' + l).join('\n'));
  console.log('\nextracted back from the text layer:');
  console.log('  ' + JSON.stringify(result.extracted));

  const img = result.images;
  console.log('');
  console.log('images -> PDF:');
  for (const [f, r] of Object.entries(img.perFile)) console.log(`  ${f.padEnd(14)} ${r}`);
  console.log(`  decoded ${img.decodedFrames} frames -> ${img.pageCount} pages, page 1 = ${img.dims.w}x${img.dims.h} pt, ${img.bytes} bytes`);
  // `let`, not `const`: the rotate and crop checks below add to it, and an
  // assignment to a const would throw instead of reporting the failure.
  let imgFail = Object.values(img.perFile).some((v) => String(v).startsWith('FAILED'))
    || img.pageCount !== img.decodedFrames || img.decodedFrames === 0;
  console.log(`  images: ${imgFail ? 'FAIL' : 'all decoders OK'}`);

  // A quarter turn becomes a PAGE rotation, so a viewer reports the page the
  // other way round without the pixels having been redrawn.
  const rot = img.rotation;
  const turnedOk = rot && rot.rotate === 90 && rot.w === img.dims.h && rot.h === img.dims.w;
  console.log(`  rotate: /Rotate ${rot && rot.rotate}, viewport ${rot && rot.w}x${rot && rot.h} `
    + `(unrotated ${img.dims.w}x${img.dims.h}) ${turnedOk ? 'OK' : 'FAIL'}`);
  if (!turnedOk) imgFail = true;

  // A half-size crop halves the page in both directions, give or take rounding.
  const c = img.cropDims;
  const cropOk = c && Math.abs(c.w - img.dims.w / 2) <= 2 && Math.abs(c.h - img.dims.h / 2) <= 2;
  console.log(`  crop:   page ${c && c.w}x${c && c.h} from ${img.dims.w}x${img.dims.h} `
    + `${cropOk ? 'OK' : 'FAIL'}`);
  if (!cropOk) imgFail = true;

  const joined = result.extracted.join(' ');
  const wantEn = ['Hello', 'searchable', 'invoice'];
  const wantHe = ['שלום', 'עברית'];
  const missEn = wantEn.filter((w) => !joined.includes(w));
  const missHe = wantHe.filter((w) => !joined.includes(w));

  console.log(`\nEnglish: ${missEn.length ? 'MISSING ' + missEn.join(',') : 'all found'}`);
  console.log(`Hebrew : ${missHe.length ? 'MISSING ' + missHe.join(',') : 'all found'}`);
  const pass = !missEn.length && !missHe.length && result.wordCount > 0 && !imgFail;
  console.log('\n' + (pass ? 'E2E OCR PASS' : 'E2E OCR FAIL'));
  app.exit(pass ? 0 : 1);
});
