const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef } = require('pdf-lib');

/** Every annotation subtype on a page of a saved document, read independently. */
async function subtypesOnPage(bytes, pageIndex) {
  const doc = await PDFDocument.load(bytes);
  const list = doc.getPages()[pageIndex].node.get(PDFName.of('Annots'));
  if (!(list instanceof PDFArray)) return [];
  return list.asArray()
    .map((e) => (e instanceof PDFRef ? doc.context.lookupMaybe(e, PDFDict) : e))
    .filter(Boolean)
    .map((d) => String(d.get(PDFName.of('Subtype'))).replace('/', ''));
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

const DIST = path.resolve('dist-e2e-reader');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const pass = (m) => console.log(`OK    ${m}`);
const fail = (m) => { console.log(`FAIL  ${m}`); failed = true; };

/** Poll until `expr` is truthy, so the suite waits on work rather than on the clock. */
async function until(js, expr, tries = 60, gap = 250) {
  for (let i = 0; i < tries; i++) {
    if (await js(expr)) return true;
    await sleep(gap);
  }
  return false;
}

app.whenReady().then(async () => {
  try {
    protocol.handle('app', async (req) => {
      const { pathname } = new URL(req.url);
      const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
      const target = path.resolve(DIST, rel || 'reader.html');
      if (target !== DIST && !target.startsWith(DIST + path.sep)) return new Response('no', { status: 403 });
      try { return await net.fetch(pathToFileURL(target).toString()); }
      catch { return new Response('missing', { status: 404 }); }
    });

    const win = new BrowserWindow({ show: false, width: 1400, height: 900 });
    await win.loadURL('app://local/reader.html');
    const js = (expr) => win.webContents.executeJavaScript(expr, true);

    // The language preference persists in localStorage under this origin, so a
    // previous run that ended in Hebrew would otherwise leak into this one.
    await sleep(600);
    await js(`window.setLocale && window.setLocale('en')`);
    await sleep(400);

    // 1. It mounts. A TDZ error in a dependency array surfaces here.
    const mount = await js('window.e2eReader ?? null');
    mount?.mounted ? pass('component mounted') : fail(`did not mount: ${mount?.error ?? 'no signal'}`);

    // 2. Open the fixture.
    await js(`document.querySelector('.drop').click()`);
    const opened = await until(js, `!!document.querySelector('.rviewer')`);
    opened ? pass('viewer opened') : fail('viewer never appeared');

    // 3. Pages rasterise. data-rendered is set only after drawImage.
    const painted = await until(js, `!!document.querySelector('.rpage__canvas[data-rendered="true"]')`);
    painted ? pass('first page rasterised') : fail('no page ever rendered');

    // 4. Virtualised: a 10-page document at fit-width must not mount all ten.
    const mounted = await js(`document.querySelectorAll('.rpage').length`);
    mounted > 0 && mounted < 10
      ? pass(`virtualised: ${mounted} of 10 pages mounted`)
      : fail(`expected a partial window, got ${mounted} of 10`);

    // 5. The scroll content is taller than the viewport, i.e. layout ran.
    const geometry = await js(`(() => {
      const v = document.querySelector('.rviewer');
      const c = document.querySelector('.rviewer__content');
      return { view: v.clientHeight, content: c.getBoundingClientRect().height };
    })()`);
    geometry.content > geometry.view
      ? pass(`content ${Math.round(geometry.content)}px in a ${geometry.view}px viewport`)
      : fail(`content ${geometry.content} is not taller than the viewport ${geometry.view}`);

    // 6. The text layer produced real, selectable spans.
    const spans = await until(js, `document.querySelectorAll('.textLayer span').length > 0`);
    spans ? pass('text layer rendered spans') : fail('text layer produced no spans');
    const sample = await js(`(() => {
      const s = document.querySelector('.textLayer span');
      return s ? s.textContent.trim() : '';
    })()`);
    sample ? pass(`text layer carries text: ${JSON.stringify(sample.slice(0, 30))}`) : fail('spans have no text');

    // The whole point of deleting `user-select: none` from body.
    const selectable = await js(`getComputedStyle(document.querySelector('.textLayer span')).userSelect`);
    selectable === 'text' ? pass('page text is selectable') : fail(`user-select is "${selectable}"`);

    // 7. Scrolling advances the page counter and mounts later pages.
    await js(`(() => { const v = document.querySelector('.rviewer'); v.scrollTop = v.scrollHeight / 2; v.dispatchEvent(new Event('scroll')); })()`);
    await sleep(500);
    const midPage = await js(`+document.querySelector('.rbar__pages input').value`);
    midPage > 1 ? pass(`scrolled to page ${midPage}`) : fail('page counter did not follow the scroll');

    // Pages that left the viewport are unmounted rather than accumulating.
    const stillPartial = await js(`document.querySelectorAll('.rpage').length`);
    stillPartial < 10
      ? pass(`still virtualised after scrolling (${stillPartial} mounted)`)
      : fail(`all ${stillPartial} pages mounted after scrolling`);

    // 8. Jump back to page 1 through the page box.
    await js(`(() => {
      const i = document.querySelector('.rbar__pages input');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(i, '1');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    })()`);
    await sleep(500);
    const backToTop = await js(`document.querySelector('.rviewer').scrollTop`);
    backToTop < 50 ? pass('page box navigates') : fail(`page box left scrollTop at ${backToTop}`);

    // 9. Bookmarks resolved to real page numbers, including the Hebrew one.
    const outline = await js(`[...document.querySelectorAll('.routline__item')].map(b => b.textContent.trim())`);
    outline.length === 5
      ? pass(`outline listed ${outline.length} bookmarks`)
      : fail(`expected 5 bookmarks, got ${outline.length}: ${JSON.stringify(outline)}`);
    outline.some((o) => /פרק/.test(o))
      ? pass('Hebrew bookmark title survived')
      : fail(`no Hebrew bookmark in ${JSON.stringify(outline)}`);

    // Clicking one navigates. "Chapter Two" is on page 6 in this fixture.
    await js(`[...document.querySelectorAll('.routline__item')].find(b => b.textContent.includes('Chapter Two')).click()`);
    await sleep(600);
    const jumped = await js(`+document.querySelector('.rbar__pages input').value`);
    jumped === 6 ? pass('bookmark jumped to page 6') : fail(`bookmark went to page ${jumped}, expected 6`);

    // 10. Search finds real text across the document.
    await js(`document.querySelector('[aria-label="Find in document"]').click()`);
    await until(js, `!!document.querySelector('.rfind input')`);
    await js(`(() => {
      const i = document.querySelector('.rfind input');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(i, 'Outlined');
      i.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const counted = await until(js, `/\\d+ of \\d+/.test(document.querySelector('.rfind__count').textContent)`, 80);
    const countText = await js(`document.querySelector('.rfind__count').textContent`);
    counted ? pass(`search reported "${countText}"`) : fail(`search never reported a count (showed "${countText}")`);

    // A hit is actually drawn over the page, at a real size.
    const hit = await until(js, `!!document.querySelector('.rhit')`, 40);
    hit ? pass('search hit highlighted on the page') : fail('no highlight rendered');
    const hitBox = await js(`(() => {
      const h = document.querySelector('.rhit');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    hitBox && hitBox.w > 2 && hitBox.h > 2
      ? pass(`highlight measured ${hitBox.w}x${hitBox.h}px from the real text layer`)
      : fail(`highlight has no size: ${JSON.stringify(hitBox)}`);

    // Stepping moves the active hit.
    const firstActive = await js(`document.querySelector('.rfind__count').textContent`);
    await js(`document.querySelector('[aria-label="Next match"]').click()`);
    await sleep(500);
    const nextActive = await js(`document.querySelector('.rfind__count').textContent`);
    nextActive !== firstActive
      ? pass(`next match advanced: ${firstActive} -> ${nextActive}`)
      : fail(`next match did not advance (still ${nextActive})`);

    // 11. Zoom changes the rendered size.
    const widthAt = () => js(`Math.round(document.querySelector('.rpage').getBoundingClientRect().width)`);
    const beforeZoom = await widthAt();
    await js(`document.querySelector('[aria-label="Zoom in"]').click()`);
    await sleep(600);
    const afterZoom = await widthAt();
    afterZoom > beforeZoom
      ? pass(`zoom in widened the page ${beforeZoom} -> ${afterZoom}px`)
      : fail(`zoom did nothing: ${beforeZoom} -> ${afterZoom}`);

    // 12. Rotating the view swaps the page's aspect ratio.
    const aspect = () => js(`(() => {
      const r = document.querySelector('.rpage').getBoundingClientRect();
      return r.width > r.height ? 'landscape' : 'portrait';
    })()`);
    const beforeRotate = await aspect();
    await js(`document.querySelector('[aria-label="Rotate view"]').click()`);
    await sleep(800);
    const afterRotate = await aspect();
    afterRotate !== beforeRotate
      ? pass(`rotate swapped the page to ${afterRotate}`)
      : fail(`rotate did not change the aspect (${beforeRotate})`);
    await js(`document.querySelector('[aria-label="Rotate view"]').click()`);
    await sleep(600);

    // 13. Annotate: select real text, highlight it, and check it is drawn.
    await js(`document.querySelector('.rviewer').scrollTop = 0`);
    await sleep(600);
    const selected = await js(`(() => {
      const span = document.querySelector('.textLayer span');
      if (!span || !span.firstChild) return false;
      const r = document.createRange();
      r.selectNodeContents(span);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return sel.toString().length > 0;
    })()`);
    selected ? pass('selected text on the page') : fail('could not select page text');

    await js(`document.querySelector('[aria-label="Highlight"]').click()`);
    await sleep(500);
    const drawn = await js(`document.querySelectorAll('.rannot--highlight').length`);
    drawn > 0 ? pass(`highlight drawn (${drawn} rect)`) : fail('no highlight appeared');
    const countShown = await js(`(document.querySelector('.rbar__count') || {}).textContent || ''`);
    /1 annotation/.test(countShown)
      ? pass(`toolbar reports "${countShown}"`)
      : fail(`toolbar count was "${countShown}"`);

    // Undo removes it again.
    await js(`document.querySelector('[aria-label="Undo last annotation"]').click()`);
    await sleep(400);
    const afterUndo = await js(`document.querySelectorAll('.rannot--highlight').length`);
    afterUndo === 0 ? pass('undo removed the highlight') : fail(`undo left ${afterUndo} rects`);

    // Put it back for the save test.
    await js(`(() => {
      const span = document.querySelector('.textLayer span');
      const r = document.createRange();
      r.selectNodeContents(span);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
    })()`);
    await js(`document.querySelector('[aria-label="Highlight"]').click()`);
    await sleep(400);

    // 14. Ink: arm the tool and drag across the page.
    await js(`document.querySelector('[aria-label="Draw"]').click()`);
    const surface = await until(js, `!!document.querySelector('.rpage__draw')`, 40);
    surface ? pass('ink capture surface appeared') : fail('ink tool did not arm');
    await js(`(() => {
      const el = document.querySelector('.rpage__draw');
      const box = el.getBoundingClientRect();
      const at = (dx, dy) => ({
        clientX: box.left + dx, clientY: box.top + dy,
        pointerId: 1, button: 0, bubbles: true, cancelable: true,
      });
      // setPointerCapture on a synthetic pointerId would throw, so it is stubbed.
      el.setPointerCapture = () => {};
      el.dispatchEvent(new PointerEvent('pointerdown', at(60, 60)));
      for (let i = 1; i <= 8; i++) el.dispatchEvent(new PointerEvent('pointermove', at(60 + i * 12, 60 + i * 5)));
      el.dispatchEvent(new PointerEvent('pointerup', at(156, 100)));
    })()`);
    await sleep(400);
    const inked = await js(`document.querySelectorAll('.rpage__ink polyline').length`);
    inked > 0 ? pass(`ink stroke recorded and drawn (${inked} polyline)`) : fail('no ink stroke drawn');
    // Disarm, or the capture surface swallows the clicks the rest of the run needs.
    await js(`document.querySelector('[aria-label="Draw"]').click()`);
    await sleep(200);

    // 15. Fill a form field.
    await js(`document.querySelector('[aria-label="Fill form fields"]').click()`);
    const fieldShown = await until(js, `!!document.querySelector('.rfield')`, 40);
    fieldShown ? pass('form field rendered over the page') : fail('no form field appeared');
    await js(`(() => {
      const i = document.querySelector('.rfield');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(i, 'שלום reader');
      i.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(300);

    // 16. Save, and verify the actual bytes rather than the toast.
    await js(`window.lastWrite = null`);
    await js(`[...document.querySelectorAll('.btn')].find(b => b.textContent.includes('Save a copy')).click()`);
    const wrote = await until(js, `!!window.lastWrite`, 80);
    wrote ? pass('save wrote a document') : fail('nothing was written');

    if (wrote) {
      const b64 = await js(`window.lastWrite`);
      const bytes = Buffer.from(b64, 'base64');
      const subtypes = await subtypesOnPage(bytes, 0);
      subtypes.includes('Highlight')
        ? pass('saved file contains a real /Highlight annotation')
        : fail(`saved file has no highlight: ${JSON.stringify(subtypes)}`);
      subtypes.includes('Ink')
        ? pass('saved file contains a real /Ink annotation')
        : fail(`saved file has no ink: ${JSON.stringify(subtypes)}`);

      const doc = await PDFDocument.load(bytes);
      doc.getPageCount() === 10 ? pass('saved file still has 10 pages') : fail(`pages: ${doc.getPageCount()}`);
      doc.catalog.get(PDFName.of('Outlines'))
        ? pass('saved file kept its outline')
        : fail('outline was dropped by the save');
      const value = doc.getForm().getTextField('spike.name').getText();
      value === 'שלום reader'
        ? pass('Hebrew form value round-tripped through the save')
        : fail(`form value was ${JSON.stringify(value)}`);
      const widget = doc.getForm().getTextField('spike.name').acroField.getWidgets()[0];
      widget.dict.get(PDFName.of('AP'))
        ? pass('Hebrew value got an appearance stream')
        : fail('no appearance stream for the Hebrew value');
    }

    // 17. Hebrew: the interface mirrors and the reader keeps working.
    await js(`window.setLocale('he')`);
    await sleep(600);
    const dir = await js(`document.documentElement.dir`);
    dir === 'rtl' ? pass('document direction is rtl') : fail(`dir is ${dir}`);
    const railSide = await js(`(() => {
      const side = document.querySelector('.rside').getBoundingClientRect();
      const view = document.querySelector('.rviewer').getBoundingClientRect();
      return side.left > view.left;
    })()`);
    railSide ? pass('sidebar mirrored to the right under RTL') : fail('sidebar did not mirror');
    const overflow = await js(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`);
    overflow ? pass('no horizontal overflow in RTL') : fail('RTL layout overflows horizontally');
    const stillPainted = await js(`!!document.querySelector('.rpage__canvas[data-rendered="true"]')`);
    stillPainted ? pass('pages still render under RTL') : fail('rendering broke under RTL');
    await js(`window.setLocale('en')`);
    await sleep(400);

    // 18. A two-finger pinch zooms. There is no unit test for this -- it needs
    // real touch events against real layout -- and `adb shell input` cannot send
    // two fingers, so this harness is the only place it gets checked.
    const pinchedFrom = await widthAt();
    await js(`(() => {
      const el = document.querySelector('.rviewer');
      const box = el.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const at = (dx) => new Touch({
        identifier: dx, target: el, clientX: cx + dx, clientY: cy,
      });
      const fire = (type, dx) => el.dispatchEvent(new TouchEvent(type, {
        touches: [at(-dx), at(dx)], targetTouches: [at(-dx), at(dx)],
        changedTouches: [at(-dx), at(dx)], bubbles: true, cancelable: true,
      }));
      fire('touchstart', 40);
      for (let d = 50; d <= 120; d += 10) fire('touchmove', d);
      el.dispatchEvent(new TouchEvent('touchend', {
        touches: [], targetTouches: [], changedTouches: [], bubbles: true,
      }));
    })()`);
    await sleep(600);
    const pinchedTo = await widthAt();
    pinchedTo > pinchedFrom
      ? pass(`pinch zoomed the page ${pinchedFrom} -> ${pinchedTo}px`)
      : fail(`pinch did nothing: ${pinchedFrom} -> ${pinchedTo}`);

    // 14. Nothing blew up along the way.
    const errors = await js(`(window.toastLog || []).filter(l => l.startsWith('error:'))`);
    errors.length === 0 ? pass('no error toasts') : fail(`error toasts: ${JSON.stringify(errors)}`);
    const late = await js('window.e2eReader ?? null');
    late?.mounted ? pass('no uncaught errors after mount') : fail(`late failure: ${late?.error}`);

    console.log(failed ? '\nREADER E2E FAILED' : '\nREADER E2E PASSED');
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.log(`FAIL  harness threw: ${err && err.stack ? err.stack : err}`);
    app.exit(1);
  }
});
