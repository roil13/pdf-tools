import { useCallback, useMemo, useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext, arrayMove, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { ToastApi } from '../App.js';
import { useDragSensors } from '../lib/dragSensors.js';
import { api, formatBytes, stripExt, errorText } from '../lib/api.js';
import type { DocRef, DocInfo } from '../platform/types.js';
import { openDocument, renderPage, closeDocument } from '../lib/pdfRender.js';
import { DropZone, Notice, Preflight } from '../components/ui.js';
import { SortableCard, useThumb } from '../components/FileCard.js';
import { IconSpinner, IconMerge } from '../components/icons.js';
import { useT } from '../i18n/LocaleProvider.js';

interface Entry {
  id: string;
  info: DocInfo;
}

let nextId = 0;

export function Merge({ toasts }: { toasts: ToastApi }) {
  const t = useT();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [generateBookmarks, setGenerateBookmarks] = useState(true);
  const [busy, setBusy] = useState(false);

  const sensors = useDragSensors();

  const add = useCallback(async (refs: DocRef[]) => {
    const added: Entry[] = [];
    for (const ref of refs) {
      try {
        const info = await api.inspect(ref);
        if (info.isEncrypted) {
          toasts.warn(t('merge.toast.skipped'), t('merge.toast.encrypted', { name: ref.name }));
          continue;
        }
        added.push({ id: `f${++nextId}`, info });
      } catch (err) {
        toasts.error(t('merge.toast.couldNotRead', { name: ref.name }), errorText(err, t));
      }
    }
    if (added.length) setEntries((prev) => [...prev, ...added]);
  }, [toasts, t]);

  const browse = useCallback(async () => {
    const picked = await api.openPdfs(true);
    if (picked.length) await add(picked);
  }, [add]);

  const onDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setEntries((prev) => {
      const from = prev.findIndex((x) => x.id === active.id);
      const to = prev.findIndex((x) => x.id === over.id);
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to);
    });
  }, []);

  const totalPages = useMemo(
    () => entries.reduce((n, e) => n + e.info.pageCount, 0),
    [entries],
  );

  const run = useCallback(async () => {
    if (entries.length < 2) return;
    const suggested = `${stripExt(entries[0].info.ref.name)} (merged).pdf`;
    const output = await api.saveAs(suggested);
    if (!output) return;

    setBusy(true);
    try {
      const res = await api.merge(entries.map((e) => e.info.ref), output, generateBookmarks);
      if (res.warnings) {
        toasts.warn(t('common.savedWithWarnings'), t('common.warningsStillWritten', { detail: res.warnings }));
      }
      toasts.ok(t('merge.toast.merged'), output.name, [
        { label: t('common.open'), run: () => void api.openFile(output) },
        { label: t('common.showInFolder'), run: () => void api.revealInFolder(output) },
      ]);
    } catch (err) {
      toasts.error(t('merge.toast.couldNotMerge'), errorText(err, t));
    } finally {
      setBusy(false);
    }
  }, [entries, generateBookmarks, toasts, t]);

  const firstHasOutlines = entries[0]?.info.hasOutlines ?? false;
  const laterWithOutlines = entries.slice(1).filter((e) => e.info.hasOutlines).length;

  return (
    <main className="screen">
      <header className="screen__head">
        <div>
          <h1>{t('merge.title')}</h1>
          <p>{t('merge.blurb')}</p>
        </div>
        {entries.length > 0 && (
          <div className="screen__headActions">
            <button className="btn" onClick={() => void browse()}>{t('merge.addPdfs')}</button>
            <button className="btn btn--ghost" onClick={() => setEntries([])}>{t('common.clear')}</button>
          </div>
        )}
      </header>

      <div className="screen__body">
        <div className="screen__main">
          {entries.length === 0 ? (
            <div className="empty">
              <DropZone
                accept="pdf"
                onFiles={(p) => void add(p)}
                onBrowse={() => void browse()}
                onReject={(m) => toasts.warn(t('common.notAdded'), m)}
                title={t('drop.pdfs.title')}
                hint={t('drop.pdfs.hint')}
              />
            </div>
          ) : (
            <>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={entries.map((e) => e.id)} strategy={verticalListSortingStrategy}>
                  <div className="cards">
                    {entries.map((e, i) => (
                      <MergeCard
                        key={e.id}
                        entry={e}
                        index={i}
                        onRemove={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              <div className="stack-top">
                <DropZone
                  slim
                  accept="pdf"
                  onFiles={(p) => void add(p)}
                  onBrowse={() => void browse()}
                  onReject={(m) => toasts.warn(t('common.notAdded'), m)}
                  title={t('drop.pdfs.more.title')}
                  hint={t('drop.pdfs.more.hint')}
                />
              </div>
            </>
          )}
        </div>

        {entries.length > 0 && (
          <aside className="panel">
            <div className="field">
              <span className="field__label">{t('merge.bookmarksLabel')}</span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={generateBookmarks}
                  onChange={(e) => setGenerateBookmarks(e.target.checked)}
                />
                <span>
                  {t('merge.generateBookmarks')}
                  <small className="field__hint">{t('merge.generateBookmarksHint')}</small>
                </span>
              </label>
            </div>

            <Preflight
              rows={[
                [t('merge.pre.files'), `${entries.length}`],
                [t('merge.pre.totalPages'), `${totalPages}`],
                [t('merge.pre.order'), entries.length > 1 ? t('merge.pre.asListed') : '—'],
              ]}
              safeNote={t('common.originalsUntouched')}
            />

            {laterWithOutlines > 0 && (
              <Notice kind="warn">{t('merge.notice.laterBookmarks', { n: laterWithOutlines })}</Notice>
            )}
            {firstHasOutlines && (
              <Notice kind="info">{t('merge.notice.firstKeeps', { name: entries[0].info.ref.name })}</Notice>
            )}
            {entries.length < 2 && (
              <Notice kind="warn">{t('merge.notice.needMore')}</Notice>
            )}

            <div className="panel__actions">
              <button
                className="btn btn--primary btn--block"
                disabled={entries.length < 2 || busy}
                onClick={() => void run()}
              >
                {busy ? <IconSpinner /> : <IconMerge />}
                {t('merge.action.merge', { n: entries.length })}
              </button>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}

function MergeCard({ entry, index, onRemove }: { entry: Entry; index: number; onRemove: () => void }) {
  const t = useT();
  const thumb = useThumb(async () => {
    let doc = null;
    try {
      const bytes = await api.readFile(entry.info.ref);
      doc = await openDocument(bytes);
      return await renderPage(doc, 1, 46);
    } catch {
      return null; // a missing preview should never break the row
    } finally {
      // In a finally, not after the render: a failed render used to leak the
      // document and its pdf.js worker.
      await closeDocument(doc);
    }
    // Keyed on the id, not the handle: an equivalent DocRef rebuilt by the host
    // must not re-render the thumbnail. Same rule as usePdfDoc.
  }, [entry.info.ref.id]);

  return (
    <SortableCard
      id={entry.id}
      index={index}
      name={entry.info.ref.name}
      thumb={thumb}
      onRemove={onRemove}
      meta={
        <>
          <span>{t('common.pages', { n: entry.info.pageCount })}</span>
          <span>{formatBytes(entry.info.sizeBytes)}</span>
          {entry.info.hasOutlines && <span className="chip">{t('merge.chip.bookmarks')}</span>}
          {entry.info.hasAcroForm && <span className="chip">{t('merge.chip.form')}</span>}
        </>
      }
    />
  );
}
