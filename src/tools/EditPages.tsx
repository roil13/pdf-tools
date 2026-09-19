import { useCallback, useMemo, useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext, arrayMove, rectSortingStrategy,
} from '@dnd-kit/sortable';
import type { SharedDocProps } from '../App.js';
import { useSharedDoc } from '../lib/useSharedDoc.js';
import { useDragSensors } from '../lib/dragSensors.js';
import { api, stripExt, errorText } from '../lib/api.js';
import { usePdfDoc } from '../lib/usePdfDoc.js';
import { parseRanges, formatRanges, complement } from '../lib/pageRanges.js';
import { normaliseDegrees } from '../lib/rotation.js';
import {
  toggleSelection, isReordered, outputPages, nextMode, type SelectionMode,
} from '../lib/selection.js';
import type { Rotation, DocRef } from '../platform/types.js';
import { DropZone, Notice, Preflight } from '../components/ui.js';
import { SortablePage } from '../components/PageGrid.js';
import { IconSpinner, IconTrash, IconCheck } from '../components/icons.js';
import { useT } from '../i18n/LocaleProvider.js';

export function EditPages({ toasts, doc, onDoc }: SharedDocProps) {
  const t = useT();
  const [source, setSource] = useState<DocRef | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [turns, setTurns] = useState<Map<number, number>>(new Map());
  const [rangeText, setRangeText] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [lastClicked, setLastClicked] = useState<number | null>(null);
  const [mode, setMode] = useState<SelectionMode>('all');
  const [busy, setBusy] = useState(false);
  /** Source page numbers in the order they will be written out. */
  const [order, setOrder] = useState<number[]>([]);

  const { loaded, loading } = usePdfDoc(source, (err) => {
    toasts.error(t('common.couldNotOpenPdf'), errorText(err, t));
    setSource(null);
    // Drop it from the shared slot too. Leaving a document there that has just
    // failed to open would hand it straight back on the next render, and to
    // every other tool after that.
    onDoc(null);
  });

  const pageCount = loaded?.info.pageCount ?? 0;

  // dnd-kit activates on Space AND Enter by default. Selection lives on Enter,
  // so without this override pressing Enter would both select the page and pick
  // it up.
  const sensors = useDragSensors({
    keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Tab'] },
  });

  const reset = useCallback(() => {
    setSelected(new Set());
    setTurns(new Map());
    setRangeText('');
    setRangeError(null);
    setLastClicked(null);
    setOrder([]);
  }, []);

  const load = useCallback(
    (refs: DocRef[]) => { reset(); setSource(refs[0]); onDoc(refs[0]); },
    [reset, onDoc],
  );
  // Pick up whatever the previous tool had open.
  useSharedDoc(doc, source?.id, load);


  // The grid's display order; falls back to natural order until a file loads.
  const pages = useMemo(
    () => (order.length === pageCount && pageCount > 0
      ? order
      : Array.from({ length: pageCount }, (_, i) => i + 1)),
    [order, pageCount],
  );

  const reordered = useMemo(() => isReordered(pages), [pages]);

  /** Keep the range box in step with the grid. */
  const syncRangeBox = useCallback((next: Set<number>) => {
    setRangeText(formatRanges([...next].sort((a, b) => a - b)));
    setRangeError(null);
  }, []);

  const toggle = useCallback((pageNum: number, shift: boolean) => {
    setSelected((prev) => {
      const next = toggleSelection({ pages, selected: prev, pageNum, shift, anchor: lastClicked });
      syncRangeBox(next);
      setMode((m) => nextMode(m, next.size));
      return next;
    });
    setLastClicked(pageNum);
  }, [lastClicked, pages, syncRangeBox]);

  const applyRangeText = useCallback((text: string) => {
    setRangeText(text);
    if (!text.trim()) {
      setSelected(new Set());
      setMode('all');
      setRangeError(null);
      return;
    }
    try {
      const next = new Set(parseRanges(text, pageCount));
      setSelected(next);
      setMode((m) => nextMode(m, next.size));
      setRangeError(null);
    } catch (err) {
      setRangeError(err instanceof Error ? err.message : String(err));
    }
  }, [pageCount]);

  const setAll = useCallback((which: 'all' | 'none' | 'invert') => {
    setSelected((prev) => {
      const next = which === 'all'
        ? new Set(Array.from({ length: pageCount }, (_, i) => i + 1))
        : which === 'none'
          ? new Set<number>()
          : new Set(complement([...prev], pageCount));
      syncRangeBox(next);
      setMode((m) => nextMode(m, next.size));
      return next;
    });
  }, [pageCount, syncRangeBox]);

  const rotate = useCallback((pageNum: number) => {
    setTurns((prev) => {
      const next = new Map(prev);
      const deg = normaliseDegrees((prev.get(pageNum) ?? 0) + 90);
      if (deg === 0) next.delete(pageNum); else next.set(pageNum, deg);
      return next;
    });
  }, []);

  const rotateSelected = useCallback((delta: 90 | -90) => {
    setTurns((prev) => {
      const next = new Map(prev);
      for (const p of selected) {
        const deg = normaliseDegrees((prev.get(p) ?? 0) + delta);
        if (deg === 0) next.delete(p); else next.set(p, deg);
      }
      return next;
    });
  }, [selected]);

  const onDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOrder(() => {
      const from = pages.findIndex((p) => `p${p}` === active.id);
      const to = pages.findIndex((p) => `p${p}` === over.id);
      return from < 0 || to < 0 ? pages : arrayMove(pages, from, to);
    });
  }, [pages]);

  /**
   * Which source pages end up in the output, in output order.
   * Order comes from the grid, not from sorting: qpdf honours "8,1-7" as a
   * sequence, so rearranging and selecting are the same operation.
   */
  const keep = useMemo(
    () => outputPages(pages, selected, mode),
    [pages, selected, mode],
  );

  const keptSet = useMemo(() => new Set(keep), [keep]);

  const rotations: Rotation[] = useMemo(
    () => [...turns].map(([page, degrees]) => ({ page, degrees: degrees as 90 | 180 | 270 })),
    [turns],
  );
  const rotatedInOutput = rotations.filter((r) => keptSet.has(r.page)).length;

  /**
   * Whether saving would actually produce anything different from the input.
   * In 'all' mode the button is a no-op without an edit, so it stays disabled
   * rather than quietly writing a byte-for-byte copy.
   */
  const hasEdits = reordered || rotatedInOutput > 0;
  const canSave = keep.length > 0 && (mode !== 'all' || hasEdits);

  /**
   * Bookmarks pointing at dropped pages become dead entries, because qpdf copies
   * the outline tree wholesale. Counting them lets the warning be specific
   * rather than a vague "bookmarks may break".
   */
  const deadBookmarks = useMemo(() => {
    if (!loaded?.info.hasOutlines) return 0;
    return loaded.info.outline.filter((o) => o.page !== null && !keptSet.has(o.page)).length;
  }, [loaded, keptSet]);

  const browse = useCallback(async () => {
    try {
      const picked = await api.openPdfs(false);
      if (picked.length) load(picked);
    } catch (err) {
      toasts.error(t('error.pickerFailed'), errorText(err, t));
    }
  }, [load, toasts, t]);

  const run = useCallback(async () => {
    if (!loaded || !canSave) return;
    const suffix = mode === 'all' ? 'rearranged' : mode === 'keep' ? 'pages' : 'trimmed';
    const suggested = `${stripExt(loaded.info.ref.name)} (${suffix}).pdf`;
    const output = await api.saveAs(suggested);
    if (!output) return;

    setBusy(true);
    try {
      const res = await api.editPages(loaded.info.ref, output, { keep, rotations, reordered });
      if (res.warnings) {
        toasts.warn(t('common.savedWithWarnings'), t('common.warningsStillWritten', { detail: res.warnings }));
      }
      const dropped = res.bookmarks?.removed ?? 0;
      toasts.ok(
        t('common.saved'),
        dropped
          ? `${output.name} · ${t('editPages.toast.bookmarksRemoved', { n: dropped })}`
          : output.name,
        [
          { label: t('common.open'), run: () => void api.openFile(output) },
          { label: t('common.showInFolder'), run: () => void api.revealInFolder(output) },
        ],
      );
    } catch (err) {
      toasts.error(t('common.couldNotSave'), errorText(err, t));
    } finally {
      setBusy(false);
    }
  }, [loaded, canSave, keep, rotations, mode, reordered, toasts, t]);

  return (
    <main className="screen">
      <header className="screen__head">
        <div>
          <h1>{t('editPages.title')}</h1>
          <p>{t('editPages.blurb')}</p>
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
              <div className="loading">
                <span className="loading__icon"><IconSpinner /></span>
                {t('common.opening')}
              </div>
            </div>
          )}

          {loaded && (
            <>
              <div className="toolbar">
                <button className="btn btn--sm" onClick={() => setAll('all')}>{t('editPages.selectAll')}</button>
                <button className="btn btn--sm" onClick={() => setAll('none')}>{t('editPages.selectNone')}</button>
                <button className="btn btn--sm" onClick={() => setAll('invert')}>{t('editPages.invert')}</button>
                <div className="toolbar__sep" />
                <button className="btn btn--sm" disabled={!selected.size} onClick={() => rotateSelected(-90)}>
                  {t('editPages.rotateLeft')}
                </button>
                <button className="btn btn--sm" disabled={!selected.size} onClick={() => rotateSelected(90)}>
                  {t('editPages.rotateRight')}
                </button>
                <div className="toolbar__sep" />
                <button
                  className="btn btn--sm"
                  title={t('editPages.reverseHint')}
                  onClick={() => setOrder([...pages].reverse())}
                >
                  {t('editPages.reverse')}
                </button>
                {reordered && (
                  <button className="btn btn--sm" onClick={() => setOrder([])}>
                    {t('editPages.resetOrder')}
                  </button>
                )}
                <div className="toolbar__grow" />
                <span className="toolbar__count">
                  {t('editPages.selectedCount', { selected: selected.size, total: pageCount })}
                  {reordered && t('editPages.reorderedSuffix')}
                </span>
              </div>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={pages.map((p) => `p${p}`)} strategy={rectSortingStrategy}>
                  <div className="grid">
                    {pages.map((n, i) => (
                      <SortablePage
                        key={n}
                        id={`p${n}`}
                        doc={loaded.doc}
                        pageNum={n}
                        position={i + 1}
                        selected={selected.has(n)}
                        cut={!keptSet.has(n)}
                        rotation={turns.get(n) ?? 0}
                        onToggle={toggle}
                        onRotate={rotate}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </>
          )}
        </div>

        {loaded && (
          <aside className="panel">
            <div className="field">
              <label className="field__label" htmlFor="ranges">{t('editPages.pagesLabel')}</label>
              <input
                id="ranges"
                type="text"
                value={rangeText}
                className={rangeError ? 'invalid' : undefined}
                placeholder={t('editPages.pagesPlaceholder')}
                onChange={(e) => applyRangeText(e.target.value)}
              />
              {rangeError
                ? <span className="field__hint field__hint--error">{rangeError}</span>
                : <span className="field__hint">{t('editPages.pagesHint')}</span>}
            </div>

            <div className="field">
              <span className="field__label">{t('editPages.whatToDo')}</span>
              <div className="radios" role="radiogroup" aria-label={t('editPages.whatToDo')}>
                <label className="radio" data-on={mode === 'all'}>
                  <input type="radio" name="editPagesMode" checked={mode === 'all'} onChange={() => setMode('all')} />
                  <span>
                    {t('editPages.mode.all')}
                    <small>{t('editPages.mode.allHint', { n: pageCount })}</small>
                  </span>
                </label>
                <label className="radio" data-on={mode === 'keep'} aria-disabled={!selected.size}>
                  <input
                    type="radio"
                    name="editPagesMode"
                    checked={mode === 'keep'}
                    disabled={!selected.size}
                    onChange={() => setMode('keep')}
                  />
                  <span>{t('editPages.mode.keep')}<small>{t('editPages.mode.keepHint')}</small></span>
                </label>
                <label className="radio" data-on={mode === 'remove'} aria-disabled={!selected.size}>
                  <input
                    type="radio"
                    name="editPagesMode"
                    checked={mode === 'remove'}
                    disabled={!selected.size}
                    onChange={() => setMode('remove')}
                  />
                  <span>{t('editPages.mode.remove')}<small>{t('editPages.mode.removeHint')}</small></span>
                </label>
              </div>
            </div>

            <Preflight
              rows={[
                [t('editPages.pre.outputPages'), keep.length
                  ? (mode === 'all'
                      ? t('editPages.pre.all', { n: keep.length })
                      : t('editPages.pre.ofTotal', { n: keep.length, total: pageCount }))
                  : t('editPages.pre.none')],
                ...(mode === 'all'
                  ? []
                  : ([[t('editPages.pre.which'), keep.length ? formatRanges(keep) : '—']] as [string, string][])),
                ...(reordered
                  ? ([[t('editPages.pre.order'), t('editPages.pre.rearranged')]] as [string, string][])
                  : []),
                ...(rotatedInOutput
                  ? ([[t('editPages.pre.rotated'), t('common.pages', { n: rotatedInOutput })]] as [string, string][])
                  : []),
                ...(loaded.info.hasOutlines
                  ? ([[t('editPages.pre.bookmarks'), deadBookmarks
                      ? t('editPages.pre.bookmarksSome', {
                          kept: loaded.info.outline.length - deadBookmarks,
                          total: loaded.info.outline.length,
                        })
                      : t('editPages.pre.bookmarksAll', { n: loaded.info.outline.length })]] as [string, string][])
                  : []),
              ]}
              safeNote={t('common.originalUntouched')}
            />

            {loaded.info.hasAcroForm && (
              <Notice kind="info">{t('editPages.notice.form')}</Notice>
            )}
            {deadBookmarks > 0 && (
              <Notice kind="info">
                {t('editPages.notice.bookmarksPruned', {
                  dead: deadBookmarks, total: loaded.info.outline.length,
                })}
              </Notice>
            )}
            {!keep.length && (
              <Notice kind="warn">
                {t(mode === 'keep' ? 'editPages.notice.selectOne' : 'editPages.notice.wouldRemoveAll')}
              </Notice>
            )}
            {mode === 'all' && keep.length > 0 && !hasEdits && (
              <Notice kind="info">{t('editPages.notice.noChanges')}</Notice>
            )}

            <div className="panel__actions">
              <button
                className={`btn btn--block ${mode === 'remove' ? 'btn--danger' : 'btn--primary'}`}
                disabled={!canSave || busy}
                onClick={() => void run()}
              >
                {busy ? <IconSpinner /> : mode === 'remove' ? <IconTrash /> : <IconCheck />}
                {mode === 'all'
                  ? t('editPages.action.saveAll', { n: keep.length })
                  : t(mode === 'keep'
                      ? 'editPages.action.saveSelected'
                      : 'editPages.action.removeAndSave')}
              </button>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
