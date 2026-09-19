const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

const DIST = path.resolve('dist-e2e-crop');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const pass = (m) => console.log(`OK    ${m}`);
const fail = (m) => { console.log(`FAIL  ${m}`); failed = true; };
// Tight: a crop must be the rectangle that was drawn, not approximately it.
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

app.whenReady().then(async () => {
  try {
    protocol.handle('app', async (req) => {
      const { pathname } = new URL(req.url);
      const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
      const target = path.resolve(DIST, rel || 'crop.html');
      if (target !== DIST && !target.startsWith(DIST + path.sep)) return new Response('no', { status: 403 });
      try { return await net.fetch(pathToFileURL(target).toString()); }
      catch { return new Response('missing', { status: 404 }); }
    });

    const win = new BrowserWindow({ show: false, width: 1000, height: 900 });
    await win.loadURL('app://local/crop.html');
    const js = (expr) => win.webContents.executeJavaScript(expr, true);
    await sleep(900);

    const mount = await js('window.e2eCrop ?? null');
    mount?.mounted ? pass('cropper mounted') : fail(`did not mount: ${mount?.error ?? 'no signal'}`);

    // The surface is what pointer fractions are measured against, so every
    // gesture below is expressed in fractions of it and converted here.
    const box = await js(`(() => {
      const el = document.querySelector('.cropper__surface');
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`);
    box.w > 50 && box.h > 50
      ? pass(`crop surface is ${Math.round(box.w)}x${Math.round(box.h)}`)
      : fail(`crop surface has no size: ${JSON.stringify(box)}`);

    /** The box's geometry as a string, cheap to compare. */
    const boxRect = () => js(`(() => {
      const r = document.querySelector('.cropper__box').getBoundingClientRect();
      return [r.left, r.top, r.width, r.height].map((n) => Math.round(n)).join(',');
    })()`);

    /**
     * Wait for the rectangle to move and then hold still.
     *
     * A fixed sleep here is a guess about how fast the machine is. On a CI
     * runner -- no display, window never shown -- React's render can land well
     * after it, and the next step then measures a stale DOM and computes its
     * drag from the wrong corner. Failing that way looks like broken crop
     * arithmetic rather than a slow machine.
     */
    const settled = async (before, ms = 3000) => {
      const deadline = Date.now() + ms;
      let value = before;
      let stable = 0;
      while (Date.now() < deadline) {
        await sleep(50);
        const now = await boxRect();
        if (now === before) continue;
        if (now !== value) { value = now; stable = 0; continue; }
        if (++stable >= 3) return;
      }
    };

    /** Drag from one fraction of the surface to another, as a real pointer would. */
    const drag = async (selector, fromX, fromY, toX, toY) => {
      const before = await boxRect();
      await js(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        const b = document.querySelector('.cropper__surface').getBoundingClientRect();
        const at = (fx, fy) => ({
          clientX: b.left + b.width * fx, clientY: b.top + b.height * fy,
          pointerId: 1, button: 0, bubbles: true, cancelable: true,
        });
        // setPointerCapture on a synthetic pointerId throws, so it is stubbed.
        el.setPointerCapture = () => {};
        el.dispatchEvent(new PointerEvent('pointerdown', at(${fromX}, ${fromY})));
        for (let i = 1; i <= 6; i++) {
          const fx = ${fromX} + (${toX} - ${fromX}) * i / 6;
          const fy = ${fromY} + (${toY} - ${fromY}) * i / 6;
          el.dispatchEvent(new PointerEvent('pointermove', at(fx, fy)));
        }
        el.dispatchEvent(new PointerEvent('pointerup', at(${toX}, ${toY})));
      })()`);
      await settled(before);
    };

    /** The rectangle as the DOM actually shows it, not as state claims. */
    const shown = () => js(`(() => {
      const b = document.querySelector('.cropper__surface').getBoundingClientRect();
      const r = document.querySelector('.cropper__box').getBoundingClientRect();
      return { x: (r.left - b.left) / b.width, y: (r.top - b.top) / b.height,
               width: r.width / b.width, height: r.height / b.height };
    })()`);

    // 1. Drawing a fresh rectangle on the backdrop.
    await drag('.cropper__surface', 0.2, 0.25, 0.7, 0.75);
    let r = await shown();
    near(r.x, 0.2) && near(r.y, 0.25) && near(r.width, 0.5) && near(r.height, 0.5)
      ? pass(`dragging drew a rectangle at ${r.x.toFixed(2)},${r.y.toFixed(2)} ${r.width.toFixed(2)}x${r.height.toFixed(2)}`)
      : fail(`unexpected rectangle: ${JSON.stringify(r)}`);

    // 2. Moving it keeps its size.
    const before = r;
    await drag('.cropper__box', 0.45, 0.5, 0.55, 0.5);
    r = await shown();
    near(r.width, before.width) && near(r.height, before.height) && r.x > before.x
      ? pass('dragging the middle moves without resizing')
      : fail(`move changed the size: ${JSON.stringify(r)}`);

    // 3. A corner handle resizes.
    const beforeCorner = r;
    await drag('.cropper__handle--se', r.x + r.width, r.y + r.height, 0.95, 0.95);
    r = await shown();
    r.width > beforeCorner.width && near(r.x, beforeCorner.x)
      ? pass('a corner handle resizes and leaves the opposite corner alone')
      : fail(`corner drag did the wrong thing: ${JSON.stringify(r)}`);

    // 4. Handles are big enough to hit with a thumb. 24px is the usual floor.
    const handle = await js(`(() => {
      const r = document.querySelector('.cropper__handle--nw').getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    handle.w >= 20 && handle.h >= 20
      ? pass(`handles are ${handle.w}x${handle.h}px, reachable by touch`)
      : fail(`handles are only ${handle.w}x${handle.h}px`);

    // 5. Dragging far outside clamps rather than escaping the image.
    await drag('.cropper__handle--nw', 0.2, 0.2, -0.8, -0.8);
    r = await shown();
    r.x >= -0.01 && r.y >= -0.01 && r.x + r.width <= 1.01 && r.y + r.height <= 1.01
      ? pass('dragging past the edge clamps inside the image')
      : fail(`rectangle escaped: ${JSON.stringify(r)}`);

    // 6. Reset restores the whole image.
    const beforeReset = await boxRect();
    await js(`[...document.querySelectorAll('.cropper__bar button')].find(b => /Whole page/.test(b.textContent)).click()`);
    await settled(beforeReset);
    r = await shown();
    near(r.width, 1, 0.02) && near(r.height, 1, 0.02)
      ? pass('reset restores the whole image')
      : fail(`reset left ${JSON.stringify(r)}`);

    // 7. Apply hands back what is shown.
    await drag('.cropper__surface', 0.1, 0.1, 0.6, 0.6);
    const beforeApply = await shown();
    await js(`[...document.querySelectorAll('.cropper__bar button')].find(b => b.textContent.trim() === 'Crop').click()`);
    // Wait for the callback to have fired rather than assuming it has.
    const deadline = Date.now() + 3000;
    let applied = null;
    while (Date.now() < deadline && !applied) {
      await sleep(50);
      applied = await js('window.cropApplied ?? null');
    }
    applied && near(applied.x, beforeApply.x) && near(applied.width, beforeApply.width)
      ? pass(`apply returned the rectangle shown (${applied.width.toFixed(2)} wide)`)
      : fail(`apply returned ${JSON.stringify(applied)} for ${JSON.stringify(beforeApply)}`);

    const late = await js('window.e2eCrop ?? null');
    late?.mounted ? pass('no uncaught errors') : fail(`late failure: ${late?.error}`);

    console.log(failed ? '\nCROP E2E FAILED' : '\nCROP E2E PASSED');
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.log(`FAIL  harness threw: ${err && err.stack ? err.stack : err}`);
    app.exit(1);
  }
});
