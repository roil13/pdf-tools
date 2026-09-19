import { useCallback, useEffect, useRef, useState } from 'react';
import type { SharedDocProps } from '../App.js';
import { useSharedDoc } from '../lib/useSharedDoc.js';
import { api, formatBytes, stripExt, errorText } from '../lib/api.js';
import type { DocRef, DocInfo } from '../platform/types.js';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { openDocument, closeDocument } from '../lib/pdfRender.js';
import { UserError } from '../lib/errors.js';
import { Recogniser, type OcrLanguage } from '../lib/ocr.js';
import { addTextLayer, needsUnicodeFont, type PageWords } from '../lib/textLayer.js';
import { DropZone, Notice, Preflight } from '../components/ui.js';
import { IconSpinner, IconOcr } from '../components/icons.js';
import { useT } from '../i18n/LocaleProvider.js';

/**
 * The font used for the invisible text layer's non-Latin words. Fetched rather
 * than bundled because it is only needed when such a word actually turns up.
 */
async function loadUnicodeFont(): Promise<Uint8Array> {
  const res = await fetch('./fonts/NotoSansHebrew-Regular.ttf');
  // Without this an error page would be embedded as if it were a font, and the
  // failure would surface much later as an opaque pdf-lib error.
  if (!res.ok) throw new UserError('ocr.toast.failed');
  return new Uint8Array(await res.arrayBuffer());
}

/** Recognition resolution. 300 dpi is the usual sweet spot for scanned text. */
const DPI = 300;

interface Progress {
  page: number;
  total: number;
  phase: string;
  /** Progress within the current page, 0..1, from the recogniser. */
  within?: number;
}

