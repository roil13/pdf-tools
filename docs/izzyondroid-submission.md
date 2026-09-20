# IzzyOnDroid submission

Paste-ready body for an **App Submission** issue on the IzzyOnDroid tracker.
Kept here so a resubmission, or a submission to another catalogue, does not start
from a blank page. The full description this was trimmed from is
[`about.md`](about.md).

Requirements checked against their inclusion policy: OSI licence declared in the
repository root, source public, APK attached to a tagged GitHub release,
release-signed, no `android:debuggable` or `android:testOnly`, no trackers or
ads, fastlane metadata in the repository.

---

**App Name:** PDF Toolkit

**Package ID:** `com.lioryosub.pdftoolkit`

**License:** MIT

**Source Code:** https://github.com/roil13/pdf-tools

**APK:** attached to tagged GitHub releases —
https://github.com/roil13/pdf-tools/releases/latest

**Fastlane metadata:** `fastlane/metadata/android/` in the repository
(`en-US` and `he`: descriptions, icon, changelogs, screenshots)

**Summary:** Read, annotate, scan and reorganise PDFs. Fully offline. No
accounts, no AI.

## Description

A complete PDF toolkit that runs entirely on the device. No file leaves the
phone, nothing is uploaded, it works with no internet connection, and there are
no AI features. Every tool writes a new file, so originals are never modified.

**Bookmarks and form fields survive every operation.** That is the reason the app
carries a real build of qpdf, compiled to WebAssembly, rather than using a
JavaScript PDF library. A PDF is an object graph: page content lives in page
objects, but bookmarks, form fields and the tagged-structure tree live elsewhere
and reference those pages. Rebuild the document carelessly and they are silently
dropped. Many PDF tools lose them without saying so.

Tools: **Read** (continuous scroll, pinch zoom, full-text search, bookmarks and
links, highlight, underline, strike out, sticky notes, freehand ink and form
filling, all saved as real PDF annotations) · **Scan** (camera capture with
automatic edge detection) · **Edit Pages** · **Merge** · **Split** · **Images to
PDF** · **Make Searchable** (offline OCR, English and Hebrew) · **Compress**.

Available in English and Hebrew, with a fully mirrored right-to-left layout.

Files are saved wherever the user chooses, through the system document picker.

## Building from source

Verified from a clean `git clone` on Windows, with no `android/` directory and no
signing key present.

### Prerequisites

| | version used |
|---|---|
| Node.js | 24 (what CI uses) |
| JDK | 21 (Android Studio's bundled JBR is fine) |
| Android SDK | platform `android-36`, build-tools `36.0.0` |
| Gradle | 8.14.3, downloaded automatically by the wrapper |

`ANDROID_HOME` (or `ANDROID_SDK_ROOT`) must point at the SDK. `minSdkVersion` is
24, `compileSdkVersion` and `targetSdkVersion` are 36.

### Build

```bash
git clone https://github.com/roil13/pdf-tools.git
cd pdf-tools
npm ci
npm run assets        # stage run-time assets into public/ -- NOT optional
npm run android:apk   # debug APK
```

The APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`.

Three things worth knowing:

- **`npm run assets` is required.** The renderer fetches the pdf.js cmaps and
  standard fonts, the Tesseract core and language data, and the Noto font *by
  URL* at run time. They are staged into `public/` from `node_modules` and
  `vendor/` rather than committed, and nothing else stages them.
- **There is no `android/` directory in the repository.** It is generated build
  output; `npm run android:apk` runs `npx cap add android` when it is missing and
  then installs the app's own Java sources, the signing configuration and the
  version into it. Nothing inside `android/` is hand-edited, so nothing is lost
  when it is regenerated.
- **A release build needs a signing key**, which only the maintainer has.
  `npm run android:apk:release` reads a gitignored `keystore.properties`; without
  it the build stops and explains why rather than emitting an unsigned APK that
  Android would refuse to install. Third parties build the debug variant above.

### Running the tests

```bash
npm run verify
```

A repository audit, a type check, 255 unit tests, and four end-to-end suites that
drive the real screens in a real Electron renderer. CI runs exactly
`npm ci && npm run assets && npm run verify` on `windows-latest` for every push.
Windows, because the integration tests read every PDF they produce back with the
native `qpdf.exe` in `vendor/` rather than trusting the writer under test.

## Dependencies worth flagging

**The Scan tool uses Google's ML Kit document scanner, which requires Google Play
Services.** Declaring it up front rather than leaving it to be found:

- It is the **only** proprietary dependency in the app. Everything else is FOSS.
- It is **optional and capability-gated** — the tool is only offered where a
  camera is reported, and every other tool works without Play Services.
- If this is a problem for inclusion, a build flavour without the Scan tool is a
  small change, since the screen already appears conditionally.

There are **no analytics or advertising SDKs, and no external network requests**.
The whole codebase contains three `fetch` calls, all of them relative paths to
assets bundled inside the app (`src/lib/ocr.ts`, `src/tools/Ocr.tsx`,
`src/tools/Reader.tsx`); there are no absolute URLs used at run time. The
`INTERNET` permission is declared because the Capacitor shell serves the UI from
`https://localhost`.

`READ_EXTERNAL_STORAGE` appears capped at `maxSdkVersion="28"`. Nothing asks for
it — the manifest merger implies it from the file sharer's
`WRITE_EXTERNAL_STORAGE` — and it is capped deliberately, so on Android 10 and
later the app requests no storage permission at all. Files are only ever reached
as `content://` URIs the user picked in the system document picker.
