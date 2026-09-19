# Step 0 — Spike findings

Run against **qpdf 12.4.1** (msvc64) and **pdf-lib 1.17.1** on Windows 11.
Reproduce with `node scripts/make-fixtures.mjs`, then `scripts/spike-roundtrip.mjs` / `scripts/spike-real.mjs`.

**Verdict: every assumption in the plan held. No design changes needed; two simplifications unlocked.**

---

## Q3 — Does `--pages` preserve outlines and form fields? ✅ Yes

`qpdf outlined-form.pdf --pages . 1-3,7 -- extract.pdf` (10 pages → 4):

| | result |
|---|---|
| Pages | 4 ✅ |
| AcroForm | preserved, field `spike.name` intact ✅ |
| Outline tree | fully preserved, nesting and all ✅ |
| Bookmarks → kept pages | resolve correctly (p1, p2) ✅ |
| Bookmarks → dropped pages | survive as **dead entries** — as documented |

Confirmed on a real-world 15-page Hebrew PDF with a genuine 8-entry outline: keeping pages 1–8 preserved all 8 bookmarks, 6 of them dead.

## Q4 — Real `--json` top-level keys

```
version · parameters · pages · pagelabels · acroform · attachments · encrypt · outlines
```

`acroform` **does** exist (the plan flagged it as uncertain). Everything `inspect` needs comes from **one** `qpdf --json` call:

- `acroform.hasacroform` → form advisory
- `encrypt.encrypted` → password detection
- `pages.length` → page count
- `outlines[]` → outline list

## Q5 — Page number per bookmark? ✅ Yes, directly

`outlines[]` entries carry **`destpageposfrom1`** — a resolved 1-indexed page number.

```json
{ "title": "Chapter One", "destpageposfrom1": 1, "kids": [...], "open": true }
```

**No manual `/Dest` or `/Names` resolution is needed.** This eliminates plan **Open Risk #3** entirely and makes split-at-bookmarks straightforward.

Bonus: `destpageposfrom1` is `null` exactly when a bookmark points at a dropped page. That lets the Edit Pages advisory be *specific* — "3 of 8 bookmarks point to pages you're removing" — instead of generic.

## Q6 — `--rotate` + `--pages` composition ⚠️ The one trap

Both compose in a **single invocation**, in either argument order. But:

> **`--rotate` page ranges refer to OUTPUT numbering, not input.**

Proof — selecting `6-10` from a 10-page doc and rotating `:1` rotated the **first page of the result** (originally input page 6):

| command | rotated |
|---|---|
| `--pages . 1-5 -- --rotate=+90:2` | output p2 |
| `--rotate=+90:2 --pages . 1-5 --` | output p2 (identical) |
| `--pages . 6-10 -- --rotate=+90:1` | **output p1** (= input p6) |

**Implication for Step 5:** the UI grid shows *input* page numbers, so rotation targets must be **remapped through the selection** before building qpdf args. Getting this backwards silently rotates the wrong pages — and would never surface in a test that selects all pages. Needs a unit test with a non-identity selection.

## Q7 — pdf-lib round-trip damage? ✅ None

Load + `save({ updateFieldAppearances: false })`, untouched:

| input | pages | form | outlines | result |
|---|---|---|---|---|
| synthetic outlined+form | 10 | ✅ 1 field | ✅ 3+2 nested | OK |
| synthetic plain | 10 | — | — | OK |
| **qpdf output** of real Hebrew doc | 8 | — | ✅ 8 | OK |
| **qpdf output** of real form PDF | 1 | ✅ 1 field | — | OK |
| 3 other real-world PDFs | | | | OK |

Critically tested against **qpdf's own output** (object streams + compressed xref), which is exactly the Step 6 merge pipeline — not just pdf-lib reading its own writing.

→ **Plan Open Risk #1 is closed.** The merge outline post-pass is viable.

## Merge behaviour — confirmed as designed

`qpdf A.pdf --pages . B.pdf C.pdf -- merged.pdf` (10+3+2):
- 15 pages ✅
- A's AcroForm and full nested outline tree preserved with correct page numbers ✅
- **Secondary files' outlines are definitively dropped** — merging a no-outline primary with a 15-page 8-bookmark secondary yielded **0** outlines.

This confirms the premise behind the generated-bookmark design.

## Incidental findings

- **Writing an `/Outlines` tree by hand in pdf-lib works**, including nesting and Hebrew titles via `PDFHexString.fromText` (UTF-16BE). `scripts/make-fixtures.mjs` contains a working implementation to lift for Step 6.
- **`execFileSync` handles non-ASCII paths with spaces** — verified with `01 סדרי גודל ולמה פיזיקה.pdf`.
- **Never verify PDF structure with `grep`.** A byte-grep for `/Rotate` returned empty even on correctly rotated files, because qpdf writes page dicts inside compressed object streams. Nearly produced a false "rotation is broken" report. Always parse.
- **The msvc64 zip bundles its own MSVC runtime** (`msvcp140.dll`, `vcruntime140*.dll`, `concrt140.dll`), so there is no VC++ Redistributable dependency — provided the whole set ships together. Vendored: 8.8 MB.

---

# OCR spike findings

Run before building the "Make Searchable" feature. Reproduce with
`scripts/spike-ocr-text.mjs` and `scripts/spike-tesseract.mjs`.

## Invisible text layer: does it round-trip? ✅ Yes, with subsetting

Built a PDF with words drawn in **text render mode 3** (invisible), then read the
text back with pdf.js — the only honest check, because a broken text layer
produces a file that renders perfectly and simply never matches a search.

| | subset: true | subset: false |
|---|---|---|
| Page size | **4.9 KB** | 15.8 KB |
| Latin round-trip | ✅ all 5 words | ✅ |
| Hebrew round-trip | ✅ all 5 words | ✅ |

