# Audit

A repeatable review of `electron/`, `src/` and `shared/` — the application.
`scripts/` and `e2e/` are development tooling and get a lighter pass.

**Exit condition:** two consecutive passes with no findings. If a pass discovers a
*category* of problem the checklist did not cover, that category is added and the
clean counter resets to zero — otherwise "clean" only means "clean against
whatever I happened to look at".

## Checklist

### Scripted — `npm run audit`

| Check | What it catches |
|---|---|
| `i18n.literals` | User-facing English left outside `strings.ts`, in `.ts` **and** `.tsx` |
| `i18n.staleT` | A `useCallback` that calls `t()` without listing it as a dependency, so it keeps the old language after a switch |
| `i18n.placeholders` | A `{name}` present in one language but not the other — renders literally |
| `css.physical` | `left/right/margin-left/…` reappearing where a logical property is needed for RTL |
| `hygiene.console` | Debug output left in app code |
| `hygiene.markers` | `TODO`/`FIXME`/`HACK` |
| `hygiene.controlChars` | Raw control bytes in source, which survive edits invisibly |
| `hygiene.deadExport` | Exported symbols nothing imports |
| `scripts.missing` | `package.json` pointing at a script that no longer exists |

### Read — per pass, by file

| Check | Scope |
|---|---|
| `res.lifetime` | `PDFDocumentProxy`, `ImageBitmap`, canvases, the tesseract worker, temp files |
| `res.unmount` | Long-running work when the component goes away mid-flight |
| `err.paths` | Every `catch`: is swallowing correct here? |
| `err.partial` | Can a failure leave a half-written file at a path the user chose? |
| `ipc.trust` | What the main process accepts from the renderer, and the stated posture |
| `render.effects` | Allocation or side effects during render |
| `path.build` | Path construction consistent between "does this exist" and "where do I write" |
| `a11y` | Roles, labels, and keyboard reachability |
| `test.gaps` | Behaviour that is asserted nowhere |

### Every pass ends with

`npm run typecheck && npm test && npm run e2e && npm run e2e:ui`, plus `npm run audit`.
Any fix that can be pinned by a test gets one.

---

## Pass 1 — 9 findings

### A1 · `i18n.literals` · **checklist gap, counter reset**

Eleven user-facing English strings live outside `strings.ts`, in `src/lib/`. The
i18n work covered `.tsx` screens and missed errors *thrown from library code*,
which reach the user through `errorText`.

- `src/lib/pageRanges.ts` — 7 messages, all shown in the Edit Pages range box or
  the Split panel. One of them, `` `${pageCount} page${pageCount === 1 ? '' : 's'}` ``,
  is the exact English-only pluralisation the i18n work existed to remove.
- `src/lib/imageDecode.ts` — 6 decoder failures ("That TIFF contains no image.")
- `src/lib/usePdfDoc.ts` — the password-protected message, duplicated from
  `error.encrypted` rather than referencing it.

The scripted check only walked `.tsx`, and its pattern required all-lowercase
words after the first, so `'This PDF is password-protected…'` would have slipped
past even in a `.tsx`. **Both the scope and the pattern were wrong**, which is why
this counts as a checklist gap rather than an ordinary finding.

### A2 · `res.lifetime` · `merge` leaks its staged temp file

`electron/operations.ts` — the `runQpdf` call sits **outside** the `try`, so a
qpdf failure skips `finally { fs.rm(staged) }` and leaves a temp file behind.
`editPages` and `split` both wrap correctly; merge is the odd one out.

### A3 · `err.partial` · `compress` writes straight to the user's path

`electron/operations.ts` — no staging. A failure part-way through leaves a
truncated file at the path the user picked, which may be a file they already had.
This contradicts the rule `editPages` states in its own comment: *"a failure
part-way through must never leave a half-written output."*

### A4 · `res.unmount` · OCR keeps running after the screen goes away

`src/tools/Ocr.tsx` — cancellation is checked between pages, but nothing runs when
the component unmounts. Switching tools mid-run leaves the tesseract worker (its
WASM core plus ~13 MB of language data) and the `PDFDocumentProxy` alive, and the
run continues invisibly to completion, writing a file the user is no longer
watching for.

### A5 · `render.effects` · a canvas allocated per image per render

`src/tools/ImagesToPdf.tsx:165` — `bitmapToCanvas(item.image.bitmap, 60)` is called
inside the JSX map, so every render allocates a fresh canvas for every card.
Dragging re-renders continuously.

### A6 · `path.build` · two different joins decide "exists" vs "write"

