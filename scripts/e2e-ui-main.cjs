const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

const DIST = path.resolve('dist-e2e-ui');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const pass = (m) => console.log(`OK    ${m}`);
const fail = (m) => { console.log(`FAIL  ${m}`); failed = true; };

app.whenReady().then(async () => {
  try {
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    const target = path.resolve(DIST, rel || 'ui.html');
    if (target !== DIST && !target.startsWith(DIST + path.sep)) return new Response('no', { status: 403 });
    try { return await net.fetch(pathToFileURL(target).toString()); }
    catch { return new Response('missing', { status: 404 }); }
  });

  const win = new BrowserWindow({ show: false, width: 1400, height: 900 });
  await win.loadURL('app://local/ui.html');
  const js = (expr) => win.webContents.executeJavaScript(expr, true);

  // Start from a known language. The preference persists in localStorage, so
  // without this a previous run's Hebrew leaks in and the English pass fails
  // in confusing ways (mirrored grid, so ArrowRight moves the other way).
  await sleep(600);
  await js(`window.setLocale && window.setLocale('en')`);
  await sleep(400);

  // 1. It mounts at all. (A TDZ error in a dependency array shows up here.)
  await sleep(600);
  const mount = await js('window.e2eUi ?? null');
  mount?.mounted ? pass('component mounted') : fail(`did not mount: ${mount?.error ?? 'no signal'}`);
  const navLang = await js('navigator.language');
  console.log(`      (navigator.language = ${navLang})`);

  // 2. Open a document and render the grid.
  await js(`document.querySelector('.drop').click()`);
  for (let i = 0; i < 40 && !(await js(`document.querySelectorAll('.page').length > 0`)); i++) await sleep(250);
  const tiles = await js(`document.querySelectorAll('.page').length`);
  tiles === 10 ? pass(`grid rendered ${tiles} pages`) : fail(`expected 10 tiles, got ${tiles}`);

  const order = () => js(`[...document.querySelectorAll('.page__num')].map(e => +e.textContent)`);
  const before = await order();
  JSON.stringify(before) === JSON.stringify([1,2,3,4,5,6,7,8,9,10])
    ? pass('pages start in natural order')
    : fail(`unexpected initial order ${before}`);

  // A page tile is both a selection control and a drag source. dnd-kit spreads
  // its own attributes after the tile's, so its default role="button" used to
  // override role="checkbox" and aria-checked became meaningless -- selection
  // state was never announced.
  const aria = await js(`
    (() => {
      const el = document.querySelector('.page');
      return {
        role: el.getAttribute('role'),
        checked: el.getAttribute('aria-checked'),
        label: el.getAttribute('aria-label'),
        describedBy: !!el.getAttribute('aria-describedby'),
      };
    })()
  `);
  aria.role === 'checkbox' && aria.checked !== null
    ? pass(`tile announces as ${aria.role}, checked=${aria.checked}`)
    : fail(`tile role is "${aria.role}", aria-checked=${aria.checked}`);
  aria.label ? pass(`tile has an accessible name: "${aria.label}"`) : fail('tile has no accessible name');
  aria.describedBy ? pass('drag instructions are wired up') : fail('no aria-describedby from dnd-kit');

  // Selecting must flip the announced state, not just the styling.
  await js(`document.querySelectorAll('.page')[0].click()`);
  await sleep(250);
  const afterClick = await js(`document.querySelector('.page').getAttribute('aria-checked')`);
  afterClick === 'true' ? pass('aria-checked follows selection') : fail(`aria-checked is ${afterClick} after selecting`);
  await js(`document.querySelectorAll('.page')[0].click()`);
  await sleep(250);

  // 3. Reorder with the keyboard sensor: focus tile 1, Space to lift,
  //    ArrowRight to move, Space to drop.
  await js(`document.querySelectorAll('.page')[0].focus()`);
  const focused = await js(`document.activeElement?.className ?? 'none'`);
  focused.includes('page') ? pass('tile focused for keyboard drag') : fail(`focus is on ${focused}`);

  // dnd-kit listens for real DOM key events on the draggable node, so dispatch
  // those rather than driving the OS input queue.
  const sendKey = (key, code, keyCode) => js(`
    (() => {
      const el = document.activeElement;
      for (const type of ['keydown', 'keyup']) {
        el.dispatchEvent(new KeyboardEvent(type, {
          key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)},
          keyCode: ${keyCode}, which: ${keyCode}, bubbles: true, cancelable: true,
        }));
      }
      return true;
    })()
  `);

  await sendKey(' ', 'Space', 32);      // pick up
  await sleep(250);
  await sendKey('ArrowRight', 'ArrowRight', 39);
  await sleep(250);
  await sendKey(' ', 'Space', 32);      // drop
  await sleep(500);

  const after = await order();
  JSON.stringify(after) === JSON.stringify([2,1,3,4,5,6,7,8,9,10])
    ? pass(`keyboard reorder worked: ${after.slice(0,4)}...`)
    : fail(`reorder produced ${after}`);

  const movedChip = await js(`!!document.querySelector('.chip--moved')`);
  movedChip ? pass('moved pages are badged') : fail('no moved badge shown');

  // 4. With NOTHING selected, the whole document is saveable in its new order.
  const label = await js(`
    [...document.querySelectorAll('.panel .btn')].map(b => b.textContent.trim()).find(t => t.startsWith('Save all')) ?? ''
  `);
  label.startsWith('Save all 10 pages')
    ? pass(`whole-document button offered: "${label}"`)
    : fail(`expected a "Save all 10 pages" button, saw "${label}"`);

  const enabled = await js(`
    !([...document.querySelectorAll('.panel .btn')].find(b => b.textContent.includes('Save all'))?.disabled ?? true)
  `);
  enabled ? pass('enabled because pages were rearranged') : fail('button disabled despite a reorder');

  await js(`[...document.querySelectorAll('.panel .btn')].find(b => b.textContent.includes('Save all')).click()`);
  await sleep(600);

  let req = await js('window.lastEdit ?? null');
  if (!req) { fail('no editPages request was sent for the whole document'); }
  else {
    JSON.stringify(req.keep) === JSON.stringify([2,1,3,4,5,6,7,8,9,10])
      ? pass(`whole document saved in grid order: ${req.keep.slice(0,4)}...`)
      : fail(`keep was ${JSON.stringify(req.keep)}`);
    req.reordered === true ? pass('reordered flag set') : fail('reordered flag missing');
  }

  // 5. Selecting pages switches to extracting just those, still in grid order.
  await js('window.lastEdit = null');
  await js(`document.querySelectorAll('.page')[0].click()`);
  await sleep(200);
  await js(`document.querySelectorAll('.page')[1].click()`);
  await sleep(300);

  const keepLabel = await js(`
    [...document.querySelectorAll('.panel .btn')].map(b => b.textContent.trim()).find(t => t.includes('Save selected')) ?? ''
  `);
  keepLabel ? pass('selecting pages switches to "Save selected pages"') : fail('mode did not follow the selection');

  await js(`[...document.querySelectorAll('.panel .btn')].find(b => b.textContent.includes('Save selected')).click()`);
  await sleep(600);
  req = await js('window.lastEdit ?? null');
  JSON.stringify(req?.keep) === JSON.stringify([2, 1])
    ? pass('extracts the picked pages in grid order')
    : fail(`keep was ${JSON.stringify(req?.keep)}`);

  // ---------------------------------------------------------------- Hebrew
  // Everything above ran in English. Re-run the parts that could plausibly
  // break under RTL, rather than assuming a layout flip is cosmetic.
  await js(`window.setLocale('he')`);
  await sleep(500);

  const dir = await js('document.documentElement.dir');
  dir === 'rtl' ? pass('document direction is rtl') : fail(`dir is ${dir}`);
  const lang = await js('document.documentElement.lang');
  lang === 'he' ? pass('document lang is he') : fail(`lang is ${lang}`);

  // Strings actually changed, and to Hebrew specifically.
  const heading = await js(`document.querySelector('.screen__head h1')?.textContent ?? ''`);
  /[\u0590-\u05FF]/.test(heading)
    ? pass(`interface is in Hebrew: "${heading}"`)
    : fail(`heading is still "${heading}"`);

  // This harness mounts the Edit Pages screen alone, so there is no rail to
  // check. The settings panel is the equivalent test: it follows the content in
  // DOM order, so under RTL it must render to the LEFT of the page grid.
  const panelSide = await js(`
    (() => {
      const panel = document.querySelector('.panel');
      const main = document.querySelector('.screen__main');
      if (!panel || !main) return null;
      return {
        panel: Math.round(panel.getBoundingClientRect().left),
        main: Math.round(main.getBoundingClientRect().left),
      };
    })()
  `);
  panelSide && panelSide.panel < panelSide.main
    ? pass(`panel mirrored to the left (panel ${panelSide.panel} < content ${panelSide.main})`)
    : fail(`panel did not mirror: ${JSON.stringify(panelSide)}`);

  // Page 1 should be the RIGHTMOST tile in the grid, not the leftmost.
  const gridOrder = await js(`
    (() => {
      const tiles = [...document.querySelectorAll('.page')];
      if (tiles.length < 2) return null;
      return {
        firstLeft: Math.round(tiles[0].getBoundingClientRect().left),
        secondLeft: Math.round(tiles[1].getBoundingClientRect().left),
      };
    })()
  `);
  gridOrder && gridOrder.firstLeft > gridOrder.secondLeft
    ? pass('page grid mirrored: first tile is to the right of the second')
    : fail(`grid did not mirror: ${JSON.stringify(gridOrder)}`);

  // Nothing may spill sideways once the layout flips.
  const overflow = await js(`
    (() => {
      const el = document.documentElement;
      const wide = [...document.querySelectorAll('*')].filter(
        (n) => n.scrollWidth > n.clientWidth + 2 && getComputedStyle(n).overflowX === 'visible'
      ).length;
      return { doc: el.scrollWidth - el.clientWidth, wide };
    })()
  `);
  overflow.doc <= 0 && overflow.wide === 0
    ? pass('no horizontal overflow in RTL')
    : fail(`overflow: document ${overflow.doc}px, ${overflow.wide} elements`);

  // Directional icons mirror; the rotate icon must not, because clockwise is
  // a physical direction rather than a reading order.
  const icons = await js(`
    (() => {
      const merge = document.querySelector('.icon--directional');
      const rotate = document.querySelector('.page__tools svg');
      const tf = (el) => el ? getComputedStyle(el).transform : 'none';
      return { directional: tf(merge), rotate: tf(rotate) };
    })()
  `);
  icons.rotate === 'none' || !icons.rotate.startsWith('matrix(-1')
    ? pass('rotate icon is not mirrored')
    : fail(`rotate icon was mirrored: ${icons.rotate}`);

  // Reordering must still work with the layout flipped. Compare against the
  // order as it stands NOW: the English pass already rearranged the grid, so
  // comparing against natural order would misread a successful move that
  // happens to restore it.
  await js('window.lastEdit = null');
  const beforeRtlDrag = await order();
  await js(`document.querySelectorAll('.page')[0].focus()`);
  await sendKey(' ', 'Space', 32);
  await sleep(250);
  await sendKey('ArrowLeft', 'ArrowLeft', 37);
  await sleep(250);
  await sendKey(' ', 'Space', 32);
  await sleep(500);

  const heOrder = await order();
  // In RTL the first tile is the RIGHTMOST, so ArrowLeft moves it one place
  // further along the reading order -- it swaps with its neighbour.
  const expected = [...beforeRtlDrag];
  [expected[0], expected[1]] = [expected[1], expected[0]];
  JSON.stringify(heOrder) === JSON.stringify(expected)
    ? pass(`drag-and-drop works under RTL: ${beforeRtlDrag.slice(0, 3)} -> ${heOrder.slice(0, 3)}`)
    : fail(`RTL reorder gave ${heOrder.slice(0, 4)}, expected ${expected.slice(0, 4)}`);

  // Enter must select WITHOUT picking the page up -- dnd-kit activates on
  // Space and Enter by default, which previously collided with selection.
  const beforeEnter = await order();
  await js(`document.querySelectorAll('.page')[2].focus()`);
  await sendKey('Enter', 'Enter', 13);
  await sleep(300);
  const afterEnter = await order();
  const selectedNow = await js(`document.querySelectorAll('.page[data-sel="true"]').length`);
  JSON.stringify(beforeEnter) === JSON.stringify(afterEnter) && selectedNow > 0
    ? pass('Enter selects without starting a drag')
    : fail(`Enter moved pages (${afterEnter.slice(0, 4)}) or selected nothing (${selectedNow})`);

  // Back to English, and the layout must return.
  await js(`window.setLocale('en')`);
  await sleep(400);
  const backDir = await js('document.documentElement.dir');
  backDir === 'ltr' ? pass('switching back restores ltr') : fail(`dir stayed ${backDir}`);

  // Radios without a shared name are not a group: the browser gives each its own
  // tab stop, arrow keys do not move between them, and assistive tech cannot say
  // "2 of 3". React manages `checked` from state, so it looks and clicks fine.
  const radios = await js(`
    (() => {
      const group = document.querySelector('.radios');
      if (!group) return null;
      const inputs = [...group.querySelectorAll('input[type=radio]')];
      return {
        role: group.getAttribute('role'),
        labelled: !!group.getAttribute('aria-label'),
        names: [...new Set(inputs.map((i) => i.name))],
        count: inputs.length,
      };
    })()
  `);
  radios && radios.count > 1 && radios.names.length === 1 && radios.names[0]
    ? pass(`radios share one name ("${radios.names[0]}") across ${radios.count} options`)
    : fail(`radio grouping is wrong: ${JSON.stringify(radios)}`);
  radios && radios.role === 'radiogroup' && radios.labelled
    ? pass('radio group has a role and an accessible name')
    : fail(`radio group role=${radios && radios.role}, labelled=${radios && radios.labelled}`);

  const errs = await js('window.toastLog.filter(t => t.startsWith("error")).join(" | ")');
  errs ? fail(`errors surfaced: ${errs}`) : pass('no error toasts');

  console.log(failed ? '\nUI E2E FAILED' : '\nUI E2E PASSED');
  app.exit(failed ? 1 : 0);
  } catch (err) {
    // Without this a rejected evaluate never reaches app.exit and the run hangs.
    console.log('DRIVER ERROR: ' + (err && err.stack ? err.stack : String(err)));
    app.exit(1);
  }
});