**pdf-lib's font subsetting generates a correct `ToUnicode` CMap**, including for
Hebrew. `subset: true` is used, at a third of the size.

**Two fonts, chosen per word.** Latin words use Helvetica — a standard-14 font,
so zero embedded bytes and WinAnsi maps back cleanly. Only non-Latin words pull
in Noto Sans Hebrew (OFL, 27 KB), and only if such a word actually appears.

Mechanics that work: `page.node.newFontDictionary(name, font.ref)` to register a
font for raw operators, `setTextRenderingMode(TextRenderingMode.Invisible)`, and
`PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(pct)])`
for `Tz` (pdf-lib has no named helper for that one).

## tesseract.js 7 output shape ⚠️ Not what the docs suggest

> **`data.words` does not exist.** It is `undefined`/empty.

Word boxes are nested under `data.blocks[].paragraphs[].lines[].words[]`, and
appear **only** when `{ blocks: true }` is passed as the third argument to
`recognize()`. Designing against `data.words` — the shape most examples show —
yields zero words and a silently empty text layer.

Word objects carry `bbox: {x0, y0, x1, y1}`, `text`, `confidence`, `symbols`.

Verified on a mixed test image: English and Hebrew both recognised correctly with
`eng+heb` loaded together, at 95–96% confidence.

## Offline operation

`langPath` pointing at a local directory with `gzip: true` loads the vendored
`.traineddata.gz` with **no network access**. Language data is not in
`node_modules` — it is downloaded once into `vendor/tessdata/` and staged into
the build by `scripts/copy-assets.mjs`.

**Core variants:** tesseract feature-detects relaxed-SIMD, then SIMD, then plain,
and appends `-lstm` when the worker uses OEM 1. We always use OEM 1, so only the
three `-lstm` cores can ever load — shipping the other three added ~24 MB that
would never be read. `copy-assets.mjs` filters them out (44 MB → 20 MB).

## The production-only bug this uncovered

Serving the renderer with `loadFile` puts it on a `file://` origin, and
**Chromium blocks `fetch()` against `file://`**. That would have broken the
tesseract worker, its WASM core, the language data, *and* pdf.js's cmaps and
standard fonts — but **only in the packaged build**, since the dev server hands
them over plain HTTP.

Fixed by serving the renderer over a custom `app://` scheme registered as
`standard + secure + supportFetchAPI` (`electron/protocol.ts`). Verified in a
real packaged build by `scripts/probe-assets.mjs`, which fetches every runtime
asset through the renderer and reports its byte count.

---

# Bookmark pruning

Added after the first release, when leaving dead bookmarks in the list
turned out to be the wrong default.

## The shape of the problem

qpdf copies the outline tree **in its entirety** from the primary input, so
after a page selection a bookmark whose target page is gone survives as an
entry that simply does nothing when clicked. `qpdf --json` reports these
with `destpageposfrom1: null`, which is what makes them findable.

The naive fix — delete every node whose destination is dead — is wrong.
Verified against `outlined-form.pdf` keeing pages 2 and 8:

```
'Chapter One'    DEAD    <- its page 1 was dropped
  'Section 1.1'  p1      <- but this child survived
  'Section 1.2'  DEAD
'Chapter Two'    DEAD
'פרק שלוש'       p2
```

Deleting "Chapter One" would orphan "Section 1.1", a section still in the
document. So a node is kept when **anything in its subtree** survived, and
is then retargeted to its first surviving descendant.

## Implementation note

The tree is read through `qpdf --json` and pruned by **object number** in
pdf-lib, rather than resolving destinations in pdf-lib directly. qpdf has
already resolved every `/Dest`, including named destinations reached through
the `/Names` tree, so this avoids re-implementing that resolution — the
same reason split-at-bookmarks was cheap (see Q5 above).

`/Count` on a surviving node keps its **sign** (which encodes open/closed
state) while the magnitude is recomputed for the pruned tree. When nothing
survives at all, `/Outlines` is removed from the catalog rather than left
as an empty panel.

## Verified against

- `test/pruneOutline.test.ts` — the orphan case, full-tree survival,
  a total wipe-out, form fields untouched, and per-piece pruning on split
- `test/realPdf.test.ts` — a real 15-page document with a genuine
  8-entry nested outline; keeping pages 1–8 left the two live bookmarks
  intact and removed the p10/p13/p14 subtrees whole, leaving no orphans.

---

# Page reordering

## Bookmarks follow reordered pages for free

PDF destinations reference page **objects** by indirect reference, not by page
index, so physically moving a page carries every bookmark pointing at it.
Verified with `qpdf outlined-form.pdf --pages . 8,1-7,9-10 --`:

| bookmark | before | after |
|---|---|---|
| `פרק שלוש` | p8 | **p1** |
| `Chapter One` | p1 | p2 |
| `Chapter Two` | p6 | p7 |

No fix-up code was needed for destinations. `formatRanges` already preserved
order (it was written that way and tested with `[3,1,2] -> "3,1-2"`), and qpdf
honours a non-ascending page list as an output sequence — so reordering and
selecting turned out to be the same operation.

## What did need doing: the outline LIST order

A viewer lists bookmarks in **tree order**, not by destination. Without a
re-sort, the Hebrew chapter above sits on page 1 while still being listed last.
`pruneDeadBookmarks` gained a `sortByPage` option that re-sorts siblings at each
level by the page they now point to, preserving nesting.

It is **off by default** and only enabled when the user actually rearranged
something: an outline that was never in page order to begin with (an index
rather than a table of contents) should not be silently rewritten.

## Two UI bugs the harness caught that manual testing would not

**1. `onKeyDown` clobbered dnd-kit's.** The tile spreads `{...listeners}` and
then declares its own `onKeyDown`; later JSX props win, so dnd-kit's keyboard
sensor handler was silently replaced. Mouse dragging still worked — that arrives
via `onPointerDown` — so the feature looked fine while keyboard reordering was
dead. The handler now calls dnd-kit's through before its own.

