import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pageSize } from '../lib/pdfRender.js';
import {
  layoutPages, visibleRange, pageAtScroll, scaleFor, clampScale, scrollToPage,
  scrollAfterZoom, type PageSize, type ZoomMode,
} from '../lib/readerLayout.js';
import { PageView, type PageApi } from './PageView.js';
import type { Match } from './search.js';
import type { Annotation, AnnotKind, Quad, Point } from './annotations.js';
import { newId } from './annotations.js';

/** Gap between pages, and the padding around the whole stack. */
const GAP = 16;
/** Extra pixels rendered above and below the viewport. */
const OVERSCAN = 600;

export interface ViewerHandle {
  goToPage(page: number): void;
  /** Scroll a match into view, centring it rather than putting it at the very top. */
  revealMatch(match: Match): void;
  /**
   * Turn the current text selection into annotations, one per page it covers.
   * Returns an empty array when nothing is selected.
   */
  annotateSelection(kind: AnnotKind, color: string): Annotation[];
}

interface ViewerProps {
  doc: PDFDocumentProxy;
  zoom: ZoomMode;
  rotation: number;
  matches: Match[];
  activeMatch: Match | null;
  annotations: Annotation[];
  formValues: Record<string, string>;
  formEditing: boolean;
  onFormChange(name: string, value: string): void;
  /** Set while the note tool is armed; a click then places one. */
  noteMode: boolean;
  onPlaceNote(page: number, point: Point, clientX: number, clientY: number): void;
  onFollowLink(page: number): void;
  inkMode: boolean;
  onInkStroke(page: number, stroke: Point[]): void;
  onPageChange(page: number): void;
  onScaleChange(scale: number): void;
  /** A pinch or ctrl+wheel, which turns the zoom mode into a fixed scale. */
  onZoomTo(scale: number): void;
}

/**
 * Measure every page.
 *
 * Page one is measured first and used as the assumed size for the rest, so the
 * scrollbar is approximately right immediately rather than growing as pages
 * resolve. The remainder is measured in the background; on a 500-page document
 * awaiting all of them before the first paint is several seconds of blank screen.
 */
function usePageSizes(doc: PDFDocumentProxy): { sizes: PageSize[]; measured: boolean } {
  const [state, setState] = useState<{ sizes: PageSize[]; measured: boolean }>({
    sizes: [], measured: false,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ sizes: [], measured: false });

    void (async () => {
      // Sizes are measured WITHOUT the view rotation and rotated arithmetically
      // below, so turning the page costs no re-measurement.
      const first = await pageSize(doc, 1, 0);
      if (cancelled) return;
      setState({ sizes: Array(doc.numPages).fill(first), measured: doc.numPages === 1 });

      const sizes = Array<PageSize>(doc.numPages).fill(first);
      for (let p = 2; p <= doc.numPages; p++) {
        sizes[p - 1] = await pageSize(doc, p, 0);
        if (cancelled) return;
        // Publish in batches: a setState per page on a long document costs more
        // than the measuring does.
        if (p % 25 === 0) setState({ sizes: [...sizes], measured: false });
      }
      if (!cancelled) setState({ sizes, measured: true });
    })();

    return () => { cancelled = true; };
  }, [doc]);

  return state;
}