export function Ocr({ toasts, doc, onDoc }: SharedDocProps) {
  const t = useT();
  const [info, setInfo] = useState<DocInfo | null>(null);
  const [languages, setLanguages] = useState<OcrLanguage[]>(['eng']);
  const [skipTextPages, setSkipTextPages] = useState(true);
  const [alsoSaveText, setAlsoSaveText] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const cancelled = useRef(false);
  /** Live resources for the current run, so unmount can free them. */
  const live = useRef<{ recogniser: Recogniser | null; doc: PDFDocumentProxy | null }>({
    recogniser: null, doc: null,
  });

  /**
   * Switching tools mid-run must not leave the tesseract worker (its WASM core
   * plus ~13 MB of language data) and the open document alive, quietly finishing
   * a job nobody is watching. The page loop checks this flag between pages, so
   * it stops at the next boundary.
   */
  useEffect(() => () => {
    cancelled.current = true;
    void live.current.recogniser?.close();
    void closeDocument(live.current.doc);
    live.current = { recogniser: null, doc: null };
  }, []);

  const load = useCallback(async (refs: DocRef[]) => {
    try {
      const next = await api.inspect(refs[0]);
      if (next.isEncrypted) throw new UserError('error.encrypted');
      setInfo(next);
      // Only once it opened: announcing a file that failed would hand the same
      // broken document to the next tool.
      onDoc(refs[0]);
    } catch (err) {
      toasts.error(t('common.couldNotOpenPdf'), errorText(err, t));
    }
  }, [toasts, t, onDoc]);
  // Pick up whatever the previous tool had open.
  useSharedDoc(doc, info?.ref.id, load);


  const browse = useCallback(async () => {
    const picked = await api.openPdfs(false);
    if (picked.length) await load(picked);
  }, [load]);

  const toggleLang = useCallback((lang: OcrLanguage) => {
    setLanguages((prev) => {
      const next = prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang];
      return next.length ? next : prev; // never leave zero languages selected
    });
  }, []);

  const run = useCallback(async () => {
    if (!info) return;

    const output = await api.saveAs(`${stripExt(info.ref.name)} (searchable).pdf`);
    if (!output) return;

    cancelled.current = false;
    setProgress({ page: 0, total: info.pageCount, phase: t('ocr.phase.starting') });

    let recogniser: Recogniser | null = null;
    let doc = null;

    try {
      const bytes = await api.readFile(info.ref);
      doc = await openDocument(bytes);
      live.current.doc = doc;

      setProgress({ page: 0, total: info.pageCount, phase: t('ocr.phase.loading') });
      recogniser = await Recogniser.create(languages, (fraction) => {
        setProgress((p) => (p ? { ...p, within: fraction } : p));
      });
      live.current.recogniser = recogniser;

      const pages: PageWords[] = [];
      const textParts: string[] = [];
      let skipped = 0;

      for (let pageNum = 1; pageNum <= info.pageCount; pageNum++) {
        if (cancelled.current) break;
        setProgress({ page: pageNum, total: info.pageCount, phase: t('ocr.phase.reading'), within: 0 });

        const page = await doc.getPage(pageNum);

        // Re-running on an already-searchable page would stack a second text
        // layer on top of the first, so skip pages that already have text.
        if (skipTextPages) {
          const existing = await page.getTextContent();
          if (existing.items.length > 0) { skipped++; continue; }
        }

        const viewport = page.getViewport({ scale: DPI / 72 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new UserError('error.noCanvas');

        try {
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;

          const { words, text } = await recogniser.recognise(canvas);
          if (text) textParts.push(text);

          pages.push({
            pageNum,
            words,
            // Handles page rotation and scale in one step.
            toPdfPoint: (x, y) => viewport.convertToPdfPoint(x, y) as [number, number],
            scale: DPI / 72,
            rotation: page.rotate ?? 0,
          });
        } finally {
          // A 300 dpi page is ~34 MB; a throw must not strand it.
          canvas.width = 0;
          canvas.height = 0;
        }
      }

      if (cancelled.current) {
        toasts.info(t('common.cancelled'), t('common.nothingSaved'));
        return;
      }

      const recognised = pages.reduce((n, p) => n + p.words.length, 0);
      if (!recognised) {
        toasts.warn(
          t('ocr.toast.noText'),
          t(skipped === info.pageCount ? 'ocr.toast.allHadText' : 'ocr.toast.nothingLegible'),
        );
        return;
      }

      setProgress({ page: info.pageCount, total: info.pageCount, phase: t('ocr.phase.writing') });

      // Keyed on what was actually recognised, not on which language box is
      // ticked: without a Unicode font the text layer silently drops every
      // non-Latin word, and a searchable PDF missing its Hebrew is a worse
      // outcome than a slightly larger download.
      // Same predicate the text layer itself uses, so the two cannot drift.
      const needsFont = pages.some((p) => p.words.some((w) => needsUnicodeFont(w.text)));
      const fontBytes = needsFont ? await loadUnicodeFont() : null;

      const out = await addTextLayer(bytes, pages, fontBytes);
      await api.writeFile(output, out);

      if (alsoSaveText) {
        // Null when a companion file would collide with the PDF just written.
        // The host owns that rule, because it owns what an identifier means.
        const txt = api.siblingWithExtension(output, 'txt');
        if (txt) {
          await api.writeFile(txt, new TextEncoder().encode(textParts.join('\n\n')));
        }
      }

      const parts = [output.name];
      if (skipped) parts.push(t('ocr.toast.skipped', { n: skipped }));
      if (alsoSaveText) parts.push(t('ocr.toast.alsoSaved'));
      toasts.ok(
        t('ocr.toast.recognised', { n: recognised }),
        parts.join(' · '),
        [
          { label: t('common.open'), run: () => void api.openFile(output) },
          { label: t('common.showInFolder'), run: () => void api.revealInFolder(output) },
        ],
      );
    } catch (err) {
      // Tearing the run down mid-page rejects whatever was in flight -- the
      // recogniser is terminated under it. That is cancellation working, not a
      // failure, and reporting it would tell someone who navigated away that
      // their document could not be processed.
      if (!cancelled.current) toasts.error(t('ocr.toast.failed'), errorText(err, t));
    } finally {
      await recogniser?.close();
      await closeDocument(doc);
      live.current = { recogniser: null, doc: null };
      setProgress(null);
    }
  }, [info, languages, skipTextPages, alsoSaveText, toasts, t]);

  const running = progress !== null;
  const pct = progress && progress.total
    // Blend in within-page progress, otherwise the bar sits still for seconds
    // at a time on a slow page.
    ? Math.min(100, ((Math.max(0, progress.page - 1) + (progress.within ?? 0)) / progress.total) * 100)
    : 0;

  return (
    <main className="screen">
      <header className="screen__head">
        <div>
          <h1>{t('ocr.title')}</h1>
          <p>{t('ocr.blurb')}</p>
        </div>
        {info && !running && (
          <div className="screen__headActions">
            <button className="btn" onClick={() => void browse()}>{t('common.openAnother')}</button>
          </div>
        )}
      </header>

      <div className="screen__body">
        <div className="screen__main">
          <div className="empty">
            {!info ? (
              <DropZone
                accept="pdf"
                single
                onFiles={(p) => void load(p)}
                onBrowse={() => void browse()}
                onReject={(m) => toasts.warn(t('common.notAdded'), m)}
                title={t('drop.scan.title')}
                hint={t('drop.pdf.hint')}
              />
            ) : (
              <div className="bigfile">
                <div className="bigfile__name"><bdi>{info.ref.name}</bdi></div>
                <div className="bigfile__meta">
                  {t('common.pages', { n: info.pageCount })} · {formatBytes(info.sizeBytes)}
                </div>

                {running && (
                  <div className="runbox">
                    <div className="progress">
                      <div className="progress__bar" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="runbox__label">
                      {progress.page
                        ? t('ocr.progress', {
                            phase: progress.phase, page: progress.page, total: progress.total,
                          })
                        : progress.phase}
                    </div>
                    <button className="btn btn--sm" onClick={() => { cancelled.current = true; }}>
                      {t('common.cancel')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {info && (
          <aside className="panel">
            <div className="field">
              <span className="field__label">{t('ocr.languages')}</span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={languages.includes('eng')}
                  disabled={running}
                  onChange={() => toggleLang('eng')}
                />
                <span>{t('ocr.english')}</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={languages.includes('heb')}
                  disabled={running}
                  onChange={() => toggleLang('heb')}
                />
                <span>{t('ocr.hebrew')}</span>
              </label>
              <span className="field__hint">{t('ocr.languagesHint')}</span>
            </div>

            <div className="field">
              <span className="field__label">{t('ocr.options')}</span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={skipTextPages}
                  disabled={running}
                  onChange={(e) => setSkipTextPages(e.target.checked)}
                />
                <span>
                  {t('ocr.skipText')}
                  <small className="field__hint">{t('ocr.skipTextHint')}</small>
                </span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={alsoSaveText}
                  disabled={running}
                  onChange={(e) => setAlsoSaveText(e.target.checked)}
                />
                <span>
                  {t('ocr.alsoText')}
                  <small className="field__hint">{t('ocr.alsoTextHint')}</small>
                </span>
              </label>
            </div>

            <Preflight
              rows={[
                [t('ocr.pre.pages'), `${info.pageCount}`],
                [t('ocr.pre.resolution'), `${DPI} dpi`],
                [t('ocr.pre.languages'),
                  languages.map((l) => t(l === 'eng' ? 'ocr.english' : 'ocr.hebrew')).join(' + ')],
              ]}
              safeNote={t('common.originalUntouched')}
            />

            <Notice kind="info">{t('ocr.notice.time')}</Notice>

            <div className="panel__actions">
              <button className="btn btn--primary btn--block" disabled={running} onClick={() => void run()}>
                {running ? <IconSpinner /> : <IconOcr />}
                {t(running ? 'ocr.action.working' : 'ocr.action.run')}
              </button>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
