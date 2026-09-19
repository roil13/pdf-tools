/**
 * Build the web assets for Android and sync them into the native project.
 *
 * A separate entry point from `npm run build` because the Electron main bundle is
 * meaningless here. The staged assets are the SAME as the desktop's: an attempt
 * to trim them for mobile is written up in scripts/copy-assets.mjs, and does not
 * survive contact with how tesseract actually loads its core.
 *
 * usage: node scripts/build-android.mjs [--run] [--apk]
 */
import { spawnSync } from 'node:child_process';
import { statSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const run = (cmd, args, { env = {}, cwd } = {}) => {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    cwd,
    env: { ...process.env, ...env },
  });
  if (res.status !== 0) {
    console.error(`\nfailed: ${cmd} ${args.join(' ')}`);
    process.exit(res.status ?? 1);
  }
};

console.log('staging renderer assets');
run('node', ['scripts/copy-assets.mjs']);

console.log('\nbuilding the renderer');
run('npx', ['vite', 'build']);

console.log('\nsyncing into the android project');
run('npx', ['cap', 'sync', 'android']);

installNativeSources();

/**
 * Copy the app's own Java into the generated project.
 *
 * `android/` is build output -- `npx cap add android` recreates it -- so
 * anything hand-written inside it would be lost. The sources live in
 * `native/android/` and are installed here on every build, which also means the
 * generated project never has to be edited by hand.
 */
function installNativeSources() {
  const pkgDir = 'android/app/src/main/java/com/lioryosub/pdftoolkit';
  mkdirSync(pkgDir, { recursive: true });
  for (const name of readdirSync('native/android')) {
    if (!name.endsWith('.java')) continue;
    copyFileSync(path.join('native/android', name), path.join(pkgDir, name));
    console.log(`  installed ${name}`);
  }
}

/** Total bytes under a directory, so the size claim is measured not assumed. */
function sizeOf(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? sizeOf(full) : statSync(full).size;
  }
  return total;
}

const assets = 'android/app/src/main/assets/public';
try {
  console.log(`\nweb assets in the APK: ${(sizeOf(assets) / 1e6).toFixed(1)} MB`);
} catch {
  console.log('\n(assets not found; did cap sync run?)');
}

if (process.argv.includes('--apk')) assembleApk();

if (process.argv.includes('--run')) {
  console.log('\nlaunching on a device or emulator');
  run('npx', ['cap', 'run', 'android']);
} else if (!process.argv.includes('--apk')) {
  console.log('\nNext: npx cap run android   (or open the project in Android Studio)');
}

/**
 * Assemble a sideloadable APK.
 *
 * Debug, not release, for two reasons. There is no signing config in
 * `android/app/build.gradle`, so `assembleRelease` produces an unsigned APK that
 * a phone will refuse to install; and a debug build keeps `android:debuggable`,
 * which is what lets `chrome://inspect` reach the WebView -- the only way to
 * diagnose the one thing that cannot be tested off real hardware, the camera
 * capture.
 */
function assembleApk() {
  console.log('\nassembling a debug APK');
  // Explicitly relative: with `shell: true` neither cmd nor sh searches the
  // working directory for an executable, so a bare `gradlew.bat` is not found.
  // `path.sep` keeps the separator right without a backslash in this source.
  const gradlew = '.' + path.sep + (process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  run(gradlew, ['assembleDebug'], { cwd: 'android' });

  const apk = path.resolve('android/app/build/outputs/apk/debug/app-debug.apk');
  console.log(`\nAPK: ${apk}`);
  console.log(`     ${(statSync(apk).size / 1e6).toFixed(1)} MB`);
}
