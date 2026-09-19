import { useCallback, useMemo, useState } from 'react';
import type { SharedDocProps } from '../App.js';
import { useSharedDoc } from '../lib/useSharedDoc.js';
import { api, stripExt, errorText } from '../lib/api.js';
import type { DocRef, DestRef } from '../platform/types.js';
import { usePdfDoc } from '../lib/usePdfDoc.js';
import { planSplit, formatRanges, type SplitMode } from '../lib/pageRanges.js';
import { safeName, uniquify, padIndex } from '../lib/safeName.js';
import { DropZone, Notice, Preflight } from '../components/ui.js';
import { PageThumb } from '../components/PageGrid.js';
import { IconSpinner, IconSplit, IconFolder } from '../components/icons.js';
import { useT } from '../i18n/LocaleProvider.js';

export function Split({ toasts, doc, onDoc }: SharedDocProps) {
  const t = useT();
  const [source, setSource] = useState<DocRef | null>(null);
  const [mode, setMode] = useState<SplitMode>('points');
  const [points, setPoints] = useState<Set<number>>(new Set());
  const [size, setSize] = useState(10);
  const [outputDir, setOutputDir] = useState<DestRef | null>(null);
  const [busy, setBusy] = useState(false);

  const { loaded, loading } = usePdfDoc(source, (err) => {
    toasts.error(t('common.couldNotOpenPdf'), errorText(err, t));
    setSource(null);
    // Drop it from the shared slot too. Leaving a document there that has just
    // failed to open would hand it straight back on the next render, and to
    // every other tool after that.
    onDoc(null);
  });

  const pageCount = loaded?.info.pageCount ?? 0;
  const stem = loaded ? stripExt(loaded.info.ref.name) : '';

  /** Top-level bookmarks that resolve to a page, which is all we can split at. */
  const topBookmarks = useMemo(
    () => (loaded?.info.outline ?? [])
      .filter((o) => o.depth === 0 && o.page !== null)
      .map((o) => ({ title: o.title, page: o.page as number })),
    [loaded],
  );

  const load = useCallback((refs: DocRef[]) => {
    setPoints(new Set());
    // Back to a mode every document supports: keeping "at bookmarks" selected
    // for a file that has none leaves a disabled radio checked, with an error
    // where the file list should be.
    setMode('points');
    setSource(refs[0]);
    onDoc(refs[0]);
  }, [onDoc]);
  // Pick up whatever the previous tool had open.
  useSharedDoc(doc, source?.id, load);


  const browse = useCallback(async () => {
    const picked = await api.openPdfs(false);
    if (picked.length) load(picked);
  }, [load]);

  /** Clicking a page marks it as the START of a new part. */
  const togglePoint = useCallback((pageNum: number) => {
    if (pageNum === 1) return; // page 1 always starts the first part
    setPoints((prev) => {
      const next = new Set(prev);
      if (next.has(pageNum)) next.delete(pageNum); else next.add(pageNum);
      return next;
    });
  }, []);

  /** The concrete file list, computed before anything is written. */
  const plan = useMemo(() => {
    if (!loaded) return { parts: [] as { pages: number[]; fileName: string }[], error: null as string | null };
    try {
      const raw = planSplit(mode, {
        points: [...points],
        size,
        bookmarkStarts: topBookmarks,
      }, pageCount);

      const labels = mode === 'bookmarks'
        ? uniquify(raw.map((p, i) => safeName(p.label, `part ${i + 1}`)))
        : raw.map((_, i) => `${stem} ${padIndex(i + 1, raw.length)}`);

      return {
        parts: raw.map((p, i) => ({ pages: p.pages, fileName: `${labels[i]}.pdf` })),
        error: null,
      };
    } catch (err) {
      return { parts: [], error: err instanceof Error ? err.message : String(err) };
    }
  }, [loaded, mode, points, size, topBookmarks, pageCount, stem]);

  const chooseFolder = useCallback(async () => {
    const dir = await api.chooseFolder();
    if (dir) setOutputDir(dir);
  }, []);

  const run = useCallback(async () => {
    if (!loaded || !plan.parts.length) return;

    let dir = outputDir;
    if (!dir) {
      dir = await api.chooseFolder();
      if (!dir) return;
      setOutputDir(dir);
    }

    // Splitting writes many files at once, so check for collisions up front
    // rather than letting the run clobber things halfway through.
    // The main process joins the path, so this check and the write that follows
    // agree by construction. A hand-built separator disagrees when `dir` already
    // ends in one, such as a drive root.
    const clashes: string[] = [];
    for (const p of plan.parts) {
      if (await api.existsIn(dir, p.fileName)) clashes.push(p.fileName);
    }
    if (clashes.length) {
      toasts.error(
        t('split.toast.clash', { n: clashes.length }),
        t('split.toast.clashBody', {
          names: clashes.slice(0, 3).join(', ')
            + (clashes.length > 3 ? t('split.toast.clashAndMore', { n: clashes.length - 3 }) : ''),
        }),
      );
      return;
    }

    setBusy(true);
    try {
      const res = await api.split(loaded.info.ref, dir, plan.parts);
      if (res.warnings) toasts.warn(t('split.toast.warnings'), res.warnings);
      toasts.ok(t('split.toast.wrote', { n: res.outputs.length }), dir.name, [
        { label: t('common.showInFolder'), run: () => void api.revealInFolder(res.outputs[0]) },
      ]);
    } catch (err) {
      toasts.error(t('split.toast.couldNotSplit'), errorText(err, t));
    } finally {
      setBusy(false);
    }
  }, [loaded, plan, outputDir, toasts, t]);

  const modeOptions: { id: SplitMode; label: string; hint: string; disabled?: boolean }[] = [
    { id: 'points', label: t('split.mode.points'), hint: t('split.mode.pointsHint') },
    { id: 'every', label: t('split.mode.every'), hint: t('split.mode.everyHint') },
    { id: 'each', label: t('split.mode.each'), hint: t('split.mode.eachHint', { n: pageCount }) },
    {
      id: 'bookmarks',
      label: t('split.mode.bookmarks'),
      hint: topBookmarks.length
        ? t('split.mode.bookmarksHint', { n: topBookmarks.length })
        : t('split.mode.bookmarksNone'),
      disabled: topBookmarks.length === 0,
    },
  ];

  return (
    <main className="screen">
      <header className="screen__head">
        <div>
          <h1>{t('split.title')}</h1>
          <p>{t('split.blurb')}</p>
        </div>
        {loaded && (
          <div className="screen__headActions">
            <button className="btn" onClick={() => void browse()}>{t('common.openAnother')}</button>
          </div>
        )}
      </header>

      <div className="screen__body">
        <div className="screen__main">
          {!loaded && !loading && (
            <div className="empty">
              <DropZone
                accept="pdf"
                single
                onFiles={load}
                onBrowse={() => void browse()}
                onReject={(m) => toasts.warn(t('common.notAdded'), m)}
                title={t('drop.pdf.title')}
                hint={t('drop.pdf.hint')}
              />
            </div>
          )}

          {loading && (
            <div className="empty">
              <div className="loading"><span className="loading__icon"><IconSpinner /></span>{t('common.opening')}</div>
            </div>
          )}

          {loaded && (
            <>
              <div className="toolbar">
                <span className="toolbar__count">
                  {t(mode === 'points' ? 'split.clickToSplit' : 'split.previewOnly')}
                </span>
                {mode === 'points' && points.size > 0 && (
                  <>
                    <div className="toolbar__grow" />
                    <button className="btn btn--sm" onClick={() => setPoints(new Set())}>
                      {t('split.clearPoints')}
                    </button>
                  </>
                )}
              </div>

              <div className="grid">
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                  <PageThumb
                    key={n}
                    doc={loaded.doc}
                    pageNum={n}
                    selected={mode === 'points' && points.has(n)}
                    rotation={0}
                    onToggle={(p) => { if (mode === 'points') togglePoint(p); }}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {loaded && (
          <aside className="panel">
            <div className="field">
              <span className="field__label">{t('split.howLabel')}</span>
              <div className="radios" role="radiogroup" aria-label={t('split.howLabel')}>
                {modeOptions.map((o) => (
                  <label
                    key={o.id}
                    className="radio"
                    data-on={mode === o.id}
                    aria-disabled={o.disabled}
                  >
                    <input
                      type="radio"
                      name="splitMode"
                      checked={mode === o.id}
                      disabled={o.disabled}
                      onChange={() => setMode(o.id)}
                    />
                    <span>{o.label}<small>{o.hint}</small></span>
                  </label>
                ))}
              </div>
            </div>

            {mode === 'every' && (
              <div className="field">
                <label className="field__label" htmlFor="chunk">{t('split.perFile')}</label>
                <input
                  id="chunk"
                  type="number"
                  min={1}
                  max={pageCount}
                  value={size}
                  onChange={(e) => setSize(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            )}

            <div className="field">
              <span className="field__label">{t('split.saveInto')}</span>
              <button className="btn btn--block" onClick={() => void chooseFolder()}>
                <IconFolder />
                {outputDir ? <bdi>{outputDir.name}</bdi> : t('split.chooseFolder')}
              </button>
              {outputDir && <span className="field__hint" title={outputDir.id}><bdi>{outputDir.id}</bdi></span>}
            </div>

            {plan.error ? (
              <Notice kind="warn">{plan.error}</Notice>
            ) : (
              <>
                <div className="field">
                  <span className="field__label">{t('split.filesToCreate', { n: plan.parts.length })}</span>
                  <div className="filelist">
                    {plan.parts.slice(0, 60).map((p) => (
                      <div className="filelist__row" key={p.fileName}>
                        <span className="filelist__name" title={p.fileName}><bdi>{p.fileName}</bdi></span>
                        <span className="filelist__pages">{formatRanges(p.pages)}</span>
                      </div>
                    ))}
                    {plan.parts.length > 60 && (
                      <div className="filelist__row">
                        <span className="filelist__name">{t('split.andMore', { n: plan.parts.length - 60 })}</span>
                      </div>
                    )}
                  </div>
                </div>

                <Preflight
                  rows={[[t('split.pre.files'), `${plan.parts.length}`], [t('split.pre.totalPages'), `${pageCount}`]]}
                  safeNote={t('common.newFilesWritten')}
                />
              </>
            )}

            <div className="panel__actions">
              <button
                className="btn btn--primary btn--block"
                disabled={!plan.parts.length || busy}
                onClick={() => void run()}
              >
                {busy ? <IconSpinner /> : <IconSplit />}
                {t('split.action.split', { n: plan.parts.length })}
              </button>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
