/**
 * Build the web assets for Android and sync them into the native project.
 *
 * A separate entry point from `npm run build` because the Electron main bundle is
 * meaningless here. The staged assets are the SAME as the desktop's: an attempt
 * to trim them for mobile is written up in scripts/copy-assets.mjs, and does not
 * survive contact with how tesseract actually loads its core.
 *
 * usage: node scripts/build-android.mjs [--run] [--apk] [--apk-release]
 */
import { spawnSync } from 'node:child_process';
import { statSync, readdirSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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
installSigningAndVersion();

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

const wantsRelease = process.argv.includes('--apk-release');
const wantsDebug = process.argv.includes('--apk');
if (wantsDebug || wantsRelease) assembleApk(wantsRelease);

if (process.argv.includes('--run')) {
  console.log('\nlaunching on a device or emulator');
  run('npx', ['cap', 'run', 'android']);
} else if (!wantsDebug && !wantsRelease) {
  console.log('\nNext: npx cap run android   (or open the project in Android Studio)');
}

/**
 * Teach the generated project how to sign a release, and what version it is.
 *
 * Both belong here for the same reason `installNativeSources` does: `android/`
 * is build output that `npx cap add android` recreates, so anything edited
 * inside it by hand is lost on the next regeneration -- silently, and noticed
 * only when an unsigned APK refuses to install.
 *
 * No password is written into build.gradle. The injected Gradle reads
 * `keystore.properties` at evaluation time from the repository root, where it
 * is gitignored, and when that file is absent it does nothing at all: a fresh
 * clone and CI still build, they simply cannot produce a signed release.
 */
function installSigningAndVersion() {
  const gradle = 'android/app/build.gradle';
  let text = readFileSync(gradle, 'utf8');

  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const [major, minor, patch] = version.split('.').map(Number);
  // Monotonic while minor and patch stay under 100, which is the only property
  // Android cares about: an install refuses to replace a higher code.
  const code = major * 10000 + minor * 100 + patch;

  text = text
    .replace(/versionCode \d+/, `versionCode ${code}`)
    .replace(/versionName "[^"]*"/, `versionName "${version}"`);

  if (!text.includes('signingConfigs')) {
    text = `def keystorePropsFile = file("$rootDir/../keystore.properties")
def keystoreProps = new Properties()
if (keystorePropsFile.exists()) { keystoreProps.load(new FileInputStream(keystorePropsFile)) }

` + text;

    text = text.replace('android {', `android {
    signingConfigs {
        release {
            if (keystorePropsFile.exists()) {
                storeFile file(keystoreProps['storeFile'])
                storePassword keystoreProps['storePassword']
                keyAlias keystoreProps['keyAlias']
                keyPassword keystoreProps['keyPassword']
            }
        }
    }`);

    text = text.replace(`        release {
            minifyEnabled false`, `        release {
            if (keystorePropsFile.exists()) { signingConfig signingConfigs.release }
            minifyEnabled false`);
  }

  writeFileSync(gradle, text);
  console.log(`  version ${version} (code ${code}); release signing `
    + `${existsSync('keystore.properties') ? 'configured' : 'NOT configured -- no keystore.properties'}`);
}

/**
 * Assemble a sideloadable APK.
 *
 * Debug is the default because it keeps `android:debuggable`, which is what
 * lets `chrome://inspect` reach the WebView -- the only way to diagnose the one
 * thing that cannot be tested off real hardware, the camera capture. Release is
 * what you publish: not debuggable, and signed with the key named in
 * `keystore.properties`.
 *
 * An unsigned release APK is worse than useless, because Android refuses to
 * install it, so this stops rather than producing one.
 */
function assembleApk(release) {
  if (release && !existsSync('keystore.properties')) {
    console.error('\nkeystore.properties is missing, so a release APK would be unsigned');
    console.error('and Android would refuse to install it. See CONTRIBUTING.md.');
    console.error('`--apk` builds the debuggable one, which needs no key.');
    process.exit(1);
  }

  const kind = release ? 'release' : 'debug';
  console.log(`\nassembling a ${kind} APK`);
  // Explicitly relative: with `shell: true` neither cmd nor sh searches the
  // working directory for an executable, so a bare `gradlew.bat` is not found.
  // `path.sep` keeps the separator right without a backslash in this source.
  const gradlew = '.' + path.sep + (process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  run(gradlew, [release ? 'assembleRelease' : 'assembleDebug'], { cwd: 'android' });

  const apk = path.resolve(`android/app/build/outputs/apk/${kind}/app-${kind}.apk`);
  console.log(`\nAPK: ${apk}`);
  console.log(`     ${(statSync(apk).size / 1e6).toFixed(1)} MB`);
}