**2. Space meant two things.** Selection was bound to Enter *and* Space, but
dnd-kit uses Space to pick a draggable up. Selection is now Enter only.

Also fixed while wiring it up: **shift-click selected by page number**, which is
wrong once the grid is rearranged — clicking tile 8 then shift-clicking tile 2
in a `8,1,2,...` grid would sweep in pages 3–7 that are nowhere near. Range
selection now works on grid positions (`src/lib/selection.ts`).

`scripts/e2e-ui.mjs` mounts the real component in a real renderer against a
stubbed IPC layer, reorders with the keyboard, and asserts that the `keep` array
reaching the main process matches what the grid displays. It also catches
mount-time crashes — a `useCallback` dependency array referencing a `const`
declared further down the component is a TDZ `ReferenceError`, which TypeScript
flagged here but which would otherwise only appear at runtime.

---

# Hebrew localization

## Hebrew has a dual form, and the old pattern could not express it

`Intl.PluralRules('he')` reports **three** categories — `one`, `two`, `other`:

```
  1 -> one     2 -> two     3 -> other     10 -> other
```

So "2 pages" is its own grammatical form (`שני עמודים`), distinct from "3 pages".
Every count in the app used `${n} page${n === 1 ? '' : 's'}`, which structurally
cannot represent that. All of them became plural entries.

`Intl.PluralRules` is built into the runtime, so no i18n library was needed —
a typed dictionary plus a ~40-line `t()` covers it, and TypeScript then enforces
translation completeness.

## Completeness is enforced by the compiler

`Strings` is declared as an explicit interface rather than inferred from `en`.
Both dictionaries must satisfy it, so a missing Hebrew key fails `npm run typecheck`
instead of silently falling back to English. 232 keys, 225 `t()` call sites.

What the compiler cannot catch is a literal someone forgot to extract, so a grep
sweep for capitalised multi-word literals is part of the process. It found none
beyond `Apache-2.0` (a licence identifier) and `Images.pdf` (a default filename,
English by decision).

## RTL was cheap because the layout was already flexbox

Only **16 physical CSS properties** in 524 lines needed converting to logical
equivalents (`border-inline-end`, `inset-inline-start`, `text-align: start`).
Everything else mirrors automatically from `dir` on `<html>` — including the page
grid, which is a CSS grid and needed no code change at all.

**Directional icons mirror; rotational ones must not.** `IconMerge` and `IconSplit`
encode reading order and flip under `[dir="rtl"]`. `IconRotate` is deliberately
excluded: clockwise is a physical direction, and mirroring it would make the button
lie about which way the page turns. The e2e suite asserts this specifically.

**`<bdi>` around every filename.** Filenames are user content whose direction is
often opposite to the UI; without isolation `report (1).pdf` renders as
`(1) report.pdf` inside a Hebrew line.

## Two bugs this work uncovered

**1. dnd-kit activates on Space AND Enter.** When selection moved off Space (to
avoid colliding with drag pickup) it landed on Enter — dnd-kit's *other* activation
key — so keyboard selection also picked the page up. Fixed with an explicit
`keyboardCodes` override restricting `start` to Space. The enum values are
`'Space'`, `'Escape'`, `'Tab'`, and dnd-kit matches on `event.code`, not `event.key`.

**2. Stale translator captures.** A `useCallback` that calls `t()` but omits `t`
from its dependency array keeps the old language after a switch. A regex sweep over
every `useCallback` found two in `Compress.tsx`. Worth re-running after any edit
that adds a callback.

**Arrow keys needed no RTL handling:** dnd-kit resolves movement from bounding
rects, so "left" is always visually left. Mirroring the grid makes it correct.

## Test isolation note

The language preference persists in `localStorage`, which is shared across e2e runs
under the same `app://` origin. A run that ended mid-Hebrew left the next run
starting in Hebrew, where the mirrored grid made `ArrowRight` a no-op at the edge —
producing three confusing failures with no obvious cause. The harness now sets the
language explicitly before the English pass.

## Screenshots

`scripts/shoot.mjs` captures the app's own viewport through the DevTools protocol
rather than grabbing the desktop, so nothing else on screen is ever recorded.

---

# qpdf-wasm (Phase 0 gate)

Run `node scripts/spike-qpdf-wasm.mjs`. Compares the WASM build against the
vendored **native qpdf 12.4.1**, on the same fixtures, reading every output back
with the native binary.

This section records the original investigation against the published
`@neslinesli93/qpdf-wasm` 0.3.0 (qpdf 12.2.0). The app no longer uses it: it now
ships `vendor/qpdf-wasm`, built from qpdf 12.4.1 sources by the recipe in
`scripts/build-qpdf-wasm.md`. Where a finding below has since been superseded,
it says so — including one whose diagnosis turned out to be wrong.

**Verdict: GATE PASSED.** Every operation produces structurally identical output on
every fixture. Four mechanical traps had to be found first, and three limitations
remain — one of which is a genuine product regression on mobile.

Coverage: `inspect`, `prune`, `editPages`, `split`, `compress` across all six
fixtures (`blank`, `plain`, `beta`, `gamma`, `scan`, `outlined-form`), plus `merge`
and both encryption cases. Comparison is pages, **per-page rotation**, AcroForm and
field count, encryption flag, outline count, dead-bookmark count and outline titles —
plus output size for `compress`.

Two things the comparison deliberately does not take from qpdf. **Rotation** comes
from pdf-lib, because `--json-key=pages` does not expose `/Rotate`, and without it
the `--rotate` case would compare equal even with the rotation dropped or applied to
the wrong page — the trap Q6 above documents. **`compress` is checked by output
size**, because structural equality would not notice a wasm build that compressed far
worse; native and wasm outputs are identical in size on all six fixtures.