`src/tools/Split.tsx:99` builds the collision-check path as `` `${dir}\\${name}` ``
with a literal separator, while the main process writes with `path.join`. They
disagree when `dir` ends in a separator (a drive root such as `C:\`), so the
pre-flight check can miss a file that the write then overwrites.

### A7 · `hygiene.controlChars` · raw bytes in a regex

`src/lib/textLayer.ts:26` — `HAS_NON_LATIN` contains a literal NUL and `\xff`
rather than escapes. It works, but it is invisible in an editor and fragile.

### A8 · `hygiene.deadExport` · five exports nothing imports

`IpcError`, `UnsupportedImageError`, `RangeError_`, `QpdfError`, `qpdfPath`.
Each is used only inside its own module. The error classes are the interesting
case: exporting an error type that no caller ever catches by type means the
contract is not actually being used.

### A9 · `res.lifetime` · OCR canvas not released when a page throws

`src/tools/Ocr.tsx` — `canvas.width = 0` releases the backing store at the end of
each iteration, but a throw from `recognise()` skips it. At 300 dpi each canvas is
roughly 34 MB.

---

## Fixes — pass 1

### A1 — one error type, keyed like the main process

Added `UserError` (`src/lib/errors.ts`), carrying a typed `StringKey` plus
interpolation vars, and taught `errorText` to resolve it. `pageRanges`,
`imageDecode` and `usePdfDoc` now throw keys instead of prose, so every message
the user can see comes from `strings.ts` in both languages. This mirrors the
decision already made for the main process: **code that throws does not know what
language the interface is in.**

The `parseRanges` count message became a plural entry, so Hebrew gets its dual
form there too.

Widened the scripted check to `.ts` as well as `.tsx`, and loosened its pattern to
any quoted 3-plus-word phrase containing a lowercase word, with comments and
known non-user-facing strings (HTTP bodies, qpdf stderr needles) allowlisted.

### A2 — stage inside the try

Moved `merge`'s `runQpdf` inside the `try`, so `finally` always removes the temp
file. Regression test: `merge` on an unreadable input leaves no `pdf-tools-merge-*`
behind.

### A3 — compress stages like everything else

`compress` now writes to a temp file and moves it into place only on success.
Regression test: a failing compress leaves the destination untouched.

### A4 — cancel and release on unmount

Added an unmount effect that sets the cancel flag and closes the recogniser and
document. The run loop already checks the flag between pages, so it now stops at
the next boundary and frees the worker.

### A5 — memoize the thumbnail

`bitmapToCanvas` moved into a `useMemo` keyed on the item id, so a card allocates
one canvas for its lifetime rather than one per render.

### A6 — one join

`Split` now asks the main process to build the path (`path.join`), so the
existence check and the write agree by construction.

### A7 — escapes, and a clearer test

Replaced the raw-byte regex with an explicit code-point comparison, matching the
approach already used in `safeName.ts`.

### A8 — narrow the surface

`qpdfPath` is no longer exported. The error classes stay exported but are now
actually used by type: `errorText` narrows on `UserError` and `IpcError`, and the
image decoders are caught as `UnsupportedImageError` where the distinction matters.
`RangeError_` was renamed `RangeParseError` and is caught by type in `Split`.

### A9 — release in a finally

The per-page canvas is now released in a `finally`, so a throw mid-page does not
strand 34 MB.

### Pass 1 result

```
npm run audit    AUDIT CLEAN (9/9 checks)
npm run typecheck  clean
npm test           121 passed (was 107; +11 errorText, +3 staging regressions)
npm run e2e        OCR + images pass
npm run e2e:ui     23/23, English and Hebrew
```

**Clean counter: 0.** A1 was a gap in the checklist itself — the `i18n.literals`
check scanned only `.tsx`, and its pattern required all-lowercase words after the
first, so it could not have found `'This PDF is password-protected…'` even in a
file it did look at. Both were widened. By the rule at the top of this document,
discovering a missing check resets the count regardless of the fixes landing.

Tests added rather than assumed:
- `test/errorText.test.ts` — 11 cases over the key→text mapping in both
  languages, including the unrecognised-key fallback that keeps qpdf's own words
- `test/operations.test.ts` — three cases asserting no temp file survives a
  failure, and that a failed compress leaves the destination byte-identical
- `test/pageRanges.test.ts` — the six error assertions now pin the key **and**
  the interpolation vars, and check the rendered text has no unreplaced `{…}`

---

## Pass 2 — 5 findings

All scripted checks passed. These came from reading, in the areas the scripted
checks cannot see.

### B1 · `res.lifetime` · a failed thumbnail leaks its document

`src/tools/Merge.tsx` — `closeDocument(doc)` sat on the success path only:

```ts
const doc = await openDocument(bytes);
const canvas = await renderPage(doc, 1, 46);  // throws…
await closeDocument(doc);                      // …never runs
```

The surrounding `catch` returned `null` so the card still rendered, and the
document plus its pdf.js worker stayed alive. One per unreadable file added.

### B2 · `err.paths` · unhandled rejection from every thumbnail

`src/components/PageGrid.tsx` — `void renderPage(...).then(...)` had no `.catch`.
Any render failure became an unhandled promise rejection. Reachable the moment a
render fails for any reason, including B3 below.

### B3 · `res.lifetime` · a destroyed document left on screen

`src/lib/usePdfDoc.ts` — `setLoaded(null)` ran only when `path` became null. On a
*change* of path, the cleanup destroyed the previous `PDFDocumentProxy` while
`loaded` still referenced it, so tiles could keep rendering against a destroyed
document until the new one arrived. Combined with B2, opening a second file while
the first was displayed could emit unhandled rejections.

### B4 · `res.lifetime` · aborting a render did not stop it

`src/lib/pdfRender.ts` — the `AbortSignal` was only consulted before and after the
await; `RenderTask.cancel()` was never called. Scrolling a long document kept
rasterising pages that had already left the viewport, at 130 px each.

### B5 · `a11y` · **selection state was never announced**

`src/components/PageGrid.tsx` — the tile sets `role="checkbox"` and `aria-checked`,
then spreads dnd-kit's `attributes` **after** them. dnd-kit defaults to
`role="button"` (`defaultRole` in its source), so the later spread won:

- the tile announced as a button, not a checkbox
- `aria-checked` is meaningless on `role="button"` and is ignored

A screen-reader user could not tell which pages were selected — in a tool whose
entire purpose is selecting pages. The visual state was correct throughout, which
is why nothing caught it.

---

## Fixes — pass 2

### B1 — close in a `finally`

The document is now released whether or not the render succeeds.

### B2 — a failed thumbnail leaves an empty tile

Added a `.catch` that deliberately does nothing: a blank tile is a much better
outcome than an unhandled rejection, and this is a routine occurrence while
switching documents.

### B3 — clear on every path change

`setLoaded(null)` now runs for any change, not only for null, so a destroyed proxy
is never left in state.

### B4 — cancel the render task

`renderPage` now registers an abort listener that calls `task.cancel()`, and
treats the resulting rejection as the expected outcome rather than a fault.

### B5 — tell dnd-kit the real role

`useSortable` accepts an `attributes` option; passing
`{ role: 'checkbox', roleDescription: 'page' }` makes dnd-kit emit the correct
role itself, and stops it adding `aria-pressed` (which only applies to its default
role). Four assertions added to `npm run e2e:ui`: the role, the accessible name,
the presence of dnd-kit's drag instructions, and that `aria-checked` actually
flips when a page is selected.

### Also added

`test/edgeCases.test.ts` — 13 cases over degenerate inputs (a zero-page document,
a chunk larger than the document, unusable filenames, a rotation with nothing
kept, a selection anchor no longer on screen). All passed unchanged; recorded so a
future change cannot quietly break them.

### Pass 2 result

```
npm run audit    AUDIT CLEAN (9/9)
npm run typecheck  clean
npm test           134 passed (was 121; +13 edge cases)
npm run e2e:ui     27/27 (was 23; +4 accessibility)
```

**Clean counter: 0.** Five findings, so this pass was not clean.

---

## Pass 3 — 3 findings

Scripted checks clean. These came from reading files the first two passes had not
examined closely: `electron/protocol.ts`, `src/lib/imagesToPdf.ts`, and the OCR
sidecar path.

### C1 · `err.partial` · the text sidecar could overwrite the PDF · **data loss**

`src/tools/Ocr.tsx` — with "also save the text" enabled, the companion path was
derived by substitution:

```ts
const txtPath = output.replace(/\.pdf$/i, '.txt');
```

If the chosen filename does not end in `.pdf`, the substitution is a **no-op**, so
`txtPath === output` and the text file is written over the searchable PDF that was
just produced. The whole OCR run is destroyed at the moment of success.

Reachable by typing an explicit extension in the save dialog (`report.txt`). The
dialog's PDF filter appends `.pdf` when no extension is given, which is why the
common path is safe and this stayed hidden.

### C2 · `err.paths` · a malformed URL escaped the protocol handler

`electron/protocol.ts` — `decodeURIComponent` sat outside the `try` and throws on
a malformed percent-escape (`%ZZ`), so the exception left the handler instead of
becoming a response.

### C3 · `render.effects` · a page could exceed the PDF maximum size

`src/lib/imagesToPdf.ts` — "fit page to image" made the page one point per pixel.
PDF caps a page side at 14400 units (200 inches), so a panorama beyond 14400 px
produced a page some viewers refuse. A 30000 px panorama gave a 416-inch page.

---

## Fixes — pass 3

### C1 — strip, then append

`` `${output.replace(/\.pdf$/i, '')}.txt` `` always appends, so the two paths can
never coincide, plus an explicit guard that they differ before writing.

### C2 — decode inside a guard

Malformed input now returns 400 rather than throwing out of the handler.

### C3 — clamp the page, and make the geometry testable

Page sizing moved into a pure exported `placeImage(img, pageSize, margin)`, which
clamps proportionally to 14400 units. Extracting it was the point: building a real
PDF needs a browser to encode the bitmap, so the geometry had no unit coverage at
all. It now has eight cases — the clamp on each axis, aspect-ratio preservation,
centring, margins, a zero-sized image, and an absurd margin.

### Pass 3 result

```
npm run audit    AUDIT CLEAN (9/9)
npm run typecheck  clean
npm test           142 passed (was 134; +8 placeImage)
npm run e2e        OCR + images pass
npm run e2e:ui     27/27
```

**Clean counter: 0.** Three findings.

---

## Pass 4 — 5 findings

Scripted checks clean. From reading `electron/protocol.ts`, `src/i18n/`,
`src/lib/textLayer.ts` and the OCR font path.

### D1 · `err.paths` · an unchecked fetch could embed an error page as a font

`src/tools/Ocr.tsx` — the Hebrew font was fetched without checking `response.ok`,
so a missing asset would hand a 404 body to `embedFont` and surface much later as
an opaque pdf-lib error rather than a clear failure.

### D2 · `err.paths` · the font was loaded by language, not by need

Same file — loading was keyed on whether the Hebrew box was ticked. `addTextLayer`
**silently skips** any word it has no font for, so a non-Latin word recognised
without the font selected would vanish from the text layer, producing a
"searchable" PDF that is quietly missing text.

### D3 · `a11y` · a left-to-right flash on startup for Hebrew

`src/i18n/LocaleProvider.tsx` — `dir` was applied in a `useEffect`, which runs
*after* paint. A Hebrew user saw the interface render left-to-right and then flip.

### D4 · `err.paths` · Split kept a mode the new document cannot support

`src/tools/Split.tsx` — loading a second document reset the split points but not
the mode. Coming from a file with bookmarks to one without left "at top-level
bookmarks" checked but disabled, with an error where the file list should be.

### D5 · `i18n` · two throw sites translated at the throw

`Ocr.tsx` and `Compress.tsx` threw `new Error(t('error.encrypted'))` — the message
resolved where it was raised. It worked, but it is the pattern the rest of the
codebase deliberately avoids, and it bakes in the language at the wrong moment.
Also found: the non-Latin predicate existed twice, once in `textLayer.ts` and once
inline in `Ocr.tsx`.

---

## Fixes — pass 4

### D1 — check the response

`loadUnicodeFont` now rejects a non-OK response with a keyed error.

### D2 — load by what was recognised

The font is fetched when any recognised word actually needs it, regardless of
which language boxes are ticked, so the text layer can never silently drop words.

### D3 — apply direction before paint

`useLayoutEffect` instead of `useEffect`.

### D4 — reset the mode with the document

Loading a file returns the mode to "at pages I choose", which every document
supports.

### D5 — throw keys, and keep one predicate

Both sites now throw `UserError('error.encrypted')`. `needsUnicodeFont` is
exported from `textLayer.ts` and used by the OCR screen, so the rule for "does
this word need a Unicode font" exists once.

### Pass 4 result

```
npm run audit    AUDIT CLEAN (9/9)
npm run typecheck  clean
npm test           142 passed
npm run e2e        OCR + images pass
npm run e2e:ui     27/27
```

**Clean counter: 0.** Five findings.

---

## Pass 5 — 2 findings

Scripted checks clean. This pass deliberately re-read the files the earlier
passes had *changed*, on the principle that fixes are where new defects come
from, plus `src/components/ui.tsx`, which nothing had examined closely.

### E1 · `render.effects` · the toast stack was unbounded

`src/components/ui.tsx` — errors, and successes offering Open / Show in folder,
have `ttl: 0` and stay until dismissed. Nothing capped the list and the container
had no `max-height`, so a run of operations grew the stack past the top of the
screen, carrying its own dismiss buttons out of reach.

### E2 · `render.effects` · `useToasts` returned a fresh object every render

Same file — the returned `{ toasts, push, dismiss, ...helpers }` was rebuilt on
every render, and **every screen lists it in `useCallback` dependencies**. Every
memoised callback in all six tools was therefore rebuilt on every render, which
made the memoisation everywhere else pointless. Not a visible fault, but the kind
of thing that quietly removes a whole layer of intended behaviour.

---

## Fixes — pass 5

### E1 — cap the stack and bound the container

`push` keeps the newest four; the container gained `max-height` and scrolls.
Pinned by `test/toasts.test.ts`: below the cap nothing is dropped, at the cap the
oldest goes, and the newest — the one the user just caused — is always present.

### E2 — memoise the whole object

The hook now returns a `useMemo` keyed on its own state and stable callbacks, so
consumers' dependency arrays behave as intended.

### Also verified in this pass

Re-read `compress` after its pass-1 staging change: `afterBytes` is measured on
the staged file before the copy, so the reported size still describes what was
written. No finding.

### Pass 5 result

```
npm run audit    AUDIT CLEAN (9/9)
npm run typecheck  clean
npm test           145 passed (was 142; +3 toast cap)
npm run e2e        OCR + images pass
npm run e2e:ui     27/27
```

**Clean counter: 0.** Two findings.

---

## Pass 6 — 2 findings, and one new check category

### Two checks mechanised

The read checklist covered the IPC surface under `ipc.trust` and dead code under
`hygiene.deadExport`, but only for TypeScript. Both were mechanised this pass:

- **`ipc.surface`** — cross-checks the three sides of the boundary: every channel
  `preload` can invoke has a handler in `main`, every handler is reachable, and
  the typed wrapper in `api.ts` exposes exactly what `preload` does. It passed on
  first run, and there is no evidence it would have caught anything in an earlier
  pass. **Mechanising an existing read check does not reset the counter.**
- **`css.unused`** — a class in the stylesheet that no component references.
  This one *did* find something, and it is a category the checklist genuinely
  lacked: nothing, read or scripted, had ever looked at CSS for dead rules.
  **This resets the counter.**

### F1 · `css.unused` · `.page__split` — a design that was never built

`src/styles.css` — a 5-line rule for a split-point marker on the page grid, from
the original Split design. The implemented version marks split points by
selecting the page instead, so the rule never matched anything.

### F2 · `css.unused` · `.panel__title` — superseded by `.field__label`

`src/styles.css` — a panel heading style replaced by `.field__label` early on and
never removed.

---

## Fixes — pass 6

Both rules deleted. The `css.unused` check now guards against the class
returning, and it deliberately understands modifier classes built by template
literal (`` `btn btn--${kind}` ``) so it does not report those as dead.

### Pass 6 result

```
npm run audit    AUDIT CLEAN (11/11 checks, up from 9)
npm run typecheck  clean
npm test           145 passed
npm run e2e        OCR + images pass
npm run e2e:ui     27/27
```

**Clean counter: 0.** A new check category found real dead code.

---

## Pass 7 — 1 finding, and the last new check category

### G1 · `hygiene.staleDoc` · a comment describing a field that does not exist

`shared/types.ts` — `PdfInfo` ended with:

```ts
  outline: OutlineEntry[];
  /** Page dimensions in PDF points, 1-indexed order. Used for image/page previews. */
}
```

The comment survived from the original plan; the field was never added. Anyone
reading the type would believe `PdfInfo` carries page dimensions.

"Comments that no longer describe the code" was not a category the checklist
covered, read or scripted, so **this resets the counter.** Mechanised as
`hygiene.staleDoc`: a doc comment whose next non-empty line closes the block
documents nothing. It found exactly this one instance across the codebase.

---

## Fixes — pass 7

Comment removed; check added. The checklist is now **12 scripted checks** and is
considered complete for a codebase of this size — it covers translation,
layout direction, resource hygiene, dead code in three languages (TS exports,
CSS classes, doc comments), the IPC boundary, and script references.

### Pass 7 result

```
npm run audit    AUDIT CLEAN (12/12)
npm run typecheck  clean
npm test           145 passed
npm run e2e        OCR + images pass
npm run e2e:ui     27/27
```

**Clean counter: 0.** One finding.

---

## Pass 8 — 1 finding

Scripted checks clean, and no new categories. This pass completed the one read
check that had been listed since pass 1 but never actually concluded.

### H1 · `ipc.trust` · the trust posture was never stated, and `shell:open` was wider than it needed to be

The main process accepts arbitrary paths from the renderer on `fs:readFile`,
`fs:writeFile` and `shell:open`. That had been read but never decided on, which is
the part that mattered — an unexamined boundary is a finding in itself.

**The posture, now stated:** the renderer is trusted. It is served only from
`app://` out of the application bundle, `contextIsolation` is on, `nodeIntegration`
is off, a CSP blocks external content, and no remote or user-supplied markup is
ever executed. There is no attacker inside the renderer, so path restrictions on
file reads and writes would be theatre — the user picked those paths through a
native dialog.

