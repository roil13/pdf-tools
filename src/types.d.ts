// These packages ship no usable types for the entry points we import.
// The shapes we actually rely on are declared in src/lib/imageDecode.ts.
declare module 'libheif-js/wasm-bundle';
declare module 'utif';

/**
 * The vendored qpdf build. Emscripten emits UMD with no types; the surface we
 * use is the factory plus `callMain` and `FS`, declared where it is consumed
 * (src/platform/qpdfWasm.ts).
 */
declare module '*/vendor/qpdf-wasm/qpdf.js';
