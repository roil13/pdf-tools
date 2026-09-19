import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPageBitmap, documentId } from '../lib/pdfRender.js';
import { renderCache, pageKey } from '../lib/renderCache.js';
import { useT } from '../i18n/LocaleProvider.js';

/* ------------------------------------------------------------------ outline */

export interface OutlineNode {
  title: string;
  /** 1-indexed, or null when the destination could not be resolved. */
  page: number | null;
  url: string | null;
  depth: number;
}

/**
 * Flatten pdf.js's outline tree, resolving each destination to a page number.
 *
 * Destinations come in three shapes -- a named string, an explicit array, or
 * nothing at all -- and a bookmark that resolves to none of them is kept rather
 * than dropped: an un-clickable chapter heading is still a useful label, and
 * silently losing it would make the sidebar disagree with the document.
 */
export async function readOutline(doc: PDFDocumentProxy): Promise<OutlineNode[]> {
  const raw = await doc.getOutline();
  if (!raw?.length) return [];

  const out: OutlineNode[] = [];

  const resolve = async (dest: unknown): Promise<number | null> => {
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || !explicit.length) return null;
      return (await doc.getPageIndex(explicit[0] as never)) + 1;
    } catch {
      return null;
    }
  };

  const walk = async (items: Awaited<ReturnType<typeof doc.getOutline>>, depth: number) => {
    for (const item of items ?? []) {
      out.push({
        title: item.title || '',
        page: await resolve(item.dest),
        url: item.url ?? null,
        depth,
      });
      if (item.items?.length) await walk(item.items, depth + 1);
    }
  };

  await walk(raw, 0);
  return out;
}

function Outline({
  nodes, currentPage, onGo,
}: { nodes: OutlineNode[]; currentPage: number; onGo(page: number): void }) {
  const t = useT();
  if (!nodes.length) return <p className="rside__empty">{t('reader.outline.none')}</p>;

  // The deepest entry at or before the current page is the one the reader is in.
  let active = -1;
  nodes.forEach((n, i) => {
    if (n.page !== null && n.page <= currentPage) active = i;
  });

  return (
    <ul className="routline">
      {nodes.map((n, i) => (
        <li key={i} style={{ paddingInlineStart: `${n.depth * 14}px` }}>
          <button
            className="routline__item"
            aria-current={i === active}
            disabled={n.page === null}
            onClick={() => n.page !== null && onGo(n.page)}
          >
            <bdi>{n.title}</bdi>
            {n.page !== null && <span className="routline__page">{n.page}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------------------------------------- thumbnails */

const THUMB_WIDTH = 116;

function Thumb({
  doc, pageNum, current, onGo,
}: { doc: PDFDocumentProxy; pageNum: number; current: boolean; onGo(page: number): void }) {
  const host = useRef<HTMLCanvasElement | null>(null);
  const box = useRef<HTMLButtonElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = box.current;
    const canvas = host.current;
    if (!el || !canvas) return;
    const ctrl = new AbortController();

    // Only rasterise what the rail actually shows: a 500-page document would
    // otherwise render 500 thumbnails the moment the panel opens.
    const io = new IntersectionObserver(async ([entry], obs) => {
      if (!entry.isIntersecting) return;
      obs.disconnect();
      try {
        const page = await doc.getPage(pageNum);
        const natural = page.getViewport({ scale: 1 });
        const scale = THUMB_WIDTH / natural.width;
        const key = pageKey(`${documentId(doc)}~thumb`, pageNum, scale, 0);

        let bitmap = renderCache.get(key);
        if (!bitmap) {
          const made = await renderPageBitmap(doc, pageNum, scale, 0, ctrl.signal);
          if (!made) return;
          renderCache.set(key, made);
          bitmap = made;
        }
        if (ctrl.signal.aborted) return;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.style.width = `${THUMB_WIDTH}px`;
        canvas.style.height = `${Math.round(natural.height * scale)}px`;
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        setReady(true);
      } catch {
        // Scrolled away mid-render.
      }
    }, { rootMargin: '400px' });

    io.observe(el);
    return () => { io.disconnect(); ctrl.abort(); };
  }, [doc, pageNum]);

  return (
    <button
      ref={box}
      className="rthumb"
      aria-current={current}
      onClick={() => onGo(pageNum)}
    >
      <canvas ref={host} className="rthumb__canvas" data-ready={ready} />
      <span className="rthumb__n">{pageNum}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ sidebar */

export type SidebarTab = 'outline' | 'thumbs';

export function Sidebar({
  doc, nodes, currentPage, tab, onTab, onGo,
}: {
  doc: PDFDocumentProxy;
  nodes: OutlineNode[];
  currentPage: number;
  tab: SidebarTab;
  onTab(tab: SidebarTab): void;
  onGo(page: number): void;
}) {
  const t = useT();
  const listRef = useRef<HTMLDivElement | null>(null);

  // Follow the viewer, but only when the rail is open -- scrolling a hidden
  // panel is wasted layout on every scroll event.
  useEffect(() => {
    if (tab !== 'thumbs') return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-thumb="${currentPage}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [currentPage, tab]);

  return (
    <aside className="rside" aria-label={t('reader.sidebar.label')}>
      <div className="rside__tabs" role="tablist">
        <button
          role="tab" aria-selected={tab === 'outline'}
          onClick={() => onTab('outline')}
        >{t('reader.sidebar.outline')}</button>
        <button
          role="tab" aria-selected={tab === 'thumbs'}
          onClick={() => onTab('thumbs')}
        >{t('reader.sidebar.thumbnails')}</button>
      </div>

      <div className="rside__body" ref={listRef}>
        {tab === 'outline'
          ? <Outline nodes={nodes} currentPage={currentPage} onGo={onGo} />
          : (
            <div className="rthumbs">
              {Array.from({ length: doc.numPages }, (_, i) => (
                <div key={i + 1} data-thumb={i + 1}>
                  <Thumb doc={doc} pageNum={i + 1} current={currentPage === i + 1} onGo={onGo} />
                </div>
              ))}
            </div>
          )}
      </div>
    </aside>
  );
}