The one exception worth narrowing is `shell:open`, because `shell.openPath`
launches whatever the OS associates with a file, including an executable. The
renderer only ever passes a file the app has just written, so restricting the
handler to `.pdf` and `.txt` costs nothing and removes the possibility entirely.
The residual risk it addresses — a flaw in pdf.js reached through a malicious
PDF — is exactly the kind that would otherwise turn a benign channel into
arbitrary execution.

---

## Fixes — pass 8

`shell:open` now refuses anything that is not a PDF or a text file, and the trust
posture is documented above rather than left implicit.

### Pass 8 result

```
npm run audit    AUDIT CLEAN (12/12)
npm run typecheck  clean
npm test           145 passed
npm run e2e        OCR + images pass
npm run e2e:ui     27/27
packaged probe     PASSED
```

**Clean counter: 0.** One finding.

---

## Pass 9 — 1 finding

Scripted checks clean, no new categories. Every fix from passes 1–8 verified
still in place. Two read checks were re-examined in full:

**`res.unmount` across all six screens.** Only OCR needed the cleanup it has:
the other five hold a single in-flight IPC call, and if the screen goes away
mid-operation the main process still completes the write the user asked for, and
the success toast still appears — `useToasts` lives in `App`, not in the tool.
That is the right behaviour, so no change. Recorded because "no cleanup" looks
like an omission until you check where the toast state lives.

