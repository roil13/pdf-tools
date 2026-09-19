import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { ToastApi } from '../App.js';
import { api, formatBytes, errorText } from '../lib/api.js';
import { useDragSensors } from '../lib/dragSensors.js';
import { buildPdfFromScans, type PageSize, type ScannedPage } from '../lib/imagesToPdf.js';
import { Notice, Preflight } from '../components/ui.js';
import { SortableCard } from '../components/FileCard.js';
import { IconSpinner, IconScan, IconRotate, IconCrop, IconRescan } from '../components/icons.js';
import { Cropper } from '../components/Cropper.js';
import { cropJpeg } from '../lib/cropImage.js';
import { FULL_CROP, isFullCrop, type CropRect } from '../lib/cropRect.js';
import { useT } from '../i18n/LocaleProvider.js';

/** The OS scanners cap a session at 24 pages; more is another session. */
const MAX_PER_SESSION = 24;

interface Page {
  id: string;
  /** The scanner's own JPEG, never re-encoded. */
  jpeg: Uint8Array;
  /** Object URL for the preview. Revoked when the page goes. */
  url: string;
  width: number;
  height: number;
  /** Quarter turns clockwise, 0-3. */
  turns: number;
  /**
   * The kept region, as fractions of the image. Applied when the PDF is written
   * rather than on every edit, so cropping stays free until it is committed and
   * can be undone by dragging the rectangle back out.
   */
  crop: CropRect;
}

let nextId = 0;

/**
 * Capture pages with the OS document scanner, then arrange and save them.
 *
 * The scanner itself is the platform's: edge detection, perspective correction,
 * multi-page capture and the crop-adjust UI all come from ML Kit or VisionKit.
 * What this screen owns is everything after the shutter -- order, rotation, and
 * turning the result into one PDF.
 *
 * Pages are held as JPEG bytes plus an object URL, never as decoded bitmaps. A
 * 24-page scan at full resolution is over a gigabyte of `ImageBitmap`, and a
 * phone is exactly where that is not affordable; an `<img>` lets the browser
 * decode lazily and drop the pixels again when it needs to.
 */
