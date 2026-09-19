/**
 * End-to-end harness for the OCR pipeline. Runs the SAME modules the app uses,
 * inside a real Electron renderer, against a synthetic scan -- the one path that
 * unit tests cannot cover, because it needs a canvas, a Web Worker and WASM.
 *
 * Not part of the shipped app; built separately by scripts/e2e-ocr.mjs.
 */
import { openDocument, closeDocument } from '../src/lib/pdfRender.js';
import { Recogniser } from '../src/lib/ocr.js';
import { addTextLayer, type PageWords } from '../src/lib/textLayer.js';
import { decodeImage, bitmapToCanvas } from '../src/lib/imageDecode.js';
import { buildPdfFromImages } from '../src/lib/imagesToPdf.js';

declare global {
  interface Window { e2e?: unknown }
}

const DPI = 300;

/**
 * Images -> PDF. The decoders are the riskiest third-party integrations in the
 * app: `utif` is CJS with no exports map and `libheif-js/wasm-bundle` is an
 * Emscripten build, so the shape each yields under Vite's interop is a guess
 * until it actually runs in a renderer.
 */
async function imagesScenario() {
  const files = ['sample.png', 'sample.webp', 'sample.tif'];
  const decoded = [];
  const perFile: Record<string, string> = {};

  for (const f of files) {
    try {
      const bytes = new Uint8Array(await (await fetch(`./img/${f}`)).arrayBuffer());
      const frames = await decodeImage(f, bytes);
      perFile[f] = `${frames.length} frame(s) ${frames[0].width}x${frames[0].height}`;
      // Exercise the thumbnail path too -- this is what threw on closed bitmaps.
      bitmapToCanvas(frames[0].bitmap, 60);
      decoded.push(...frames);
    } catch (err) {
      perFile[f] = `FAILED: ${String(err)}`;
    }
  }

  const pdf = await buildPdfFromImages(decoded, { pageSize: 'fit', margin: 0, quality: 0.9 });
  const doc = await openDocument(pdf);
  const pageCount = doc.numPages;
  const first = (await doc.getPage(1)).getViewport({ scale: 1 });
  const dims = { w: Math.round(first.width), h: Math.round(first.height) };
  await closeDocument(doc);

  // Rotation and cropping need a canvas, so they cannot be unit tested. Here
  // they run through the real pipeline in a real renderer.
  //
  // A quarter turn must reach the PDF as a page rotation and swap what a viewer
  // reports, without redrawing the pixels; a crop must shrink the page to the
  // region kept. pdf.js's viewport is the independent check for both, because it
  // applies /Rotate exactly as a reader would.
  const turned = await buildPdfFromImages(
    [{ ...decoded[0], turns: 1 }],
    { pageSize: 'fit', margin: 0, quality: 0.9 },
  );
  const turnedDoc = await openDocument(turned);
  const turnedPage = await turnedDoc.getPage(1);
  const turnedView = turnedPage.getViewport({ scale: 1 });
  const rotation = { rotate: turnedPage.rotate, w: Math.round(turnedView.width), h: Math.round(turnedView.height) };
  await closeDocument(turnedDoc);

  const cropped = await buildPdfFromImages(
    [{ ...decoded[0], crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }],
    { pageSize: 'fit', margin: 0, quality: 0.9 },
  );
  const croppedDoc = await openDocument(cropped);
  const croppedView = (await croppedDoc.getPage(1)).getViewport({ scale: 1 });
  const cropDims = { w: Math.round(croppedView.width), h: Math.round(croppedView.height) };
  await closeDocument(croppedDoc);

  return {
    perFile, decodedFrames: decoded.length, pageCount, dims, bytes: pdf.length,
    rotation, cropDims,
  };
}

async function main() {
  const steps: string[] = [];
  const note = (s: string) => { steps.push(s); document.getElementById('log')!.textContent = s; };

  const pdfBytes = new Uint8Array(await (await fetch('./scan.pdf')).arrayBuffer());
  note('opened scan.pdf');

  const doc = await openDocument(pdfBytes);
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: DPI / 72 });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  note(`rendered page at ${canvas.width}x${canvas.height}`);

  const rec = await Recogniser.create(['eng', 'heb']);
  note('recogniser ready (worker + core + language data loaded)');

  const { words, text } = await rec.recognise(canvas);
  note(`recognised ${words.length} words`);
  await rec.close();

  const fontBytes = new Uint8Array(
    await (await fetch('./fonts/NotoSansHebrew-Regular.ttf')).arrayBuffer(),
  );

  const pages: PageWords[] = [{
    pageNum: 1,
    words,
    toPdfPoint: (x, y) => viewport.convertToPdfPoint(x, y) as [number, number],
    scale: DPI / 72,
    rotation: page.rotate ?? 0,
  }];

  const out = await addTextLayer(pdfBytes, pages, fontBytes);
  note(`wrote text layer (${out.length} bytes)`);

  // Read the result back exactly as a PDF viewer would.
  const check = await openDocument(out);
  const content = await (await check.getPage(1)).getTextContent();
  const extracted = (content.items as { str: string }[])
    .map((i) => i.str).filter((s) => s.trim());
  await closeDocument(check);
  await closeDocument(doc);

  note('running images scenario');
  const images = await imagesScenario();

  window.e2e = {
    ok: true,
    images,
    wordCount: words.length,
    ocrText: text,
    extracted,
    outBytes: out.length,
    steps,
  };
}

main().catch((err) => {
  window.e2e = { ok: false, error: String(err?.stack ?? err) };
});
