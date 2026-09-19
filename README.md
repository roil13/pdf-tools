# PDF Toolkit

[![verify](https://github.com/roil13/pdf-tools/actions/workflows/verify.yml/badge.svg)](https://github.com/roil13/pdf-tools/actions/workflows/verify.yml)
[![licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

A small, offline PDF toolkit for Windows and Android. No file ever leaves your computer,
nothing is uploaded, everything works with no internet connection, and there are
no AI features.

Available in **English and Hebrew**, with a fully mirrored right-to-left layout.
The interface follows the system language on first run and can be switched at any
time from the sidebar; the choice is remembered.

Every tool writes a **new** file. Your originals are never modified.

The tools that work on one document — Read, Edit Pages, Split, Make Searchable
and Compress — share it, so switching between them does not mean finding the
same file again. Each one still offers **Open another** to start somewhere else.

## Tools

| Tool | What it does |
|---|---|
| **Scan** *(mobile)* | Photograph pages with the camera. The OS finds the page edges and straightens each shot; you arrange, rotate, crop and save them as one PDF. The scanner's own JPEGs are embedded untouched — only a page you actually crop is re-encoded, because a JPEG cannot be cropped without decoding it. |
| **Read** | A full reader: continuous scroll, zoom (pinch, ctrl+wheel or the toolbar), search the text, follow bookmarks and links, select and copy. Highlight, underline, strike out, add notes and draw on a page, and fill in form fields — saved to a **new** file as real PDF annotations. |
| **Edit Pages** | Drag pages to rearrange them, rotate any of them, and save the whole document — or pick pages and save just those, or remove them and keep the rest. |
| **Merge PDFs** | Combine PDFs with drag-and-drop ordering and a preview of each file. |
| **Split PDF** | Break one PDF into several — at pages you choose, every N pages, one file per page, or at top-level bookmarks. |
| **Images to PDF** | Turn pictures into a PDF, one page each. Reorder, rotate and crop before saving. JPEG, PNG, WebP, GIF, BMP, AVIF, HEIC and TIFF (including multi-page TIFFs). |
| **Make Searchable** | OCR a scanned PDF and add an invisible text layer so you can search, select and copy. English and Hebrew, fully offline. |
| **Compress** | Rebuild a PDF more efficiently, losslessly. |

## Bookmarks and form fields are preserved

This is the reason the app shells out to **qpdf** rather than using a pure-JS
library. A PDF is an object graph: page content lives in page objects, but
bookmarks (`/Outlines`), form fields (`/AcroForm`) and the tagged-structure tree
live at the document level. Libraries that copy pages between documents rebuild
the document root and silently drop all of it — the pages look perfect while the
bookmarks and fillable fields quietly disappear.

Two consequences worth knowing:

- **Removing pages updates the bookmark list.** qpdf copies the outline tree
  wholesale, so a bookmark pointing at a removed page would survive as a dead
  entry that does nothing when clicked. The app prunes those. The case that
  makes this non-trivial: a bookmark can be dead while its *children* survive —
  a chapter heading on a removed page with sections that were kept. Those are
  kept and re-pointed at the first surviving section, so nothing is orphaned.
  Edit Pages shows how many will go before you save. Split does the same, so
  each piece carries only the bookmarks that land inside it.
- **Merging can only inherit one document's structure.** The first file keeps its
  full bookmark tree and form fields; later files contribute pages only. To keep
  the result navigable, the app adds one top-level bookmark per appended file,
  named after it.

## Development

```bash
npm install
npm run dev        # Vite dev server + Electron, with reload
npm run verify     # typecheck + tests + end-to-end OCR and image pipeline
npm run package    # NSIS installer + portable .exe into release/
```

Individually:

| Command | What it proves |
|---|---|
| `npm test` | Unit tests, plus integration tests that run the **real qpdf binary** and verify structure by reading the output back with an independent qpdf call. |
| `npm run e2e` | Runs the OCR and image pipelines inside a **real Electron renderer** — the only way to cover the canvas, Web Worker and WASM paths. |
| `npm run android` | Builds the renderer and syncs it into the generated Android project. `npm run android:run` also launches it. |
| `npm run android:apk` / `npm run android:apk:release` | The above, then assembles a sideloadable APK. Debug is for testing — it keeps `android:debuggable`, which is how `chrome://inspect` reaches the WebView to diagnose the camera capture. Release is what gets published: not debuggable, and signed with the key named in a gitignored `keystore.properties` (see CONTRIBUTING.md). |
| `npm run probe:android` | Drives the app running on a device or emulator over the DevTools protocol — the mobile counterpart to `probe:packaged`. Confirms it is served by Capacitor, that the native plugins are bridged, that the platform adapter chose Capacitor over Electron, and that **qpdf-wasm actually runs in the WebView**. |
| `npm run e2e:reader` | Drives the real reader in a **real Electron renderer**: opens a document, scrolls, searches, follows a bookmark, highlights real text, draws, fills a Hebrew form field, saves — then reads the saved bytes back with pdf-lib and checks the annotations, the outline and the field value all survived. |
| `npm run e2e:ui` | Mounts the real Edit Pages screen against a stubbed IPC layer and drives it from script: opens a document, reorders with the keyboard, saves, and checks what reached the main process. Then repeats the critical parts **in Hebrew**, asserting the layout mirrors and drag-and-drop still works. |
| `npm run shoot -- "<exe>" <outDir> en he` | Screenshots the app's own page in each language via the DevTools protocol. Captures only the application viewport, never the desktop. |
| `npm run probe:packaged -- "release/win-unpacked/PDF Toolkit.exe"` | Drives the **packaged** app over CDP: confirms it is served from `app://`, that qpdf resolves from `process.resourcesPath`, and that OCR assets load. Run it against the portable exe too, from a folder whose name contains a space. |

`npm test` needs the fixtures; `npm run fixtures` regenerates them.

### Layout

```
electron/     main process — all filesystem and qpdf access
  qpdf.ts       spawn wrapper, exit-code and error handling
  operations.ts inspect / editPages / merge / split / compress
  outline.ts    writes merge bookmarks into an existing PDF
  protocol.ts   serves the renderer over app:// (see below)
  pruneOutline.ts  drops bookmarks whose target page is gone
native/android/   the app's own Android plugin (saving to a place the user picks)
src/          renderer — React UI, no Node access
  platform/     what the app asks of its host, and the Electron implementation
  lib/          pure logic (page ranges, filenames, rotation, cropping, reader layout) + OCR
  reader/       the reader: viewer, search, annotations
  tools/        one screen per tool
  components/   shared UI
shared/types.ts   the Electron IPC wire contract
vendor/       qpdf binary and its WebAssembly build, Tesseract data, Noto Sans Hebrew
scripts/      build, dev, asset staging, and the spikes
docs/spike-findings.md   what was verified empirically, and why
```

The renderer never touches the filesystem or spawns processes. Everything goes
through a typed IPC surface defined in `electron/preload.ts`.

### Two non-obvious things

**The renderer is served over `app://`, not `file://`.** Chromium blocks
`fetch()` against `file://`, and the tesseract worker, its WASM core, the
language data, and pdf.js's cmaps and standard fonts are all fetched by URL at
run time. Under `file://` they work in development (Vite serves them over HTTP)
and fail only in the packaged build. `scripts/probe-assets.mjs` verifies this
against a real production build.

**Translation completeness is a typecheck, not a convention.** `src/i18n/strings.ts`
declares a `Strings` interface explicitly and both dictionaries must satisfy it, so a
missing Hebrew key is a compile error rather than a silent English fallback. Hebrew also
has a **dual** form — `Intl.PluralRules('he')` reports `one`, `two`, `other` — so counts
go through plural entries rather than `n === 1 ? '' : 's'`, which cannot express it.

**The main process never produces user-facing prose.** It has no idea what language the
interface is in, so errors carry a translation key plus the raw detail, and the renderer
resolves them (`electron/qpdf.ts` → `src/lib/api.ts`).

**Reordering pages needs no bookmark fix-up.** PDF destinations reference page
*objects* by indirect reference, not by index, so moving a page carries its
bookmarks with it for free. What does need doing is re-sorting the outline
*list*, since a viewer shows bookmarks in tree order — otherwise a bookmark on
page 1 can still appear last. That re-sort only happens when pages were actually
rearranged, because an outline that was never in page order (an index, say)
should not be silently rewritten.

**qpdf's `--rotate` page ranges are numbered against the output, not the
input.** Selecting pages 6–10 and rotating `:1` rotates original page 6. Since
the UI shows input page numbers, rotations are remapped through the selection in
`src/lib/rotation.ts`. The tests deliberately use non-identity selections,
because a test that keeps every page cannot catch this.

Both of these, and everything else that was checked against the actual binaries
rather than the documentation, are written up in `docs/spike-findings.md`.

### Known gaps

The HEIC decoder is wired up but has never been executed — there was no `.heic`
sample to test with, and Windows has no built-in HEIC encoder to make one. Every
other format (PNG, WebP, TIFF via `utif`, and the Chromium-native paths) is
covered by `npm run e2e`. Try a photo straight off an iPhone before trusting it.

Reordering is covered end to end through dnd-kit's **keyboard** sensor. Mouse
dragging shares the same `onDragEnd` path and sensor configuration as the Merge
and Images screens, but is not simulated in the harness.

## Not supported

Unlocking password-protected PDFs (they are detected and reported, never
altered), image downsampling, editing existing page content, digital signatures,
**iOS**, macOS and Linux builds, and any AI feature.

iOS was considered and dropped. Nothing in the codebase targets it — there is no
`ios/` directory and no `@capacitor/ios` dependency — and building for it would
need a macOS machine and a paid Apple Developer membership, neither of which is a
coding problem. The platform layer stays abstract anyway, because that is what
lets one renderer serve both Electron and an Android WebView.

## Licence

MIT — see [LICENSE](LICENSE). That covers the code in this repository; the components
redistributed under `vendor/` keep their own licences, listed below. qpdf ships
its `LICENSE.txt` and `NOTICE.md` alongside the binaries in `vendor/qpdf/` and
`vendor/qpdf-wasm/`.

## Third-party components

Everything redistributed in `vendor/` carries its own licence text and a NOTICE
beside the files, as those licences require.

| | Licence | Text |
|---|---|---|
| [qpdf](https://qpdf.sourceforge.io/) 12.4.1 — native on Windows, and compiled to WebAssembly for Android (`scripts/build-qpdf-wasm.md`) | Apache-2.0 | [`vendor/qpdf/`](vendor/qpdf/LICENSE.txt), [`vendor/qpdf-wasm/`](vendor/qpdf-wasm/LICENSE.txt) |
| [Tesseract](https://github.com/tesseract-ocr/tesseract) language data | Apache-2.0 | [`vendor/tessdata/`](vendor/tessdata/LICENSE.txt) |
| [Noto Sans Hebrew](https://github.com/notofonts/hebrew) | OFL-1.1 | [`vendor/fonts/OFL.txt`](vendor/fonts/OFL.txt) |
| [pdf.js](https://mozilla.github.io/pdf.js/), tesseract.js | Apache-2.0 | npm |
| [pdf-lib](https://pdf-lib.js.org/) | MIT | npm |
| Electron, React, dnd-kit, UTIF, libheif-js | MIT / LGPL | npm |

`vendor/qpdf/` also contains the Microsoft Visual C++ runtime DLLs that the qpdf
build links against (`msvcp140`, `vcruntime140`, `concrt140`). They are
redistributable under Microsoft's terms but are not open source, and they are
Windows-only — the Android build uses the WebAssembly qpdf and none of them.