export function Scan({ toasts }: { toasts: ToastApi }) {
  const t = useT();
  const [pages, setPages] = useState<Page[]>([]);
  const [pageSize, setPageSize] = useState<PageSize>('fit');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const sensors = useDragSensors();

  // Object URLs outlive React state unless revoked, so the live set is tracked
  // in a ref and cleared on unmount as well as on removal.
  const live = useRef<Page[]>([]);
  live.current = pages;
  useEffect(() => () => { live.current.forEach((p) => URL.revokeObjectURL(p.url)); }, []);

  /**
   * Turn a scanner JPEG into a page, measuring it from an element rather than by
   * decoding to a bitmap so the full-resolution pixels are never all resident.
   */
  const toPage = useCallback(async (jpeg: Uint8Array): Promise<Omit<Page, 'id'>> => {
    const url = URL.createObjectURL(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }));
    const size = await new Promise<{ width: number; height: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = url;
    });
    return { jpeg, url, ...size, turns: 0, crop: FULL_CROP };
  }, []);

  const capture = useCallback(async () => {
    setScanning(true);
    try {
      const shots = await api.scanDocument(MAX_PER_SESSION);
      if (!shots.length) return;                 // backed out; not an error

      const added: Page[] = [];
      for (const jpeg of shots) added.push({ id: `s${++nextId}`, ...(await toPage(jpeg)) });
      setPages((prev) => [...prev, ...added]);
    } catch (err) {
      toasts.error(t('scan.toast.failed'), errorText(err, t));
    } finally {
      setScanning(false);
    }
  }, [toasts, t, toPage]);

  const remove = useCallback((id: string) => {
    setPages((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const rotate = useCallback((id: string) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, turns: (p.turns + 1) % 4 } : p)));
  }, []);

  /**
   * Photograph one page again, in place.
   *
   * The OS scanner always captures fresh -- it takes no existing image -- so
   * this needs the document to hand. Cropping what was already captured is the
   * other button, and is what to reach for when it is not.
   */
  const rescan = useCallback(async (id: string) => {
    setScanning(true);
    try {
      const shots = await api.scanDocument(1);
      if (!shots.length) return;
      const replacement = await toPage(shots[0]);
      setPages((prev) => prev.map((p) => {
        if (p.id !== id) return p;
        URL.revokeObjectURL(p.url);
        return { id: p.id, ...replacement };
      }));
    } catch (err) {
      toasts.error(t('scan.toast.failed'), errorText(err, t));
    } finally {
      setScanning(false);
    }
  }, [toPage, toasts, t]);

  const [cropping, setCropping] = useState<string | null>(null);
  const cropTarget = pages.find((p) => p.id === cropping) ?? null;

  const applyCrop = useCallback((rect: CropRect) => {
    setPages((prev) => prev.map((p) => (p.id === cropping ? { ...p, crop: rect } : p)));
    setCropping(null);
  }, [cropping]);

  const clear = useCallback(() => {
    setPages((prev) => { prev.forEach((p) => URL.revokeObjectURL(p.url)); return []; });
  }, []);

  const onDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setPages((prev) => {
      const from = prev.findIndex((p) => p.id === active.id);
      const to = prev.findIndex((p) => p.id === over.id);
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to);
    });
  }, []);

  const totalBytes = useMemo(() => pages.reduce((n, p) => n + p.jpeg.length, 0), [pages]);

  const save = useCallback(async () => {
    if (!pages.length) return;
    const output = await api.saveAs(t('scan.fileName'));
    if (!output) return;

    setBusy(true);
    try {
      // Cropping is the one thing that has to touch pixels, so it happens here
      // and only for pages that were actually cropped. Everything else embeds
      // the scanner's own JPEG untouched.
      const scans: ScannedPage[] = [];
      for (const p of pages) {
        if (isFullCrop(p.crop)) {
          scans.push({ jpeg: p.jpeg, width: p.width, height: p.height, turns: p.turns });
        } else {
          const cut = await cropJpeg(p.jpeg, p.crop);
          scans.push({ jpeg: cut.jpeg, width: cut.width, height: cut.height, turns: p.turns });
        }
      }
      // quality is unused on this path -- nothing is re-encoded -- but the
      // option bag is shared with the images pipeline.
      const bytes = await buildPdfFromScans(scans, { pageSize, margin: 0, quality: 1 });
      const written = await api.writeFile(output, bytes);

      toasts.ok(t('scan.toast.saved', { n: pages.length }), written.name,
        api.capabilities.openExternal
          ? [{ label: t('common.open'), run: () => void api.openFile(written) }]
          : undefined);
    } catch (err) {
      toasts.error(t('common.couldNotSave'), errorText(err, t));
    } finally {
      setBusy(false);
    }
  }, [pages, pageSize, toasts, t]);

  // Nothing on a desktop provides a document scanner, so the tool says so rather
  // than offering a button that cannot work. App.tsx hides it from the rail too;
  // this covers arriving here any other way.
  if (!api.capabilities.camera) {
    return (
      <main className="screen">
        <header className="screen__head">
          <div>
            <h1>{t('scan.title')}</h1>
            <p>{t('scan.blurb')}</p>
          </div>
        </header>
        <div className="screen__main">
          <Notice kind="info">{t('scan.mobileOnly')}</Notice>
        </div>
      </main>
    );
  }

  return (
    <main className="screen">
      <header className="screen__head">
        <div>
          <h1>{t('scan.title')}</h1>
          <p>{t('scan.blurb')}</p>
        </div>
        {pages.length > 0 && (
          <div className="screen__headActions">
            <button className="btn" onClick={() => void capture()} disabled={scanning}>
              {scanning ? <IconSpinner /> : <IconScan />}{t('scan.addPages')}
            </button>
            <button className="btn btn--ghost" onClick={clear}>{t('common.clear')}</button>
          </div>
        )}
      </header>

      <div className="screen__body">
        <div className="screen__main">
          {pages.length === 0 ? (
            <div className="empty">
              <div className="scan__start">
                <IconScan />
                <h2>{t('scan.empty.title')}</h2>
                <p>{t('scan.empty.hint')}</p>
                <button className="btn btn--primary" onClick={() => void capture()} disabled={scanning}>
                  {scanning ? <IconSpinner /> : <IconScan />}{t('scan.capture')}
                </button>
              </div>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                <div className="cards">
                  {pages.map((page, i) => (
                    <PageCard
                      key={page.id}
                      page={page}
                      index={i}
                      onRemove={() => remove(page.id)}
                      onRotate={() => rotate(page.id)}
                      onCrop={() => setCropping(page.id)}
                      onRescan={() => void rescan(page.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {pages.length > 0 && (
          <aside className="panel">
            <div className="field">
              <span className="field__label">{t('images.pageSize')}</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value as PageSize)}
              >
                <option value="fit">{t('images.size.fit')}</option>
                <option value="a4">{t('images.size.a4')}</option>
                <option value="letter">{t('images.size.letter')}</option>
              </select>
            </div>

            <Preflight
              rows={[
                [t('scan.pre.pages'), `${pages.length}`],
                [t('scan.pre.size'), formatBytes(totalBytes)],
              ]}
              safeNote={t('scan.pre.note')}
            />

            <div className="panel__actions">
              <button
                className="btn btn--primary btn--block"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? <IconSpinner /> : <IconScan />}
                {t('scan.action.save', { n: pages.length })}
              </button>
            </div>
          </aside>
        )}
      </div>
      {cropTarget && (
        <Cropper
          url={cropTarget.url}
          initial={cropTarget.crop}
          turns={cropTarget.turns}
          onCancel={() => setCropping(null)}
          onApply={applyCrop}
        />
      )}
    </main>
  );
}

function PageCard({
  page, index, onRemove, onRotate, onCrop, onRescan,
}: {
  page: Page; index: number;
  onRemove(): void; onRotate(): void; onCrop(): void; onRescan(): void;
}) {
  const t = useT();

  // SortableCard takes a DOM node for the thumbnail slot, so the preview is an
  // <img> built here rather than JSX. Rotation is a CSS transform: the pixels
  // are not touched until the PDF is written, and then only as a page rotation.
  const thumb = useMemo(() => {
    const img = document.createElement('img');
    img.src = page.url;
    img.alt = '';
    img.className = 'scan__thumb';
    img.style.transform = page.turns ? `rotate(${page.turns * 90}deg)` : '';
    return img;
  }, [page.url, page.turns]);

  const [w, h] = page.turns % 2 ? [page.height, page.width] : [page.width, page.height];

  return (
    <SortableCard
      id={page.id}
      index={index}
      name={t('scan.page', { n: index + 1 })}
      thumb={thumb}
      onRemove={onRemove}
      meta={
        <>
          <span>{w} × {h}</span>
          <span>{formatBytes(page.jpeg.length)}</span>
          {!isFullCrop(page.crop) && <span className="card__badge">{t('scan.cropped')}</span>}
          <button className="card__act" onClick={onRotate} title={t('scan.rotate')} aria-label={t('scan.rotate')}>
            <IconRotate />
          </button>
          <button className="card__act" onClick={onCrop} title={t('scan.crop')} aria-label={t('scan.crop')}>
            <IconCrop />
          </button>
          <button className="card__act" onClick={onRescan} title={t('scan.rescan')} aria-label={t('scan.rescan')}>
            <IconRescan />
          </button>
        </>
      }
    />
  );
}
