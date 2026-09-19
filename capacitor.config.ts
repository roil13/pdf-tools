import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android shell.
 *
 * `webDir` is the same `dist/` the Electron build serves, and it works unchanged
 * because `vite.config.ts` already sets `base: './'` -- originally so the
 * packaged desktop app could load over a custom scheme, which happens to be
 * exactly what a WebView needs too.
 */
const config: CapacitorConfig = {
  appId: 'com.lioryosub.pdftoolkit',
  appName: 'PDF Toolkit',
  webDir: 'dist',
  android: {
    // The renderer fetches its OCR data, cmaps and WASM by URL. Serving over
    // https://localhost rather than file:// is what makes those fetches legal,
    // the same reason the desktop build uses an app:// scheme.
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