**Encryption** is covered in both of its distinct shapes, since every checked-in
fixture is unencrypted and would have compared trivially equal. Owner-password-only
files are readable, and both binaries report the same `encrypt` block — that is the
path which actually exercises `--json-key=encrypt`. Files with a real user password
are refused by both with exit 2 and `invalid password`, which `errorKey()` maps to
`error.encrypted`.

## The runner contract

A plain `runQpdf(args)` does not close, because the argv *itself* names files —
`pruneDeadBookmarks` passes a path inside `['--json', '--json-key=outlines', file]`.
Both backends must stage bytes somewhere qpdf can address. The contract is a mini
filesystem:

```ts
runQpdf(
  args: string[],
  opts?: { inputs?: Record<string, Uint8Array>; outputs?: string[] },
): { exitCode: number; stdout: string; stderr: string; outputs: Record<string, Uint8Array> }
```

Electron stages to `os.tmpdir()` (as `operations.ts:102` already does); mobile stages
to MEMFS. This is what Phase 3a extracts `operations.ts` / `outline.ts` /
`pruneOutline.ts` against.

## Four traps ⚠️

**1. `callMain` mutates the array you give it.** Emscripten unshifts `argv[0]` in
place, so reusing an args array corrupts every later call — the second run reports
`unknown argument` about a path you never passed. Always pass a copy. The failure
looks nothing like its cause and cost the longest detour in this spike.

**2. The build has no `print`/`printErr` hooks.** The string `print` appears **zero**
times in `dist/qpdf.js`; output goes through `console.log`/`console.error`, which it
binds *at instantiation*. The console shim must therefore be installed **before**
`createModule()`. Patching it afterwards captures nothing — and reads exactly like
"qpdf printed nothing", which is why the first attempt concluded stdout was
uncapturable.

**3. Whichever stdout mode is used first wins, permanently.** qpdf's logger is a
process-global singleton and the WASM "process" never restarts between `callMain`
calls. A plain write (`--version` suffices) makes every later `--json` fail with
`QPDFLogger: called setSave on standard output after standard output has already
been used`; `--json-output` poisons it identically. The runner claims JSON mode at
startup with a throwaway `--json` against a nonexistent file — free, and it makes
call order irrelevant. Without it this is an ordering landmine: opening the About
screen (`app:versions`) would silently break `inspect` for the rest of the session.

Consequence: once JSON mode is claimed, `--version` output is no longer capturable,
so **`app:versions` needs its own short-lived module instance.** It is called once,
so the extra instantiation is free.

We use `--json` to stdout rather than `--json-output` to a file, even though the
latter needs no console capture: `--json-output` forces JSON v2 and always embeds
the full `qpdf` object graph — exactly the payload blow-up `--json-key` exists to
avoid — while `--json` yields the same lean envelope `operations.ts` already parses.

**4. MEMFS persists across calls.** Declared outputs must be unlinked before each
run, or a *failed* run silently hands back the previous run's output. This one
produced a convincing wrong answer: merge appeared to drop the second file's pages,
when in fact merge had failed and the reader returned a stale 10-page file.

## `--pages` needs an explicit range on 12.2.0 ⚠️

Applied to the published 12.2.0 build; the vendored 12.4.1 build does not need it.
It is kept because `1-z` is correct on both and costs nothing.

qpdf 12.4.1 defaults an omitted `--pages` range to all pages. 12.2.0 rejects it with
`invalid range syntax`, which breaks `merge`:

```
[primary, '--pages', '.', ...rest, '--', staged]          // 12.4.1 only
[primary, '--pages', '.', '1-z', ...rest.flatMap(f => [f, '1-z']), '--', staged]
```

`1-z` means "all pages" to **both** versions — verified to produce byte-identical
structure against native 12.4.1 — so writing it explicitly is the portable form and
should be adopted in `operations.ts` regardless of the mobile work.

## Damaged files were rejected, not repaired — and the diagnosis was wrong ❗→✅

The observation was right and the conclusion was not. With the published
`@neslinesli93/qpdf-wasm` (qpdf 12.2.0):

| damage | native 12.4.1 | published wasm |
|---|---|---|
| bad `startxref` offset | exit 3, repaired | exit 2, **no output** |
| `startxref` → 0 | exit 3, repaired | exit 2, **no output** |
| truncated trailer | exit 3, repaired | exit 2, **no output** |

That was read as a qpdf version difference, and it is not one. Building **12.4.1**
from source reproduced the failure exactly. The cause is a build flag:

> **Emscripten disables exception CATCHING by default**, and qpdf recovers from a
> damaged cross-reference table by *catching* the parse failure and
> reconstructing. Without `-fexceptions` on the C++ flags, that throw is fatal
> instead of triggering the repair path.

Compiling libqpdf with `-fexceptions` fixes it completely: all three cases now
exit 3 and produce byte-identical output to the native binary. `vendor/qpdf-wasm`
is built that way, and `scripts/spike-qpdf-wasm.mjs` now asserts the repair as a
requirement rather than recording its absence as a limitation.

The lesson is worth keeping: a WASM port failing where a native binary succeeds
is *more* likely to be a link-flag difference than a version difference, because
Emscripten's defaults are not a C++ toolchain's defaults. Two of the three
mechanics this file documents — no `print`/`printErr`, no exception catching —
are Emscripten defaults, not qpdf behaviour.

## Cost

| | |
|---|---|
| wasm + glue | **1.38 MB** (vs 7.46 MB for `qpdf.exe` + `qpdf30.dll`) |
| cold start | ~10 ms on desktop Node — measure again on device |

Substantially cheaper than the ~6–8 MB the plan budgeted for.

---

# Reader: annotations and form filling (Phase 2 gate)

Run `node scripts/spike-annots-forms.mjs`. Checks whether the reader can write
annotations and fill form fields with pdf-lib without destroying the structure the
app exists to protect.

