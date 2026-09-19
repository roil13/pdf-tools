# Building `vendor/qpdf-wasm`

qpdf **12.4.1** compiled to WebAssembly, so the mobile build runs the same qpdf
the desktop does. Checked in under `vendor/qpdf-wasm/` the way `vendor/qpdf/`
holds the Windows binary — a build artifact the app depends on, not source.

Verify any rebuild with `node scripts/spike-qpdf-wasm.mjs`, which runs the real
argv arrays against both this and the native binary and compares the outputs.

## Why not the published package

`@neslinesli93/qpdf-wasm` was used first and is a reasonable build, but it has
two defects that matter here, both from link flags rather than from qpdf:

- **It cannot repair a damaged cross-reference table.** qpdf recovers by
  *catching* the parse failure and reconstructing; Emscripten disables exception
  catching by default, so the throw is fatal instead. Every damaged file the
  desktop silently repairs is refused. This reads exactly like a qpdf version
  difference and is not one — a from-source 12.4.1 built without `-fexceptions`
  fails identically.
- **`print`/`printErr` do nothing**, because its
  `INCOMING_MODULE_JS_API` whitelist omits them. Capturing qpdf's output then
  means shimming the global `console` *before* instantiating the module.

## Prerequisites

- Emscripten **3.1.74** (the version the upstream Docker recipe uses)
- CMake ≥ 3.16 and Ninja. On a machine with Android Studio both ship inside
  `<sdk>/cmake/<version>/bin`, which is where these commands found them.
- No Docker needed; no autoconf or make either, since every dependency is built
  through CMake.

```
git clone --depth 1 https://github.com/emscripten-core/emsdk.git
cd emsdk && python emsdk.py install 3.1.74 && python emsdk.py activate 3.1.74
```

Set for every command below:

```
EMSDK=<emsdk>            EM_CONFIG=$EMSDK/.emscripten
PATH=<cmake>/bin;$EMSDK/upstream/emscripten;$PATH
```

## Sources

```
git clone --depth 1 --branch v12.4.1 --recurse-submodules https://github.com/qpdf/qpdf.git lib/qpdf
# pinned to the commits the upstream Docker recipe is known to build with
lib/zlib        madler/zlib            21767c654d31d2dccdde4330529775c6c5fd5389
lib/jpeg-turbo  ImageMagick/jpeg-turbo 7aa2a898c564041a24b09d0a6e780aaa632d08d3
```

## 1. zlib

Its CMake emits both a shared and a static target that resolve to the same
`libz.a` under Emscripten, and Ninja refuses the duplicate rule. Configure once
to generate `zconf.h`, then compile the sources directly:

```
emcmake cmake -S . -B build -DCMAKE_INSTALL_PREFIX=$OUT -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS="-Oz -flto -fvisibility=hidden"
# then, for each *.c:
emcc -Oz -flto -fvisibility=hidden -I. -Ibuild -DHAVE_UNISTD_H -c $f -o $f.o
emar rcs $OUT/lib/libz.a *.o
cp zlib.h build/zconf.h $OUT/include/
```

## 2. libjpeg-turbo

Two adjustments:

- `jchuff.c` picks a 64-bit bit buffer unless the platform is known 32-bit.
  Emscripten is 32-bit and unlisted, so add `|| defined(__EMSCRIPTEN__)` to the
  `BIT_BUF_SIZE 32` branch.
- This fork **ships a pre-generated `jconfigint.h`** at the source root defining
  `INLINE __forceinline`, which is MSVC-only and shadows the one CMake generates.
  The upstream recipe configures in-source so the generated file overwrites it;
  an out-of-source build must copy it over by hand, or every file fails with
  `unknown type name '__forceinline'`.

```
emcmake cmake -S . -B build -DCMAKE_INSTALL_PREFIX=$OUT -DENABLE_SHARED=off \
  -DWITH_SIMD=0 -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS="-Oz -flto -fvisibility=hidden"
cp build/jconfigint.h jconfigint.h
cmake --build build --target install -j 4
```

## 3. libqpdf

qpdf finds zlib and libjpeg through pkg-config or plain `find_path`/
`find_library`. The Emscripten toolchain confines `find_*` to its own sysroot, so
without pkg-config the cache variables are set directly:

```
emcmake cmake -S . -B build \
  -DCMAKE_INSTALL_PREFIX=$OUT -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_DOC=OFF -DBUILD_DOC_HTML=OFF -DBUILD_DOC_PDF=OFF \
  -DZLIB_H_PATH=$OUT/include    -DZLIB_LIB_PATH=$OUT/lib/libz.a \
  -DLIBJPEG_H_PATH=$OUT/include -DLIBJPEG_LIB_PATH=$OUT/lib/libjpeg.a \
  -DCMAKE_C_FLAGS="-Oz -flto -fvisibility=hidden" \
  -DCMAKE_CXX_FLAGS="-Oz -flto -fvisibility=hidden -fexceptions"
cmake --build build --target libqpdf -j 4
```

**`-fexceptions` must be on the C++ flags here, not only at link.** It is what
makes damaged-file recovery work, and it is the single most important line in
this document. Without it the build succeeds, every test passes, and damaged
PDFs are quietly refused.

## 4. Link

```
emcc -Oz -flto -fvisibility=hidden -fexceptions \
  -I <qpdf>/include -I $OUT/include -L $OUT/lib \
  --pre-js pre.js \
  -s WASM_BIGINT=1 -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_RUNTIME_METHODS='["callMain","FS"]' \
  -s INCOMING_MODULE_JS_API='["noInitialRun","locateFile","preRun","print","printErr"]' \
  -s MODULARIZE=1 \
  -o dist/qpdf.js \
  <qpdf>/build/libqpdf/libqpdf.a <qpdf>/qpdf/qpdf.cc \
  -lz -ljpeg
```

`pre.js` is one line, `Module["noInitialRun"] = true;`, so instantiating the
module never runs qpdf's `main()` even if the caller forgets to say so.

`--closure 1` is deliberately **not** used. It saves about 35 KB of a 2.7 MB
artifact and costs the guarantee that `FS`'s method names survive; the upstream
recipe needs a `post.js` re-exporting them by string to work around it.

## 5. Install

Copy `qpdf.js` and `qpdf.wasm` into `vendor/qpdf-wasm/`, alongside:

- `VERSION` — `12.4.1`
- `LICENSE.txt` / `NOTICE.md` — qpdf is Apache-2.0, same as `vendor/qpdf/`
- `package.json` — `{"type": "commonjs"}`. Emscripten emits UMD, whose CommonJS
  branch only fires when Node treats the file as CommonJS. The repo root sets
  `"type": "module"`, so without this marker `qpdf.js` loads as ESM and exports
  nothing.

Then `node scripts/spike-qpdf-wasm.mjs` must pass with zero limitations.

## Size

| | |
|---|---|
| `qpdf.wasm` | 2.65 MB |
| `qpdf.js` | 80 KB |
| for comparison, `vendor/qpdf/` (native) | 7.46 MB |

`-fexceptions` accounts for roughly 0.76 MB of the wasm — the same build without
it is 1.89 MB. That is the price of repairing damaged files rather than refusing
them, and it is worth paying.
