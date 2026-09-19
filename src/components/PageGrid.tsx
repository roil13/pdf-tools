import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPage } from '../lib/pdfRender.js';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconCheck, IconRotate } from './icons.js';
import { useT } from '../i18n/LocaleProvider.js';

interface PageThumbProps {
  doc: PDFDocumentProxy;
  pageNum: number;
  selected: boolean;
  /** Renders the page dimmed to show it will be dropped. */
  cut?: boolean;
  rotation: number;
  onToggle: (pageNum: number, shift: boolean) => void;
  onRotate?: (pageNum: number) => void;
  /** Position in the output, shown when it differs from the source page. */
  position?: number;
  /** Supplied by SortablePage when the grid is rearrangeable. */
  drag?: {
    setNodeRef: (el: HTMLElement | null) => void;
    style?: React.CSSProperties;
    attributes?: React.HTMLAttributes<HTMLElement>;
    listeners?: Record<string, unknown>;
    dragging?: boolean;
  };
}

/**
 * One page thumbnail. Rendering is deferred until the tile is near the viewport
 * -- a 500-page document would otherwise stall the grid rasterising pages that
 * nobody has scrolled to.
 */
export function PageThumb({
  doc, pageNum, selected, cut, rotation, onToggle, onRotate, position, drag,
}: PageThumbProps) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    let canvas: HTMLCanvasElement | null = null;

    renderPage(doc, pageNum, 130, ctrl.signal).then((c) => {
      if (!c || ctrl.signal.aborted || !host.current) return;
      canvas = c;
      host.current.replaceChildren(c);
    }).catch(() => {
      // A thumbnail that will not draw leaves an empty tile, which is a far
      // better outcome than an unhandled rejection. This happens routinely when
      // a new document is opened while the previous one is still on screen.
    });

    return () => { ctrl.abort(); canvas?.remove(); };
  }, [doc, pageNum, visible]);

  return (
    <div
      ref={drag?.setNodeRef}
      className="page"
      data-sel={selected}
      data-cut={cut ?? false}
      data-dragging={drag?.dragging ?? false}
      style={drag?.style}
      role="checkbox"
      aria-checked={selected}
      aria-label={
        position && position !== pageNum
          ? t('editPages.pageMoved', { n: pageNum, pos: position })
          : t('editPages.page', { n: pageNum })
      }
      tabIndex={0}
      {...(drag?.attributes ?? {})}
      {...(drag?.listeners ?? {})}
      onClick={(e) => onToggle(pageNum, e.shiftKey)}
      onKeyDown={(e) => {
        // dnd-kit's keyboard sensor arrives via `listeners`, which is spread
        // above -- so this handler must call it through rather than replace it.
        // Later JSX props win, and clobbering it kills keyboard reordering
        // while leaving mouse dragging (onPointerDown) working.
        (drag?.listeners?.onKeyDown as ((ev: React.KeyboardEvent) => void) | undefined)?.(e);
        // Enter selects; Space belongs to dnd-kit for picking a page up.
        if (e.key === 'Enter') { e.preventDefault(); onToggle(pageNum, e.shiftKey); }
      }}
    >
      <div className="page__badge"><IconCheck /></div>
      <div
        className="page__canvas"
        ref={host}
        style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
      />
      <div className="page__foot">
        <span className="page__num">{pageNum}</span>
        {/* Only shown once a page has actually moved, so an untouched
            document stays uncluttered. */}
        {position !== undefined && position !== pageNum && (
          <span className="chip chip--moved" title={t('editPages.pageMoved', { n: pageNum, pos: position })}>
            <span className="chip__arrow">&rarr;</span>&nbsp;{position}
          </span>
        )}
        {rotation !== 0 && <span className="chip">{rotation}&deg;</span>}
        {onRotate && (
          <span className="page__tools">
            <button
              className="iconbtn"
              title={t('editPages.rotateTitle')}
              aria-label={t('editPages.rotatePage', { n: pageNum })}
              onClick={(e) => { e.stopPropagation(); onRotate(pageNum); }}
            >
              <IconRotate />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A PageThumb that can be dragged to a new position.
 *
 * Drag listeners sit on the whole tile rather than a small handle, because a
 * page grid is grabbed anywhere. The PointerSensor's distance constraint is
 * what keeps a plain click working as "select" instead of starting a drag.
 */
export function SortablePage(props: PageThumbProps & { id: string }) {
  const { id, ...rest } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    // dnd-kit defaults to role="button" and its attributes are spread AFTER the
    // tile's own, so without this it silently overrode role="checkbox" and
    // aria-checked became meaningless -- the selection state was never
    // announced. Telling dnd-kit the real role also stops it emitting
    // aria-pressed, which only applies to its default role.
    attributes: { role: 'checkbox', roleDescription: 'page' },
  });

  return (
    <PageThumb
      {...rest}
      drag={{
        setNodeRef,
        style: {
          transform: CSS.Transform.toString(transform),
          transition,
          zIndex: isDragging ? 2 : undefined,
        },
        attributes,
        listeners,
        dragging: isDragging,
      }}
    />
  );
}