**Verdict: SPIKE PASSED.** Adding a `/Highlight` and filling a field in place
preserve all five outline entries and the AcroForm, and both survive a subsequent
qpdf `--object-streams=generate` compress -- the realistic pipeline where a user
runs another tool over the reader's output.

## The README's warning does not apply here ✅

The thesis that pure-JS libraries drop `/Outlines` and `/AcroForm` is about
**copying pages between documents**, which rebuilds the document root. An in-place
load → modify → save does not, and `electron/outline.ts` has always relied on that.
Verified for this path specifically rather than assumed.

## Hebrew form values throw rather than mangle ⚠️

Setting a Hebrew value and letting `save()` regenerate appearances fails with:

```
WinAnsi cannot encode "ש" (0x05e9)
```

That is pdf-lib refusing to write mojibake, which is the right behaviour and a hard
error rather than a silent one. The consequence is a two-step dance that has to be
written deliberately:

```ts
const font = await doc.embedFont(notoSansHebrew, { subset: false });
field.setText(value);
field.updateAppearances(font);
return doc.save({ updateFieldAppearances: false });   // NOT the default
```

Leaving the save at its default would regenerate the appearance with Helvetica and
throw again, after the value was already set.

**The font is embedded unsubsetted**, unlike the OCR text layer which subsets. A
form field can be edited later in another viewer, which would then need glyphs a
subset built from today's value never contained. It costs real bytes:
3,981 → 19,587 on the fixture.

## Without an appearance stream the value is invisible

A viewer that does not render field values itself shows an empty box. The value is
in the file and reads back correctly, which makes this look like a rendering bug in
someone else's software rather than a missing `/AP`. Covered by a test.

---

# Reader: things the e2e harness caught

`npm run e2e:reader` drives the real screen in a real renderer. Three failures it
found that no unit test would have:

**1. `TextLayer.cancel()` rejects rather than resolves.** Scrolling away from a page
mid-render left an unhandled promise rejection (`AbortException: TextLayer task
cancelled`) on every single page that left the viewport. Silent in production. The
`render()` call needs its own catch, separate from the render task's abort handling.

**2. The harness must mount `.app`, not just the screen.** `.screen` gets its height
from that flex parent. Rendering the reader without it made the scroll container
size to its content, so nothing ever scrolled and all ten pages mounted at once --
which reads exactly like a broken virtualiser rather than a missing wrapper.

**3. A size string needs `<bdi>` too.** `3.9 KB` renders as `KB 3.9` inside a Hebrew
line. The existing rule about isolating filenames applies to any Latin-with-digits
run, not only to names.

---

# Android (Phase 3)

`npm run android` builds and syncs; `npm run probe:android` drives the running app
over the DevTools protocol, the way `probe:packaged` drives the desktop one.

**qpdf-wasm runs in a real Android WebView and reports 12.2.0.** Every mechanic
Phase 0 established in Node -- the console shim, the argv copy, the stdout-mode
warm-up -- holds unchanged under Chromium on the device.

## Three bugs only a device found

**1. The output-unlink heuristic deleted the input.** MEMFS persists between runs,
so Phase 0 concluded that declared outputs must be cleared first. Implementing that
as "unlink the last positional argument" is right for a conversion and wrong for
`--json`, where the last positional is the *input*. The app reported "that file
could not be found" about a document the user had just picked. The fix was to
delete nothing: every scratch name carries a counter, so no name is ever reused and
there is nothing stale to clear.

**2. Platform selection ran too early.** `selectPlatform()` at module scope reads
`window.api` before any script that sets it, because ES imports are evaluated
before the importing module's body. The packaged desktop app is safe by accident --
the preload runs first -- but the e2e harness sets `window.api` in its own body and
so got the *mobile* adapter on the desktop, and rendered nothing. Selection is now
deferred to first use behind a proxy.

**3. `width: 100%` turned the tab bar into one tab.** The rail is a column on the
desktop, where full-width items are correct. Flipping it to a row for phones left
that width in place, so the first item filled the screen and the other seven were
pushed out of sight.

## Android expands `.gz` assets and drops the extension ⚠️

`cap sync` copies `eng.traineddata.gz` (10.4 MB). The APK contains
`eng.traineddata` (23.4 MB): the Android asset packager decompresses `.gz` at merge
time and renames it. The APK is barely larger, because the zip re-deflates it, but
tesseract fetches the **gzipped name** and would 404.

`src/lib/ocr.ts` now asks -- one HEAD request for `eng.traineddata.gz` -- rather
than being told by a build flag. Whether the data is gzipped is a property of how
the host packaged the app, and a flag would have to be kept in sync by hand and
would break OCR on exactly one platform when it drifted.

## The tesseract core trim does not work ❌

The plan expected ~13 MB off the APK by dropping "asm.js fallbacks". The three
~3.8 MB `tesseract-core-*-lstm.wasm.js` files are **not** fallbacks for browsers
without WebAssembly, which is what their size and name suggest. They are the
Emscripten glue the worker `importScripts()`. Dropping them fails with
"failed to load" the first time OCR runs, which `npm run e2e` catches immediately.

A real saving means pinning `corePath` at one variant and shipping only that --
trading ~13 MB against requiring WASM SIMD on the device. That is a product
decision rather than a build tweak, so it has not been taken.

## Where a saved file goes

Android has no "save as" dialog. The two routes are a folder grant taken once via
`ACTION_OPEN_DOCUMENT_TREE` (`FilePicker.pickDirectory`), or the system share sheet
per save. `capacitor-scoped-storage`, which the plan named for the first route,
**does not exist on npm** under that or any near name.

`src/platform/capacitor.ts` therefore writes to a granted location when it has one
and falls back to the sheet, which is not a lesser option for its own sake: a grant
can be revoked between sessions and a fresh install has none, so the sheet is the
only route that always exists.


---

# Building qpdf 12.4.1 from source with Emscripten

