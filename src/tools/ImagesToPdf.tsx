import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext, arrayMove, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { ToastApi } from '../App.js';
import { useDragSensors } from '../lib/dragSensors.js';
import { api, formatBytes, errorText } from '../lib/api.js';
import type { DocRef } from '../platform/types.js';
import { decodeImage, bitmapToCanvas, bitmapToObjectUrl, type DecodedImage } from '../lib/imageDecode.js';
import { buildPdfFromImages, type PageSize } from '../lib/imagesToPdf.js';
import { DropZone, Notice, Preflight } from '../components/ui.js';
import { SortableCard } from '../components/FileCard.js';
import { IconSpinner, IconImage, IconRotate, IconCrop } from '../components/icons.js';
import { Cropper } from '../components/Cropper.js';
import { FULL_CROP, isFullCrop, type CropRect } from '../lib/cropRect.js';
import { useT } from '../i18n/LocaleProvider.js';

interface Item {
  id: string;
  name: string;
  bytes: number;
  image: DecodedImage;
  /** Quarter turns clockwise, 0-3. */
  turns: number;
  /** Region to keep, as fractions of the image. Applied when the PDF is built. */
  crop: CropRect;
}

let nextId = 0;

export function ImagesToPdf({ toasts }: { toasts: ToastApi }) {
  const t = useT();
  const [items, setItems] = useState<Item[]>([]);
  const [pageSize, setPageSize] = useState<PageSize>('fit');
  const [margin, setMargin] = useState(36);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const sensors = useDragSensors();

  // ImageBitmaps hold GPU-side memory and must be released -- but a cleanup
  // keyed on `items` would run on every list change, closing bitmaps that are
  // still on screen. Keep a ref and free them only when the screen goes away;
  // individually removed items are closed in `remove` / `clear`.
  const live = useRef<Item[]>([]);
  live.current = items;
  useEffect(() => () => { live.current.forEach((i) => i.image.bitmap.close()); }, []);

  const add = useCallback(async (refs: DocRef[]) => {
    setAdding(true);
    const added: Item[] = [];
    for (const ref of refs) {
      const name = ref.name;
      try {
        const bytes = await api.readFile(ref);
        // decodeImage sniffs HEIC/TIFF from the extension, so the display name
        // is what it needs -- not an identifier it could not parse anyway.
        const frames = await decodeImage(name, bytes);
        // A multi-page TIFF becomes one card per page rather than silently
        // contributing only its first frame.
        for (const frame of frames) {
          added.push({
            turns: 0,
            crop: FULL_CROP,
            id: `i${++nextId}`,
            name: frame.frame
              ? t('images.tiffPage', { name, n: frame.frame.index, total: frame.frame.total })
              : name,
            bytes: bytes.length,
            image: frame,
          });
        }
      } catch (err) {
        toasts.error(t('images.toast.couldNotRead', { name }), errorText(err, t));
      }
    }
    if (added.length) setItems((prev) => [...prev, ...added]);
    setAdding(false);
  }, [toasts, t]);

  const browse = useCallback(async () => {
    const picked = await api.openImages();
    if (picked.length) await add(picked);
  }, [add]);

  const onDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const from = prev.findIndex((x) => x.id === active.id);
      const to = prev.findIndex((x) => x.id === over.id);
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to);
    });
  }, []);

  /**
   * The cropper works on a URL, so the picked image is encoded to one when the
   * dialog opens and released when it closes. A scan already has JPEG bytes;
   * these are decoded bitmaps, and this is the one place they need to be neither.
   */
  const [cropping, setCropping] = useState<{ id: string; url: string } | null>(null);

  const openCrop = useCallback(async (item: Item) => {
    try {
      setCropping({ id: item.id, url: await bitmapToObjectUrl(item.image.bitmap) });
    } catch (err) {
      toasts.error(t('images.toast.couldNotCreate'), errorText(err, t));
    }
  }, [toasts, t]);

  const closeCrop = useCallback(() => {
    setCropping((prev) => { if (prev) URL.revokeObjectURL(prev.url); return null; });
  }, []);

  const applyCrop = useCallback((rect: CropRect) => {
    setItems((prev) => prev.map((i) => (i.id === cropping?.id ? { ...i, crop: rect } : i)));
    closeCrop();
  }, [cropping, closeCrop]);

  const rotate = useCallback((id: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, turns: (i.turns + 1) % 4 } : i)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      prev.find((x) => x.id === id)?.image.bitmap.close();
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setItems((prev) => { prev.forEach((i) => i.image.bitmap.close()); return []; });
  }, []);

  const totalBytes = useMemo(() => items.reduce((n, i) => n + i.bytes, 0), [items]);

  const run = useCallback(async () => {
    if (!items.length) return;
    const output = await api.saveAs('Images.pdf');
    if (!output) return;

    setBusy(true);
    try {
      const bytes = await buildPdfFromImages(
        items.map((i) => ({ ...i.image, turns: i.turns, crop: i.crop })), {
        pageSize, margin, quality: 0.92,
      });
      await api.writeFile(output, bytes);
      toasts.ok(t('images.toast.created', { n: items.length }), output.name, [
        { label: t('common.open'), run: () => void api.openFile(output) },
        { label: t('common.showInFolder'), run: () => void api.revealInFolder(output) },
      ]);
    } catch (err) {
      toasts.error(t('images.toast.couldNotCreate'), errorText(err, t));
    } finally {
      setBusy(false);
    }
  }, [items, pageSize, margin, toasts, t]);

  return (
    <main className="screen">
      <header className="screen__head">
        <div>
          <h1>{t('images.title')}</h1>
          <p>{t('images.blurb')}</p>
        </div>
        {items.length > 0 && (
          <div className="screen__headActions">
            <button className="btn" onClick={() => void browse()}>{t('images.addImages')}</button>
            <button className="btn btn--ghost" onClick={clear}>{t('common.clear')}</button>
          </div>
        )}
      </header>

      <div className="screen__body">
        <div className="screen__main">
          {items.length === 0 && !adding ? (
            <div className="empty">
              <DropZone
                accept="image"
                onFiles={(p) => void add(p)}
                onBrowse={() => void browse()}
                onReject={(m) => toasts.warn(t('common.notAdded'), m)}
                title={t('drop.images.title')}
                hint={t('drop.images.hint')}
              />
            </div>
          ) : (
            <>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  <div className="cards">
                    {items.map((item, i) => (
                      <ImageCard
                        key={item.id}
                        item={item}
                        index={i}
                        onRemove={() => remove(item.id)}
                        onRotate={() => rotate(item.id)}
                        onCrop={() => void openCrop(item)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              {adding && (
                <div className="loading loading--inline">
                  <span className="loading__icon"><IconSpinner /></span>{t('images.decoding')}
                </div>
              )}

              <div className="stack-top">
                <DropZone
                  slim
                  accept="image"
                  onFiles={(p) => void add(p)}
                  onBrowse={() => void browse()}
                  onReject={(m) => toasts.warn(t('common.notAdded'), m)}
                  title={t('drop.images.more.title')}
                  hint={t('drop.images.more.hint')}
                />
              </div>
            </>
          )}
        </div>

        {items.length > 0 && (
          <aside className="panel">
            <div className="field">
              <span className="field__label">{t('images.pageSize')}</span>
              <div className="radios" role="radiogroup" aria-label={t('images.pageSize')}>
                <label className="radio" data-on={pageSize === 'fit'}>
                  <input type="radio" name="imagePageSize" checked={pageSize === 'fit'} onChange={() => setPageSize('fit')} />
                  <span>{t('images.size.fit')}<small>{t('images.size.fitHint')}</small></span>
                </label>
                <label className="radio" data-on={pageSize === 'a4'}>
                  <input type="radio" name="imagePageSize" checked={pageSize === 'a4'} onChange={() => setPageSize('a4')} />
                  <span>{t('images.size.a4')}<small>{t('images.size.centredHint')}</small></span>
                </label>
                <label className="radio" data-on={pageSize === 'letter'}>
                  <input type="radio" name="imagePageSize" checked={pageSize === 'letter'} onChange={() => setPageSize('letter')} />
                  <span>{t('images.size.letter')}<small>{t('images.size.centredHint')}</small></span>
                </label>
              </div>
            </div>

            {pageSize !== 'fit' && (
              <div className="field">
                <label className="field__label" htmlFor="margin">{t('images.margin', { mm: Math.round(margin / 72 * 25.4) })}</label>
                <input
                  id="margin"
                  type="range"
                  min={0}
                  max={100}
                  value={margin}
                  onChange={(e) => setMargin(Number(e.target.value))}
                />
              </div>
            )}

            <Preflight
              rows={[
                [t('images.pre.images'), `${items.length}`],
                [t('images.pre.pages'), `${items.length}`],
                [t('images.pre.sourceSize'), formatBytes(totalBytes)],
              ]}
              safeNote={t('images.notice.safe')}
            />

            <Notice kind="info">{t('images.notice.jpeg')}</Notice>

            <div className="panel__actions">
              <button className="btn btn--primary btn--block" disabled={busy} onClick={() => void run()}>
                {busy ? <IconSpinner /> : <IconImage />}
                {t('images.action.create')}
              </button>
            </div>
          </aside>
        )}
      </div>
      {cropping && (() => {
        const item = items.find((i) => i.id === cropping.id);
        return item ? (
          <Cropper
            url={cropping.url}
            initial={item.crop}
            turns={item.turns}
            onCancel={closeCrop}
            onApply={applyCrop}
          />
        ) : null;
      })()}

    </main>
  );
}

/**
 * One card. The thumbnail canvas is memoised on the item id: building it in the
 * parent's JSX allocated a fresh canvas for every image on every render, and
 * dragging re-renders continuously.
 */
function ImageCard({ item, index, onRemove, onRotate, onCrop }: {
  item: Item; index: number; onRemove: () => void; onRotate: () => void; onCrop: () => void;
}) {
  const t = useT();
  const thumb = useMemo(() => {
    const canvas = bitmapToCanvas(item.image.bitmap, 60);
    // The preview turns in CSS. Nothing is redrawn until the PDF is written, and
    // then only as a page rotation -- the pixels are never touched.
    canvas.style.transform = item.turns ? `rotate(${item.turns * 90}deg)` : '';
    return canvas;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.turns]);

  // A quarter turn swaps which side is which, so the size follows the preview.
  const [w, h] = item.turns % 2
    ? [item.image.height, item.image.width]
    : [item.image.width, item.image.height];

  return (
    <SortableCard
      id={item.id}
      index={index}
      name={item.name}
      thumb={thumb}
      onRemove={onRemove}
      meta={
        <>
          <span>{w} × {h}</span>
          <span>{formatBytes(item.bytes)}</span>
          {!isFullCrop(item.crop) && <span className="card__badge">{t('scan.cropped')}</span>}
          <button
            className="card__act"
            onClick={onRotate}
            title={t('images.rotate')}
            aria-label={t('images.rotate')}
          >
            <IconRotate />
          </button>
          <button
            className="card__act"
            onClick={onCrop}
            title={t('images.crop')}
            aria-label={t('images.crop')}
          >
            <IconCrop />
          </button>
        </>
      }
    />
  );
}