export const Viewer = forwardRef<ViewerHandle, ViewerProps>(function Viewer(
  {
    doc, zoom, rotation, matches, activeMatch, annotations,
    formValues, formEditing, onFormChange, noteMode, onPlaceNote, onFollowLink, inkMode, onInkStroke,
    onPageChange, onScaleChange, onZoomTo,
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** Mounted pages, so a selection can be resolved to PDF coordinates. */
  const pagesRef = useRef(new Map<number, PageApi>());
  const register = useCallback((pageNum: number, api: PageApi | null) => {
    if (api) pagesRef.current.set(pageNum, api);
    else pagesRef.current.delete(pageNum);
  }, []);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const { sizes } = usePageSizes(doc);

  // A quarter turn swaps the axes; measuring again would tell us the same thing.
  const rotated = useMemo<PageSize[]>(() => (
    rotation % 180 === 0
      ? sizes
      : sizes.map((s) => ({ width: s.height, height: s.width }))
  ), [sizes, rotation]);

  const scale = useMemo(
    () => clampScale(scaleFor(
      zoom,
      { width: Math.max(0, viewport.width - GAP * 2), height: Math.max(0, viewport.height - GAP * 2) },
      rotated[0],
    )),
    [zoom, viewport, rotated],
  );

  const layout = useMemo(() => layoutPages(rotated, scale, GAP), [rotated, scale]);

  useEffect(() => { onScaleChange(scale); }, [scale, onScaleChange]);

  // ---- container size -----------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setViewport({ width: box.width, height: box.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- keep the view anchored across zoom changes -------------------------
  const previous = useRef({ layout, scale });
  useEffect(() => {
    const el = scrollRef.current;
    const before = previous.current.layout;
    previous.current = { layout, scale };
    if (!el || before === layout || before.totalHeight === 0) return;
    // Anchor on the middle of the viewport rather than the top edge: the top is
    // usually blank margin, and zooming about it drifts the content away.
    const next = scrollAfterZoom(before, layout, el.scrollTop, el.clientHeight / 2);
    el.scrollTop = next;
    setScrollTop(next);
  }, [layout, scale]);

  // ---- scroll -------------------------------------------------------------
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    onPageChange(pageAtScroll(layout, el.scrollTop, el.clientHeight));
  }, [layout, onPageChange]);

  // ---- ctrl+wheel zoom ----------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      // Must be non-passive to preventDefault, or the browser zooms the whole UI.
      e.preventDefault();
      const factor = Math.exp(-e.deltaY / 400);
      onZoomTo(clampScale(scale * factor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scale, onZoomTo]);

  // ---- pinch zoom ---------------------------------------------------------
  // Read through a ref so the listeners below do not depend on `scale`: an
  // effect that re-subscribes on every zoom step would tear down its own
  // gesture state halfway through the pinch that caused the change.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    /** Finger distance when the pinch began, and the scale it began from. */
    let start: { spread: number; scale: number } | null = null;

    const spreadOf = (t: TouchList) => Math.hypot(
      t[0].clientX - t[1].clientX,
      t[0].clientY - t[1].clientY,
    );

    // Touch events rather than pointer events on purpose. The browser claims a
    // one-finger drag as a scroll and answers with `pointercancel`, which would
    // end the gesture just as the second finger lands; touch events keep firing
    // either way.
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) { start = null; return; }
      start = { spread: spreadOf(e.touches), scale: scaleRef.current };
    };

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !start || start.spread === 0) return;
      // Only when the browser still allows it: once a scroll is under way the
      // event is no longer cancelable, and zooming is still better than nothing.
      if (e.cancelable) e.preventDefault();
      onZoomTo(clampScale(start.scale * (spreadOf(e.touches) / start.spread)));
    };

    const onEnd = (e: TouchEvent) => { if (e.touches.length < 2) start = null; };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [onZoomTo]);

  // ---- imperative navigation ---------------------------------------------
  useImperativeHandle(ref, () => ({
    annotateSelection(kind: AnnotKind, color: string): Annotation[] {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];
      const range = selection.getRangeAt(0);

      // A selection can run across a page boundary, so each mounted page is
      // asked what part of it the selection covers. Attributing by geometry
      // rather than by DOM ancestry is what makes a multi-page drag produce one
      // annotation per page instead of one giant wrong rectangle.
      const made: Annotation[] = [];
      for (const [pageNum, api] of pagesRef.current) {
        if (!range.intersectsNode(api.el)) continue;
        const box = api.el.getBoundingClientRect();
        const quads: Quad[] = [];
        for (const rect of range.getClientRects()) {
          if (rect.width <= 0 || rect.height <= 0) continue;
          // Only the rectangles that actually fall on this page.
          const cy = rect.top + rect.height / 2;
          if (cy < box.top || cy > box.bottom) continue;
          quads.push(api.toPdfQuad(rect));
        }
        if (quads.length) made.push({ id: newId(), kind, page: pageNum, color, quads, source: 'new' });
      }

      if (made.length) selection.removeAllRanges();
      return made;
    },

    goToPage(page: number) {
      const el = scrollRef.current;
      if (!el) return;
      const next = scrollToPage(layout, page, GAP);
      el.scrollTop = next;
      setScrollTop(next);
      onPageChange(pageAtScroll(layout, next, el.clientHeight));
    },
    revealMatch(match: Match) {
      const el = scrollRef.current;
      if (!el) return;
      const i = match.page - 1;
      if (i < 0 || i >= layout.offsets.length) return;
      // Put the page a third of the way down rather than at the top: a hit near
      // the bottom of a page would otherwise be off screen after "scroll to it".
      const next = Math.max(0, layout.offsets[i] - el.clientHeight / 3);
      el.scrollTop = next;
      setScrollTop(next);
      onPageChange(pageAtScroll(layout, next, el.clientHeight));
    },
  }), [layout, onPageChange]);

  const { first, last } = visibleRange(layout, scrollTop, viewport.height || 800, OVERSCAN);

  const byPage = useMemo(() => {
    const map = new Map<number, Match[]>();
    for (const m of matches) {
      const list = map.get(m.page);
      if (list) list.push(m); else map.set(m.page, [m]);
    }
    return map;
  }, [matches]);

  const annotsByPage = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    for (const a of annotations) {
      const list = map.get(a.page);
      if (list) list.push(a); else map.set(a.page, [a]);
    }
    return map;
  }, [annotations]);

  const mounted = [];
  for (let i = first; i <= last && i < layout.offsets.length; i++) {
    const pageNum = i + 1;
    mounted.push(
      <PageView
        key={pageNum}
        doc={doc}
        pageNum={pageNum}
        scale={scale}
        rotation={rotation}
        width={Math.round(rotated[i].width * scale)}
        height={layout.heights[i]}
        top={layout.offsets[i]}
        matches={byPage.get(pageNum) ?? []}
        activeMatch={activeMatch?.page === pageNum ? activeMatch : null}
        annotations={annotsByPage.get(pageNum) ?? []}
        formValues={formValues}
        formEditing={formEditing}
        onFormChange={onFormChange}
        onFollowLink={onFollowLink}
        inkMode={inkMode}
        onInkStroke={onInkStroke}
        register={register}
      />,
    );
  }

  // A click places a note only while the tool is armed, so ordinary reading and
  // text selection are never intercepted.
  const onClick = useCallback((e: React.MouseEvent) => {
    if (!noteMode) return;
    for (const [pageNum, api] of pagesRef.current) {
      const box = api.el.getBoundingClientRect();
      if (e.clientX < box.left || e.clientX > box.right) continue;
      if (e.clientY < box.top || e.clientY > box.bottom) continue;
      onPlaceNote(pageNum, api.toPdfPoint(e.clientX, e.clientY), e.clientX, e.clientY);
      return;
    }
  }, [noteMode, onPlaceNote]);

  return (
    <div
      ref={scrollRef}
      className="rviewer"
      data-note-mode={noteMode || undefined}
      onScroll={onScroll}
      onClick={onClick}
      tabIndex={0}
    >
      <div
        className="rviewer__content"
        style={{ height: `${layout.totalHeight}px`, width: `${layout.contentWidth}px` }}
      >
        {mounted}
      </div>
    </div>
  );
});
