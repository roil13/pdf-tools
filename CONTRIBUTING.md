# Contributing

Thanks for looking. This is a small, opinionated project; the notes below are
less about process than about the two or three rules that are load-bearing.

## Getting it running

```bash
npm ci
npm run assets      # stage the run-time assets into public/ -- see below
npm run fixtures    # regenerate test/fixtures if you need to
npm run dev         # Vite + Electron, with reload
```

**`npm run assets` is not optional on a clean checkout.** The renderer fetches
the pdf.js cmaps and standard fonts, the Tesseract core and language data, and
the Noto font *by URL* at run time. Those are staged into `public/` out of
`node_modules` and `vendor/` rather than committed, and `npm run verify` does
not stage them itself. Without it the OCR and reader end-to-end suites fail in a
way that looks like a bug in the code.

### Building for Android

```bash
npm run android:apk          # debug APK, for testing
npm run android:apk:release  # signed release APK -- see Releasing below
```

Needs a **JDK 21** (Android Studio's bundled JBR does) and an **Android SDK**
with platform `android-36` and build-tools `36.0.0`, with `ANDROID_HOME` pointing
at it. Gradle comes from the wrapper.

**There is no `android/` directory in the repository** -- it is generated build
output. The build creates it with `npx cap add android` when it is missing, then
installs the app's own Java, the signing configuration and the version into it.
That is why nothing inside `android/` is ever hand-edited: it would be lost on
the next regeneration, silently, and you would find out when an APK refused to
install.

Verified from a clean clone; the full instructions, prerequisites and all, are in
[`docs/izzyondroid-submission.md`](docs/izzyondroid-submission.md).

## The gate

```bash
npm run verify
```

That is: the repo audit, `tsc --noEmit`, 255 unit tests, and four end-to-end
suites that drive the real screens in a real Electron renderer. A change is not
finished until this exits 0. On Android, `npm run android` then
`npm run probe:android` is the equivalent.

### What the audit enforces

`scripts/audit.mjs` is mechanical, not advisory, and it fails the build:

| check | what it catches |
|---|---|
| `i18n.literals`, `i18n.staleT`, `i18n.placeholders` | user-visible text that is not a translation key |
| `css.physical` | `left`/`right`/`margin-left`… instead of logical properties |
| `hygiene.console`, `.markers`, `.controlChars`, `.deadExport` | `console.*`, `TODO`/`FIXME`, stray control characters, exports nothing imports |
| `hygiene.staleDoc` | documentation that names something no longer there |
| `ipc.surface` | anything in `src/` touching `window.api` outside the platform adapter |
| `css.unused`, `scripts.missing` | dead CSS, npm scripts referenced but absent |

## Three rules that matter more than style

**1. Bookmarks and form fields survive every operation.** This is the reason the
app shells out to qpdf instead of using a pure-JS library, and it is the thing
most likely to break silently. If you touch an operation, read the output back
with the *native* qpdf binary and assert the structure — don't trust the writer
you just changed. `test/operations.test.ts` shows the pattern.

**2. A missing Hebrew string is a compile error.** `src/i18n/strings.ts` declares
an explicit `Strings` interface, so adding an `en` key without a `he` one fails
`npm run typecheck`. This is deliberate; please add both rather than working
around it. Hebrew has a dual plural form — see `src/i18n/t.ts`.

**3. Layout is right-to-left by default.** Use logical CSS properties
(`inset-inline-start`, `margin-block`, …) throughout. `css.physical` enforces it.

## Where things live

`electron/` main process · `src/` renderer, with no Node access ·
`src/platform/` what the app asks of its host, with an Electron and a Capacitor
implementation · `shared/` PDF operations both hosts run · `native/android/` the
app's own Android plugin · `vendor/` qpdf, its WebAssembly build, Tesseract data
and the Noto font.

`android/` is **generated** by `npx cap add android` and is not in the
repository. Anything hand-edited there is lost on the next build; native sources
belong in `native/android/`, which `scripts/build-android.mjs` installs.

## Releasing

```bash
npm run package             # Windows installer + portable exe into release/
npm run android:apk         # debuggable APK, for testing
npm run android:apk:release # signed APK, for publishing
```

**The debug APK is the one to test with.** It keeps `android:debuggable`, which
is what lets `chrome://inspect` reach the WebView — the only way to diagnose the
camera capture, which cannot be tested on an emulator at all. A release APK is
not debuggable.

### Signing

`npm run android:apk:release` needs a `keystore.properties` at the repository
root. It is gitignored, and so is any `*.jks`:

```properties
storeFile=C:/path/to/your-release.jks
storePassword=...
keyAlias=...
keyPassword=...
```

Create the keystore once, outside the repository:

```bash
keytool -genkeypair -v -keystore ~/your-release.jks -storetype PKCS12   -keyalg RSA -keysize 4096 -validity 10000 -alias your-alias
```

**Back it up somewhere that is not just your machine.** If you lose it you can
never ship an update that installs over an existing copy — every user has to
uninstall first. Changing keys is not something you can undo.

Without `keystore.properties` the build still works; it simply refuses to
produce a release APK, because an unsigned one is worse than useless (Android
declines to install it).

### Store metadata

`fastlane/metadata/android/<locale>/` holds the description, icon, changelog and
screenshots that [IzzyOnDroid](https://izzyondroid.org) reads straight out of
this repository. `en-US` is the fallback; `he` mirrors it.

A changelog file is named after the **versionCode**, not the version name, so
0.1.1 is `changelogs/101.txt`. `installSigningAndVersion()` derives that code as
`major * 10000 + minor * 100 + patch`.

Screenshots are padded to 1200x2400 rather than cropped: the catalogue caps them
at a 2:1 height-to-width ratio and a phone screen is 2.22:1, so cropping to fit
would cut either the reader toolbar or the tab bar.

The catalogue picks up a new version automatically once a release is tagged and
a release-signed APK is attached to it -- which is what `npm run
android:apk:release` produces.

The submission itself is a one-off issue on their tracker; the body is kept in
[`docs/izzyondroid-submission.md`](docs/izzyondroid-submission.md) so a
resubmission, or a submission elsewhere, does not start from a blank page.

### Why the signing config is injected rather than committed

`android/app/build.gradle` is **generated**. A `signingConfig` added to it by
hand survives until the next `npx cap add android` and then vanishes, which you
discover when an APK will not install. `installSigningAndVersion()` in
`scripts/build-android.mjs` installs it on every build, for the same reason
`installNativeSources()` installs the Java. It also stamps `versionCode` and
`versionName` from `package.json`, since the generated project hard-codes 1 and
"1.0" and nothing else would ever move them.

No password is written into `build.gradle`. The injected Gradle reads
`keystore.properties` at evaluation time.

## Writing things down

`docs/spike-findings.md` records what was verified *empirically* and what it
cost — including the things that turned out to be wrong. If you discover
something surprising about qpdf, pdf.js, Android or a library, it belongs there,
corrected in place rather than appended around. It is the most useful file in
the repository.

## Pull requests

Small and focused beats large and complete. Say what you verified and how; "the
tests pass" is less useful than "read the output back with native qpdf and the
outline still resolves to the right pages". If something is unfinished or
unverified, say so plainly — that is more valuable than a confident summary.
