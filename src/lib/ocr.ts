import { createWorker, type Worker } from 'tesseract.js';

/** A recognised word with its box in the rendered image's pixel space. */
export interface OcrWord {
  text: string;
  confidence: number;
  /** Top-left origin, matching the canvas the page was rendered into. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type OcrLanguage = 'eng' | 'heb';

/**
 * Everything is served from the app itself: the worker script, the WASM core and
 * the language data. Nothing is fetched, so OCR works with no connection.
 * Vite copies these out of public/ at build time.
 */
const ASSETS = {
  workerPath: new URL('./tesseract/worker.min.js', document.baseURI).href,
  corePath: new URL('./tesseract/core/', document.baseURI).href,
  langPath: new URL('./tessdata/', document.baseURI).href,
};

/**
 * Whether the language data is served gzipped.
 *
 * It is on the desktop, where the vendored `.traineddata.gz` is copied verbatim.
 * It is NOT inside an Android APK: the Android asset packager expands a `.gz`
 * asset at build time and drops the extension, so `eng.traineddata.gz` becomes
 * `eng.traineddata` and a request for the gzipped name 404s.
 *
 * Asked rather than configured, because the answer is a property of how the
 * host packaged the app -- something a build flag would have to be kept in sync
 * with by hand, and would silently break OCR on one platform when it drifted.
 * One HEAD request, once per session.
 */
let gzipped: Promise<boolean> | null = null;

function langDataIsGzipped(): Promise<boolean> {
  gzipped ??= fetch(`${ASSETS.langPath}eng.traineddata.gz`, { method: 'HEAD' })
    .then((res) => res.ok)
    .catch(() => false);
  return gzipped;
}

/**
 * tesseract.js 7 returns NO `data.words`. Word boxes are nested under
 * blocks -> paragraphs -> lines -> words, and only appear when `blocks: true`
 * is passed as an output option. (Verified in scripts/spike-tesseract.mjs.)
 */
interface TessWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}
interface TessData {
  text?: string;
  blocks?: { paragraphs?: { lines?: { words?: TessWord[] }[] }[] }[];
}

function collectWords(data: TessData): OcrWord[] {
  const out: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const w of line.words ?? []) {
          const text = w.text?.trim();
          if (!text) continue;
          out.push({
            text,
            confidence: w.confidence ?? 0,
            x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1,
          });
        }
      }
    }
  }
  return out;
}

/**
 * A recogniser bound to a set of languages. Creating the worker is expensive
 * (it loads the WASM core and each language model), so one instance is reused
 * for every page of a document and torn down at the end.
 */
export class Recogniser {
  private constructor(private worker: Worker) {}

  static async create(
    languages: OcrLanguage[],
    onProgress?: (fraction: number) => void,
  ): Promise<Recogniser> {
    // The logger key must always be a function. Passing `undefined` overrides
    // tesseract's default no-op rather than falling back to it, so every
    // progress tick throws "is not a function" inside the worker.
    const worker = await createWorker(languages, 1, {
      ...ASSETS,
      gzip: await langDataIsGzipped(),
      logger: (m: { status: string; progress: number }) => {
        if (onProgress && m.status === 'recognizing text') onProgress(m.progress);
      },
    });
    return new Recogniser(worker);
  }

  async recognise(canvas: HTMLCanvasElement): Promise<{ words: OcrWord[]; text: string }> {
    const { data } = await this.worker.recognize(canvas, {}, { blocks: true, text: true });
    const d = data as TessData;
    return { words: collectWords(d), text: (d.text ?? '').trim() };
  }

  async close(): Promise<void> {
    try { await this.worker.terminate(); } catch { /* already gone */ }
  }
}
