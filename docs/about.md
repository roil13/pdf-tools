# PDF Toolkit

A complete PDF workbench that runs entirely on your own machine. No file ever
leaves the device, nothing is uploaded, there are no accounts, no telemetry and
no AI features. It works with the network switched off — not as a degraded mode,
but as the only mode. Every tool writes a **new** file; your originals are never
modified.

It runs on **Windows** (Electron, installer or portable) and **Android 7+**
(sideloaded APK), from one shared codebase.

## The promise it is built around

**Bookmarks, form fields and tagged structure survive every operation.**

This is the app's reason to exist, and the reason it carries a real build of
**qpdf 12.4.1** rather than using a JavaScript PDF library. A PDF is an object
graph: page content lives in page objects, but bookmarks (`/Outlines`), form
fields (`/AcroForm`) and the accessibility tree live at the document level and
*reference* those pages. Libraries that copy pages between documents rebuild the
document root and silently drop all of it — the pages look perfect while the
bookmarks and fillable fields quietly disappear.

Two consequences the app handles explicitly:

- **Removing pages prunes dead bookmarks.** qpdf copies the outline tree
  wholesale, so a bookmark pointing at a deleted page would survive as an entry
  that does nothing when clicked. The hard case: a bookmark can be dead while its
  *children* survive — a chapter heading on a removed page whose sections were
  kept. Those children are re-pointed at the first surviving section rather than
  orphaned. Edit Pages says how many will go *before* you save.
- **Merging writes new bookmarks**, one per source file, so a combined document
  is navigable rather than a flat stack of pages.

The same qpdf runs on both platforms — natively on Windows, compiled to
WebAssembly for the Android WebView — so the guarantee is identical rather than
approximated. See `scripts/build-qpdf-wasm.md` for how that build is made.

## The tools

| Tool | What it does |
|---|---|
| **Read** | A real reader; see below |
| **Scan** *(Android only)* | Photograph pages; the OS finds the page edges and straightens each shot. Arrange, rotate, crop, save as one PDF |
| **Edit Pages** | Drag to rearrange, rotate any page, extract a selection, or delete pages and keep the rest |
| **Merge PDFs** | Combine files with drag-and-drop ordering and a preview of each |
| **Split PDF** | Break one file into several — at pages you pick, every N pages, one file per page, or at top-level bookmarks |
| **Images to PDF** | Pictures to PDF, one page each, with reorder, rotate and crop. JPEG, PNG, WebP, GIF, BMP, AVIF, HEIC, TIFF (including multi-page) |
| **Make Searchable** | OCR a scanned PDF and add an invisible text layer, so it becomes searchable and selectable. English and Hebrew, fully offline |
| **Compress** | Rebuild a PDF more efficiently, losslessly |

The five tools that work on a single document — Read, Edit Pages, Split, Make
Searchable, Compress — **share it**. Switching between them does not mean hunting
for the same file again, which matters far more on a phone than on a desktop.
Each still offers **Open another**.

### The reader

Continuous vertical scroll with a virtualised page stack, so a 500-page document
does not rasterise 500 pages. Zoom by pinch, ctrl+wheel or the toolbar, with the
view anchored on the middle of the screen rather than the top edge — zoom about
the top and the content drifts away from you. Full-text search with hit
highlighting and next/previous. A sidebar with the bookmark tree and a thumbnail
rail. Internal links jump; external links open in the browser. Text is genuinely
selectable and copyable.

**Annotations** — highlight, underline, strike out, sticky notes and freehand ink
— are written as **real PDF `/Annot` objects** via pdf-lib, not a proprietary
sidecar. Any other PDF reader will show them.

**Form filling** works on AcroForm fields, including Hebrew values, which need an
embedded font to render an appearance stream at all. Saving goes to a new file,
and the outline and form structure survive the round trip.

## Where files come from and go

On Windows: ordinary file dialogs and paths.

On Android: the **Storage Access Framework**. Opening uses the system document
picker; saving uses a real Save-as dialog where the user chooses the folder *and*
the filename, in any storage provider they have. The app never sees a filesystem
path, only a `content://` URI it was granted. This needed a purpose-built Android
plugin (`native/android/DocumentStorePlugin.java`): no published Capacitor plugin
can write to a user-chosen location, and `@capacitor/filesystem` rejects
`content://` URIs outright.

## Languages

**English and Hebrew**, with a fully mirrored right-to-left layout — not a
translated LTR app, but logical CSS properties throughout, so the whole interface
flips. Hebrew's dual plural form is handled. The interface follows the system
language on first run and can be switched at any time; the choice is remembered.
A missing Hebrew string is a *compile error*, not something that slips through.

## How it is built

A React 19 and TypeScript renderer, shared between an Electron main process on
Windows and a Capacitor WebView on Android. The renderer has no Node access at
all: on the desktop it goes through a typed IPC surface, on Android through the
platform adapter. One `Platform` interface with two implementations is what lets
a single UI serve both hosts, and document handles are deliberately opaque,
because Android hands out `content://` URIs and a path abstraction would leak.

Rendering is pdf.js; structural operations are qpdf; annotations and form filling
are pdf-lib editing the document in place; OCR is tesseract.js at 300 dpi with
vendored English and Hebrew language data. All of it ships inside the app —
nothing is fetched at run time.

## How it is verified

`npm run verify` runs a mechanised repository audit, a type check, 255 unit
tests, and four end-to-end suites that drive the real screens in a real renderer
— opening documents, scrolling, searching, highlighting real text, drawing,
filling a Hebrew form field, saving, and reading the bytes back. PDF outputs are
read back with the *native* qpdf binary rather than trusting the writer under
test. CI runs the same gate on Windows for every push, and `npm run probe:android`
does the equivalent against a device.

What was verified empirically, what it cost, and the things that turned out to be
wrong are in [`spike-findings.md`](spike-findings.md).

## Limitations

- **Sideloaded on Android**, not from a store. It is a signed release build, so
  it installs once you allow it; Play Protect may warn the first time, since it
  is not Play-signed.
- **The camera scanner needs Google Play Services** and a physical camera. It is
  the one feature that cannot be tested on an emulator — ML Kit refuses to run on
  one — and the only proprietary dependency in the app. Every other tool works
  without it.
- **Windows only on the desktop.** No macOS or Linux build, and no iOS.
- **Password-protected PDFs** are detected and reported, never altered or
  unlocked.
- **The HEIC decoder has never actually been executed** — there was no sample to
  test with, and Windows has no built-in HEIC encoder to make one. Every other
  image format is covered end to end.

Not supported by design: editing existing page content, image downsampling,
digital signatures, and anything involving a network or a model.