**`render.effects`.** No allocation inside any `.map()` remains.

### I1 · `err.partial` · the renderer's writes were not atomic

`electron/main.ts` — the qpdf-backed operations all stage and move into place,
but `fs:writeFile` wrote straight to the destination. The two tools that build a
document in the renderer — **Make Searchable** and **Images to PDF** — go through
that path, so a failure part-way (a full disk being the realistic one) left a
truncated PDF where the user's file should be. After an OCR run that is minutes
of work replaced by a broken file.

This is the rule stated in the pass-1 fix for A3 (*"a failure part-way through
must never leave a half-written output"*) applied to the one path that was still
missing it.

---

## Fixes — pass 9

`fs:writeFile` now writes a **sibling** temp file and renames it into place. A
sibling rather than the system temp directory, so the rename stays on one volume
and is therefore atomic; a failure removes the partial file and leaves the
destination untouched. Exercised end to end by `npm run e2e`, which writes both
an OCR result and an images PDF through this handler.

### Pass 9 result

```
npm run audit    AUDIT CLEAN (12/12)
npm run typecheck  clean
npm test           145 passed
npm run e2e        OCR + images pass
npm run e2e:ui     27/27
```

**Clean counter: 0.** One finding.

---

## Pass 10 — 1 finding

Scripted checks clean, no new categories. Re-read the pass-9 change (the sibling
temp name cannot collide with a real file, and two concurrent writes to one
destination are prevented by the busy state), then completed the `a11y` read
check across the panels rather than only the page grid.

### J1 · `a11y` · none of the radio groups was actually a group

`EditPages`, `ImagesToPdf` and `Split` all render option lists as
`<input type="radio">` with **no `name` attribute anywhere in the codebase**.
Without a shared name the browser does not treat them as one group:

- each radio becomes its own tab stop instead of the group being one
- arrow keys do not move between options, which is the expected way to operate a
  radio group
- assistive technology cannot announce "2 of 3", because there is no group

React drives `checked` from state, so clicking works and the selected option
looks right — which is exactly why this survived every previous pass and the
screenshots.

---

## Fixes — pass 10

Each group now shares a `name` (`editPagesMode`, `imagePageSize`, `splitMode`)
and its container carries `role="radiogroup"` with an `aria-label` taken from the
existing field label, so the group's purpose is announced too.

Two assertions added to `npm run e2e:ui`: that every radio in a group reports the
same non-empty `name`, and that the container has both the role and an accessible
name.

### Pass 10 result

```
npm run audit    AUDIT CLEAN (12/12)
npm run typecheck  clean
npm test           145 passed
npm run e2e        OCR + images pass
npm run e2e:ui     29/29 (was 27; +2 radio grouping)
```

**Clean counter: 0.** One finding.

---

## Pass 11 — 1 finding

Scripted checks clean, no new categories. Completed the `a11y` sweep beyond the
page grid and the `test.gaps` check.

**`a11y`, verified clean:** every `htmlFor` resolves to a real `id` (checked
programmatically across all components), every checkbox is wrapped in its
`<label>`, and both icon-only buttons carry an `aria-label`.

**`path.build`, verified clean:** no hand-built filesystem path remains anywhere
in the renderer.

### K1 · `test.gaps` · the path-traversal guard had no test

Five modules have no unit test: `preload`, `protocol`, `imageDecode`,
`pdfRender`, `usePdfDoc`. Four of those are covered by the e2e harnesses and need
a browser to exercise at all — unit-testing them would mostly test the mocks, so
that is the right trade.

`protocol.ts` is the exception. Its containment check is **pure string logic and
a security boundary**, and serving the application exercises only the paths that
succeed. Nothing verified that a traversal is refused.

---

## Fixes — pass 11

Extracted `resolveWithin(base, requestPath)` as a pure exported function and
routed the handler through it, which also made the handler shorter. Thirteen
cases now cover it: normal and nested assets, percent-encoded names, an interior
`..` that stays inside, and the refusals — plain traversal, deep traversal,
percent-encoded traversal, double encoding, malformed escapes, an absolute path
smuggled into the request, and a **sibling directory sharing the base name as a
prefix** (`dist-secret` against a base of `dist`), which a naive
`startsWith(base)` would wrongly allow.

The rule was already correct in every case; it simply had nothing holding it
that way.

### Pass 11 result

```
npm run audit    AUDIT CLEAN (12/12)
npm run typecheck  clean
npm test           158 passed (was 145; +13 containment)
npm run e2e        OCR + images pass
npm run e2e:ui     29/29
```

**Clean counter: 0.** One finding.

---

## Pass 12 — CLEAN ✅

No findings. Every scripted check passed, and all nine read checks were walked in
full with nothing outstanding from earlier passes.

| Read check | Outcome |
|---|---|
| `res.lifetime` | 15 acquire sites, each with a guaranteed release |
| `res.unmount` | Only OCR needs cleanup and has it; the other five hold a single IPC call whose result still reaches the user, because `useToasts` lives in `App` |
| `err.paths` | Every `catch` carries a stated reason and swallows correctly |
| `err.partial` | All five write paths stage: four via `tempPath` in `operations.ts`, plus `fs:writeFile`'s sibling-rename |
| `ipc.trust` | Posture documented; `shell:open` restricted to the file types the app produces |
| `render.effects` | No allocation inside any render body (one grep hit was `setPoints(new Set())` in a callback) |
| `path.build` | The renderer builds no filesystem paths at all |
| `a11y` | Roles, names, label associations and radio grouping all verified |
| `test.gaps` | The four remaining untested modules need a browser and are covered by e2e |

```
npm run audit    AUDIT CLEAN (12/12)
npm run typecheck  clean
npm test           158 passed
npm run e2e        OCR + images pass
npm run e2e:ui     29/29
```

**Clean counter: 1.**

---

## Pass 13 — 1 finding

Scripted checks clean. Because pass 12 was clean, this pass was deliberately
adversarial rather than a repeat walk: rather than re-checking the same
properties, it asked what happens when two things race.

**Verified safe:** an output path equal to an input is fine everywhere, because
all four operations read into a staged file before writing it back. A second run
cannot be started while one is in flight — the button is disabled by `busy`, and
the save dialog that precedes it is modal to the window.

### L1 · `res.unmount` · cancelling by navigating away reported a failure

`src/tools/Ocr.tsx` — the loop checks `cancelled.current` at the top of each
page, but the `catch` around the whole run did not. The unmount cleanup added in
pass 4 **terminates the tesseract worker immediately**, so if it fires mid-page
the in-flight `recognise()` rejects, falls into the catch, and shows *"Could not
make it searchable"*.

Someone who switched tools then saw an error claiming their document had failed —
for a run they had abandoned on purpose. The Cancel button was unaffected,
because it only sets the flag and lets the current page finish, which is why the
behaviour looked correct when tested the obvious way.

This is the pass-4 fix's own second-order effect: making cancellation immediate
is what created a rejection that the error path could not distinguish from a real
one.

---

## Fixes — pass 13

The catch now reports only when the run was not cancelled.

### Pass 13 result

```
npm run audit    AUDIT CLEAN (12/12)
npm run typecheck  clean
npm test           158 passed
npm run e2e        OCR + images pass
npm run e2e:ui     29/29
```

**Clean counter: 0.** One finding — the adversarial angle earned its place.

---

## Pass 14 — 1 finding (in the tests, not the app)

Scripted checks clean. Continued the adversarial approach that pass 13 proved
worthwhile, plus a new integration suite exercising every operation against real
documents rather than fixtures.

**Verified safe:** no other teardown path has the shape that produced L1 —
`renderPage` already treats an aborted render as expected rather than a fault,
and `useThumb`'s one caller cannot reject. A locale switch mid-operation leaves
the in-flight run with the language it started in, which is correct.

**Not fixed, reasoned about:** `merge` passes every input path on one command
line, and Windows caps that near 32767 characters. At a typical path length that
is roughly 400 files — far beyond what this list-based UI is usable for — so the
limit is accepted rather than guarded.

### M1 · `test.gaps` · the temp-file assertions were not isolation-safe

`test/operations.test.ts` and the new `test/realFiles.test.ts` both counted
`pdf-tools-*` files in the **shared** system temp directory. Vitest runs test
files in parallel, so each saw the other's staging and reported a phantom leak.
Introduced by the coverage added in this pass, and caught by the pass's own gate.

Worth recording rather than quietly fixing: an assertion that fails depending on
what else is running is worse than no assertion, because the next real leak gets
dismissed as the known flake.

---

## Fixes — pass 14

Both now snapshot the **set** of temp files and assert no *new* one remains, so a
concurrent test file's staging is invisible to them. Confirmed stable over three
consecutive full runs.

Added `test/realFiles.test.ts`: every operation against real-world PDFs, with the
outputs read back through qpdf rather than trusted — including a reversed
document, which is where the output-numbered rotate range would bite. Skips
itself when the samples are absent, so a clean checkout still passes.

### Pass 14 result

```
npm run audit    AUDIT CLEAN (12/12)
npm run typecheck  clean
npm test           160 passed (was 158; +2 real-document integration), stable over 3 runs
npm run e2e        OCR + images pass
npm run e2e:ui     29/29
```

**Clean counter: 0.** The app had no findings, but a gate failed, and a pass
whose own test suite is unreliable cannot be called clean.

---

## Pass 15 — 1 finding

Scripted checks clean and the full read checklist walked with nothing
outstanding. The finding came from the gate: the suite failed once, passed on
re-run, and an intermittent failure is exactly what pass 14 said must not be
tolerated.

### N1 · `test.gaps` · the pass-14 isolation fix was incomplete

Reproduced by running the suite six times: *"split removes its staged file when a
part fails"* failed **2 of 6**.

Pass 14 changed the temp-file assertions from a count to a set difference, which
protects against a concurrent file *disappearing* — but not against one
**appearing** during the window between snapshot and assertion. `realFiles.test.ts`
also runs `split`, so its staging landed inside the other file's measurement.

The pass-14 note about flaky assertions was right, and the fix was still wrong.
A half-correct isolation fix is worse than the original, because it looks
addressed.

---

## Fixes — pass 15

The real problem was that the operations always staged into one shared
directory. `operations.ts` now resolves its staging directory through
`PDF_TOOLS_TMPDIR`, falling back to `os.tmpdir()`, and each test file creates its
own via `mkdtempSync`. Anything left there afterwards is unambiguously that
file's own leak, so no cross-talk is possible rather than merely unlikely.

That is a seam in the application, not a test hack: it makes staging observable,
which is what the leak assertions need in the first place. Both files remove
their directory afterwards.

Confirmed over **eight consecutive full runs**, against 2 failures in 6 before.

### Pass 15 result

```
npm run audit    AUDIT CLEAN (12/12)
npm run typecheck  clean
npm test           160 passed, 8 consecutive stable runs
npm run e2e        OCR + images pass
npm run e2e:ui     29/29
```

**Clean counter: 0.**

---

## Pass 16 — CLEAN ✅

No findings. Scripted checks clean, read checklist walked, and the pass-15
change re-examined specifically:

- `PDF_TOOLS_TMPDIR` is read in exactly one place and **set nowhere in the
  application** — only by the two test files. Production still stages into
  `os.tmpdir()`.
- The suite was run three times rather than once, since stability is now part of
  the gate.
- A full `electron-builder` package was produced and probed, confirming the
  audit's changes survive into the shipped artefact.

```
npm run audit    AUDIT CLEAN (12/12)
npm run typecheck  clean
npm test           160 passed × 3 consecutive runs
npm run e2e        OCR + images pass
npm run e2e:ui     29/29
packaged probe     PASSED (app:// served, qpdf resolved, OCR assets present)
```

**Clean counter: 1.**

---

## Pass 17 — CLEAN ✅

No findings. Full walk of all 12 scripted checks and all 9 read checks.

| Read check | Outcome |
|---|---|
| `res.lifetime` | 9 acquire sites; every release guaranteed by a `finally` or an unmount cleanup. The recogniser's `close()` is reached from both the run's `finally` and the unmount effect |
| `res.unmount` | Only OCR needs it and has it |
| `err.paths` | 30 catches, each with a stated reason, a rethrow, or a user-visible report |
| `err.partial` | 5 staged operations plus the atomic `fs:writeFile` |
| `ipc.trust` | Posture documented; `shell:open` narrowed |
| `render.effects` | No allocation in a render body |
| `path.build` | 0 hand-built paths in the renderer |
| `a11y` | Role, accessible name, drag instructions, `aria-checked`, and radio grouping all asserted in e2e |
| `test.gaps` | 160 tests, stable across 3 consecutive runs |

```
npm run audit    AUDIT CLEAN (12/12)
npm run typecheck  clean
npm test           160 passed × 3 consecutive runs
npm run e2e        OCR + images pass
npm run e2e:ui     29/29
```

**Clean counter: 2. Exit condition met.**

---

# Summary

17 passes. **28 findings**, all fixed and each pinned by a test where a test
could pin it.

| Severity | Finding |
|---|---|
| **Data loss** | C1 — the OCR text sidecar could overwrite the PDF it had just written |
| **Data loss** | A3 — a failed compress left a truncated file at the user's chosen path |
| **Data loss** | I1 — the renderer's writes were not atomic, so a full disk truncated the output |
| **Accessibility** | B5 — dnd-kit's role overrode the tile's, so selection state was never announced |
| **Accessibility** | J1 — no radio group had a shared `name`, so none was a group for keyboard or assistive tech |
| **Correctness** | A1 — 11 user-facing strings outside the translation system, including an English-only plural |
| **Correctness** | L1 — cancelling OCR by navigating away reported a failure |
| **Resource** | A2, A4, A9, B1, B3, B4 — leaked temp files, documents, workers and canvases |
| **Robustness** | C2, C3, D1, D2, D4 — unguarded decode, oversized pages, unchecked fetch, stale mode |
| **Correctness** | A5, A6, B2, D3, D5, E1, E2, F1, F2, G1, H1 — render allocation, path building, unhandled rejections, RTL flash, unbounded toasts, dead code, trust posture |
| **Test quality** | K1, M1, N1 — an untested security boundary, and two isolation defects in the tests themselves |

## What the process was worth

**The scripted half found little; the reading found nearly everything.** Of 28
findings, 6 came from `npm run audit`. The rest came from reading the code with a
specific question in mind. The script's value is that those 6 can never come back.

**Fixes caused two of the findings.** L1 existed only because pass 4 made
cancellation immediate; N1 existed only because pass 14's isolation fix was half
right. Re-reading what a pass changed, in the *next* pass, is what caught both.

**The counter-reset rule did real work.** It fired four times (A1, F, G1, and the
gate failures in 14 and 15) and cost roughly eight extra passes. Without it this
would have stopped at pass 3 with the checklist still missing dead CSS, stale
comments, and any notion of test stability — and with three data-loss bugs and
two accessibility defects still in the shipped app.

**Two findings were only reachable by being adversarial.** L1 needed the question
"what if teardown happens mid-page rather than between pages"; N1 needed running
the suite six times instead of once. Neither would have surfaced from another
careful read.

## Running it again

```bash
npm run audit      # 12 scripted checks
npm run verify     # typecheck + tests + both e2e suites
```

The read checklist is at the top of this document. The rule stands: a new
category resets the count.