The recipe is `scripts/build-qpdf-wasm.md`; the artifacts are `vendor/qpdf-wasm/`.
`node scripts/spike-qpdf-wasm.mjs` now passes with **zero limitations**: same
version as the desktop, identical output on every operation and fixture, and the
same exit code on every damaged file.

## What changed, and what it cost

| | published 12.2.0 | vendored 12.4.1 |
|---|---|---|
| qpdf version | 12.2.0 | **12.4.1**, same as the desktop |
| repairs a damaged xref | no | **yes**, byte-identical to native |
| `print`/`printErr` hooks | absent | **present** |
| `--pages` without a range | rejected | accepted |
| `qpdf.wasm` | 1.33 MB | 2.65 MB |

The 1.3 MB is almost entirely `-fexceptions`: the same build without it is
1.89 MB, and refuses damaged files.

## Three things that made the build awkward

**zlib's CMake emits two targets that collide.** A shared and a static target
both resolve to `libz.a` under Emscripten, and Ninja refuses the duplicate rule.
Configuring once to generate `zconf.h` and then compiling the sources directly is
simpler than fighting it.

**libjpeg-turbo ships a pre-generated `jconfigint.h`** defining
`INLINE __forceinline`, which is MSVC-only. The upstream Docker recipe configures
*in-source*, so CMake's generated copy overwrites it; an out-of-source build has
the stale one win the include order and every file fails with `unknown type name
'__forceinline'`.

**qpdf's `find_path`/`find_library` cannot see outside the Emscripten sysroot.**
The upstream recipe relies on pkg-config, which is not present on Windows. Setting
the cache variables (`ZLIB_H_PATH`, `ZLIB_LIB_PATH`, `LIBJPEG_H_PATH`,
`LIBJPEG_LIB_PATH`) directly short-circuits the search.

## The UMD/ESM trap

Emscripten emits UMD, whose CommonJS branch only fires when Node treats the file
as CommonJS. This repo's root `package.json` sets `"type": "module"`, so a
vendored `qpdf.js` loads as ESM and exports **nothing** — `createModule is not a
function`. A `package.json` containing `{"type": "commonjs"}` next to it fixes
that for Node and Vite alike. The npm package never hit this because its own
package.json made it CommonJS already.

## Still true of any build

The stdout-mode trap is qpdf's own behaviour, not Emscripten's, and survives the
rebuild unchanged: whichever mode claims stdout first wins for the life of the
module, so `--version` must run on its own instance and the shared one is warmed
with a throwaway `--json`.

---

# Camera scanner and saving on Android (Phase 4)

## Where a saved file goes — settled

Phase 3 left this open, and the answer is worse than it looked before turning
into something better than expected.

**`@capacitor/filesystem` cannot write to any location a user picks.** A folder
granted through `ACTION_OPEN_DOCUMENT_TREE` comes back as
`content://com.android.externalstorage.documents/tree/primary%3ADocuments`, and
`Filesystem.writeFile` rejects it outright:

```
'writeFile' not supported for content:// URIs.
```

Writing into the app's own sandbox works; that is the only thing that does. So
the Phase 3 share-sheet fallback was not a shortcut — with the published plugins
it was the only route that existed.

**Two more things Android does that are easy to assume away:**

- **`Download` and the storage root cannot be granted at all.** Picking either
  answers "Can't use this folder — To protect your privacy, choose another
  folder". `Documents` and any user-created folder are fine. A UI that tells
  people to "grant your Downloads folder" is telling them to do something the OS
  forbids.
- **A tree URI cannot be probed by name.** `existsIn`, which the desktop uses to
  warn before a split overwrites files, has no equivalent. It does not need one:
  `DocumentsContract.createDocument` never overwrites, it disambiguates, so a
  clash becomes `report (1).pdf` rather than a lost file.

## The plugin that fixes it

`native/android/DocumentStorePlugin.java`, ~150 lines, wrapping the API that no
published plugin exposes:

| method | Android API | used by |
|---|---|---|
| `createDocument` | `ACTION_CREATE_DOCUMENT` — the system Save-as dialog | `saveAs` |
| `createInTree` | `DocumentsContract.createDocument` | `split`, one grant many files |
| `writeDocument` | `ContentResolver.openOutputStream(uri, "wt")` | `writeFile` |

`ACTION_CREATE_DOCUMENT` turns out to be a better fit than the folder grant it
was meant to replace: it is a real Save-as dialog, so the user chooses the folder
**and** the filename, in any provider they have installed, and the app gets back
a URI it may write to — never a path. That maps exactly onto the existing
`saveAs` then `writeFile` split, so nothing above the platform layer changed.

`"wt"` on `openOutputStream` is load-bearing. Without the truncate flag, saving a
smaller file over a larger one leaves the tail of the old one behind, which for a
PDF means a corrupt document rather than an obviously wrong one.

The source lives in `native/android/` and is copied into the generated project by
`scripts/build-android.mjs`, because `android/` is build output that
`npx cap add android` recreates.

Verified on the emulator: dialog → chosen folder and name → 124 bytes on disk
with the right content; and `createInTree` writing two files into one grant.

## Touch text selection works, and a coordinate error said otherwise

Long-pressing page text in the reader selects it, with handles, and Highlight
then works — checked on the device, ending in "1 annotation". No custom gesture
handling was needed: the text layer is `user-select: text`, and Chromium's own
selection does the rest.

The first attempt reported no selection and nearly became a bug report. The press
was landing 118 device pixels above the text, because `getBoundingClientRect()`
is relative to the WebView viewport while `adb shell input` is absolute screen
coordinates, and the status bar sits between them. Worth remembering for any
future device-driven test: the two coordinate spaces differ by the status bar.

## The scanner cannot be tested on an emulator ⚠️

ML Kit refuses, and says so clearly:

> Document scanner is not supported on Android emulators. The ML Kit Document
> Scanner requires a physical device with a hardware camera.

Everything around it is verified — the Scan tool appears only where
`capabilities.camera` is true, the plugin is bridged, and the failure surfaces as
an ordinary toast with the screen still usable. **The capture itself is unproven
until it runs on real hardware.**

## Scanned pages are not re-encoded — unless they are cropped

`buildPdfFromScans` embeds the OS's JPEG untouched and writes rotation as a page
rotation, where `buildPdfFromImages` decodes to a bitmap and re-encodes. Two
reasons, both about what a scanner hands over that a file picker does not: the
bytes are already a perspective-corrected JPEG, so re-encoding would compress an
already-lossy image a second time; and a 24-page scan at full resolution is over
a gigabyte of `ImageBitmap`, which is not a thing a phone will do.

**Cropping is the one exception, and it is narrow.** `Scan.tsx` calls `cropJpeg`
only for a page whose rectangle is not `FULL_CROP`; every other page still takes
the untouched-bytes path. That keeps the guarantee where it can be kept and
spends a re-encode only where the user has asked for pixels to be thrown away —
which is unavoidable, since a JPEG cannot be cropped without decoding it.

# Re-crop and rotation of images

Added after Phase 4, closing the two deviations that phase recorded. Rotation
already existed for scans; this generalised both to **Images to PDF** as well,
and added cropping to both.

## Rotation is a page rotation, never pixels

A quarter turn is written as `/Rotate` on the page and the image is placed
unchanged. It costs nothing, loses nothing, and survives a later qpdf pass
because it is ordinary PDF structure rather than a re-drawn raster.

This is not visible to a unit test — the assertion that matters is what a
*viewer* reports, and that needs a real pdf.js. `e2e/harness.ts` therefore builds
a one-page PDF with `turns: 1` and checks the viewport comes back transposed:

```
rotate: /Rotate 90, viewport 200x320 (unrotated 320x200) OK
crop:   page 160x100 from 320x200 OK
```

Cropping in `buildPdfFromImages` is a box applied when the decoded bitmap is
encoded (`toJpegBytes(bitmap, quality, box)`), so it costs no extra decode; the
image was being decoded on that path anyway.

## Two arithmetic bugs the unit tests caught

Both were in `src/lib/cropRect.ts`, and both were off-by-a-minimum rather than
off-by-a-mile — the kind that looks right in a screenshot.

- **`MIN_SIDE` leaked into the origin of a fresh drag.** Seeding the rectangle
  with `clampRect(...)` folded the 5% minimum into the point the gesture started
  from, so a drag across half the image produced a 55% rectangle. The seed is now
  deliberately zero-sized and *unclamped*; only the result is clamped. There is a
  comment saying so, because it reads like an oversight otherwise.
- **`toPixels` could place the crop one pixel outside the image.** Rounding the
  origin to the right edge and *then* forcing a minimum width pushed it past the
  bounds. The origin is clamped to `imageWidth - 1` first.

## The cropper needs a real browser, so it has its own e2e suite

`npm run e2e:crop` mounts the real `Cropper` in a real renderer and drives it
with real `PointerEvent`s. The rectangle arithmetic is unit tested; what is not
testable anywhere else is the half that only exists in a browser — pointer
capture, the mapping from a pointer position to a fraction of the image box, and
whether a handle can actually be hit.

**Known limit of that suite:** assertion 4 checks handles are at least 20px, an
absolute size. That passes even when they are useless (see below), so it does not
check the property that actually matters.

## Touch cropping on Android works — after two coordinate errors ⚠️

All four gestures were driven on the emulator with `adb shell input swipe` and
measured from the DOM. Every one landed within a device pixel:

| gesture | asked for | measured |
|---|---|---|
| fresh rectangle on the backdrop | `0.70,0.70` `0.25x0.25` | `0.701,0.701` `0.240x0.239` |
| SE corner handle, resize | `0.60x0.60` | `0.606x0.608` |
| drag the middle, move | `+0.25,+0.25`, size held | `0.509`→`0.758`, size unchanged |
| Apply | rectangle survives | cropper closes, card shows `cropped`, reopening restores `0.509,0.509 0.240x0.239` |

Getting there took two false negatives, **both mine, neither in the app**:

1. The first drag started inside a *full-size* rectangle, so it grabbed the move
   handle of a rectangle that by definition cannot move. The gesture worked
   perfectly; it had nowhere to go. A no-op can be the correct result.
2. The second aimed at the SE handle and landed 46 css px (121 device px) high.
   **This is the same status-bar offset that produced the false negative on
   reader text selection** — `adb shell input` is absolute screen, while
   `getBoundingClientRect()` is WebView-relative. Twice now. Any device-driven
   touch test must convert: `deviceY = (cssY + statusBarCss) * devicePixelRatio`.

What made the diagnosis quick was splitting synthetic from real: dispatching the
desktop suite's own `PointerEvent` sequence over CDP moved the rectangle
correctly, which eliminated React wiring, `touch-action` and `setPointerCapture`
in one step and left only "the touch is not where I think it is".

Also observed, not explained: one injected swipe immediately after a programmatic
open was dropped entirely. The identical input succeeded on retry, and the hit
probe then reported the expected target.

## Handles crowd out a small rectangle ⚠️

The eight handles are 22 css px each and sit centred on the rectangle's edges and
corners. `MIN_SIDE` is 5%, so on a 393px-wide phone the smallest allowed crop is
about 20 css px across — smaller than a single handle. Well before that the 3×3
handle cluster covers the whole box, leaving nothing to grab to *move* it.

Ordinary crops are unaffected and this blocks nothing, but it is a function of
the **rectangle's** size, not the image's, so a large photo does not avoid it.
A fix would be to hide the edge handles below some rectangle size, or scale them
with it.

# Sideloading: what is actually in the APK

`npm run android:apk` assembles a **debug** APK. Not a preference — there is no
signing config in `android/app/build.gradle`, so `assembleRelease` produces an
unsigned artifact that a phone refuses to install. Debug also keeps
`android:debuggable`, confirmed present with `aapt dump badging`, which is what
lets `chrome://inspect` reach the WebView. That matters more than usual here,
because the camera capture is the one thing that cannot be tested off real
hardware.

Verified by installing the built artifact and driving it, rather than trusting
the build log: `adb install -r` succeeded, `npm run probe:android` passed against
it, including the app's own `DocumentStore` plugin and qpdf-wasm reporting 12.4.1
from inside the WebView.

## The APK contains no native libraries at all ⚠️

`unzip -l` finds no `lib/` entries whatsoever. That is not a broken build:
Capacitor and its plugins are pure Java, qpdf and Tesseract are WebAssembly in
`assets/`, and **ML Kit's document scanner is delivered by Google Play Services
rather than bundled**. Two consequences:

- The APK is ABI-independent, so one file installs on any phone, and testing on
  an x86_64 emulator says something real about an arm64 device.
- **The scanner needs Google Play Services.** On a device without it the capture
  will fail no matter how correct the app is. Nothing else in the app depends on
  Play Services.

Also worth knowing before a round of testing: `versionCode` is 1 and
`versionName` 1.0, the Capacitor defaults, and nothing bumps them between
rebuilds. Reinstalling over the top works, but the device gives no way to tell
two builds apart — uninstall between rounds if something looks stale.

# Device feedback: zoom, a shared document, and an unexplained JSON error

Three things came back from the first run on real hardware. Two are fixed; the
third is diagnosed only as far as the evidence allows, and is written up here
rather than guessed at.

## Pinch to zoom was documented but never written

`Viewer.tsx` carried a comment reading "a pinch or ctrl+wheel" and only the wheel
half existed. On a desktop that gap is invisible. On a phone it is the first
thing anyone tries.

Two decisions worth recording:

- **Touch events, not pointer events.** The browser claims a one-finger drag as a
  scroll and answers with `pointercancel`, which ends the gesture exactly as the
  second finger lands. `touchstart`/`touchmove` keep firing either way.
- **`touch-action: pan-x pan-y`, not `pan-y`.** Disabling the browser's own pinch
  is the point -- it scales a bitmap of what is already drawn, which goes soft,
  where the reader re-renders the page at the new scale. But `pan-y` alone would
  have broken horizontal panning, and panning sideways is exactly what you need
  once you have zoomed in past the viewport width. The narrower value passed
  every test and would have shipped a bug.

The gesture state is read through a ref on purpose: an effect that depended on
`scale` would tear down its own listeners on the first zoom step and abandon the
pinch that caused it.

**`adb shell input` cannot send two fingers**, so this is verified in the reader
e2e with synthetic `TouchEvent`s instead, asserting the rendered page actually
widens (`1385 -> 4155px`). It is the last step in that suite deliberately: a
pinch leaves the viewer at 3x, which broke the highlight assertions when it ran
earlier.

## Tools now share the document

Switching tools unmounts the old screen, so every tool started empty and asked
for a file again -- a storage-picker round trip for a document that was open
seconds ago. `App` now holds the current document and the five single-document
tools (Read, Edit Pages, Split, Make Searchable, Compress) adopt it on mount via
`src/lib/useSharedDoc.ts`. Merge, Images to PDF and Scan are deliberately not
included: they take many files or produce them.

**What does not carry over is a tool's own work** -- Edit Pages still forgets its
selection and rotations. Those belong to the screen, not to the document.

Two traps in something that looks like a two-line change:

- **A failed open loops.** The hook reloads whenever "what this tool has" differs
  from the shared slot. When a document fails to open, the screens clear their
  own source, which makes it differ again, and the effect reloads it forever.
  Every failure path now clears the shared slot too.
- **The e2e harnesses mounted the tools with `toasts as never`**, so a missing
  `onDoc` type-checked and then threw `n is not a function` on the first open.
  `npm run e2e:ui` caught it; the type checker could not, because the cast is
  what the harness uses to stub the toast API. The harnesses now hold real state.

"Open another" already existed in all five tools, but the reader's was
`.btn--ghost`, which the phone-width media query hid. It now carries an icon and
survives the icon-only treatment, like Save beside it.

## The OCR "JSON at position 97" error is NOT from our code ⚠️

Reported from a device: after choosing a filename in Make Searchable,
`SyntaxError: Expected ',' or '}' after property value in JSON at position 97
(line 5 column 60)`. **Unreproduced, and unresolved.**

What the evidence rules out. There are exactly two `JSON.parse` calls in this
codebase, both on qpdf's `--json` stdout. The position arithmetic excludes them:
`position 97` at `line 5 column 60` means lines 1-4 total about 38 characters,
roughly 9 or 10 each. qpdf's actual output has lines 1-4 totalling 69 characters
and line 5 is `  },`, four characters long. The failing text is not qpdf's.

Also ruled out: interleaved output from concurrent qpdf runs. `invoke()` in
`qpdfWasm.ts` sets and clears its sink inside one synchronous block around
`callMain`, so two runs cannot overlap.

What is left is a `JSON.parse` we do not own. Capacitor's own bridge has an
uncaught one --
`win.androidBridge.onmessage = (event) => returnResult(JSON.parse(event.data))`
in `native-bridge.js` -- on the path taken by **every** plugin result, including
the save-as dialog's. Its payload is built by `org.json`, which escapes
correctly, so what would have to be malformed is not obvious; and the display
name a SAF provider returns is device-specific, which is consistent with the
emulator not reproducing it.

**What was done anyway:** both of our own `JSON.parse` sites now report what they
received -- length, and the first 200 characters -- instead of a bare character
offset. That does not fix the reported error, and is not claimed to. It means
that if it is ever ours, the next report says so immediately.
