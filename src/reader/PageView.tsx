import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import { renderPageBitmap, documentId } from '../lib/pdfRender.js';
import { renderCache, pageKey } from '../lib/renderCache.js';
import { readPageText, rectsForMatch, type Match, type Rect, type PageText } from './search.js';
import type { Annotation, AnnotKind, Quad, Point } from './annotations.js';
import { toRgb } from './annotations.js';

/** One annotation rectangle, already converted to CSS pixels for painting. */
interface DrawnAnnot {
  id: string;
  kind: AnnotKind;
  color: string;
  contents: string | undefined;
  box: { left: number; top: number; width: number; height: number };
}

/** A clickable link the document declares. */
export interface PageLink {
  /** Resolved target page for an internal jump, or null for an external URL. */
  page: number | null;
  url: string | null;
  box: { left: number; top: number; width: number; height: number };
}

/** A text field the document already declares, positioned for editing. */
export interface FormField {
  name: string;
  value: string;
  readOnly: boolean;
  /** CSS pixels relative to the page element. */
  box: { left: number; top: number; width: number; height: number };
  multiline: boolean;
}

/**
 * What the viewer needs from a mounted page in order to turn a DOM selection
 * into PDF coordinates. Registered while mounted, withdrawn on unmount.
 */
export interface PageApi {
  el: HTMLElement;
  /** A client-space rectangle to a quad in PDF user space. */
  toPdfQuad(rect: DOMRect): Quad;
  /** A client-space point to PDF user space. */
  toPdfPoint(clientX: number, clientY: number): Point;
}

interface PageViewProps {
  doc: PDFDocumentProxy;
  pageNum: number;
  /** CSS pixels per PDF point. */
  scale: number;
  /** View rotation in degrees, added to the page's own /Rotate. */
  rotation: number;
  width: number;
  height: number;
  /** Absolute position within the scroll content. */
  top: number;
  matches: Match[];
  activeMatch: Match | null;
  annotations: Annotation[];
  formValues: Record<string, string>;
  formEditing: boolean;
  onFormChange(name: string, value: string): void;
  onFollowLink(page: number): void;
  /** Armed by the ink tool; while set, dragging on the page draws. */
  inkMode: boolean;
  onInkStroke(page: number, stroke: Point[]): void;
  register(pageNum: number, api: PageApi | null): void;
}

/**
 * One page: a canvas, search highlights, annotations, form fields, and a
 * selectable text layer on top.
 *
 * The canvas is painted from an `ImageBitmap` rather than rendered in place, so
 * scrolling back to a page already in the cache costs a `drawImage` rather than
 * a fresh rasterisation. See `src/lib/renderCache.ts` for why the cache holds
 * bitmaps and not canvases.
 */
export function PageView({
  doc, pageNum, scale, rotation, width, height, top,
  matches, activeMatch, annotations, formValues, formEditing, onFormChange,
  onFollowLink, inkMode, onInkStroke, register,
}: PageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<PageViewport | null>(null);
  const rendered = useRef<{ divs: HTMLElement[]; text: PageText } | null>(null);
  const [hits, setHits] = useState<{ rects: Rect[]; active: boolean }[]>([]);
  const [fields, setFields] = useState<FormField[]>([]);
  const [links, setLinks] = useState<PageLink[]>([]);
  /** The stroke being drawn right now, in CSS pixels relative to the page. */
  const [stroke, setStroke] = useState<{ x: number; y: number }[]>([]);

  // ---- raster -------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctrl = new AbortController();
    const key = pageKey(documentId(doc), pageNum, scale, rotation);

    const paint = (bitmap: ImageBitmap) => {
      if (ctrl.signal.aborted) return;
      // Backing store at device resolution, CSS box at layout size -- the same
      // split renderPage() has always used, so text stays crisp when zoomed in.
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
      canvas.dataset.rendered = 'true';
    };

    const cached = renderCache.get(key);
    if (cached) {
      paint(cached);
      return () => ctrl.abort();
    }

    void (async () => {
      try {
        const bitmap = await renderPageBitmap(doc, pageNum, scale, rotation, ctrl.signal);
        if (!bitmap || ctrl.signal.aborted) return;
        renderCache.set(key, bitmap);
        paint(bitmap);
      } catch {
        // A cancelled render is the expected outcome of scrolling away.
      }
    })();

    return () => ctrl.abort();
  }, [doc, pageNum, scale, rotation, width, height]);

  // ---- viewport, form fields, and the registration the viewer needs -------
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const page = await doc.getPage(pageNum);
      if (cancelled) return;
      const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
      viewportRef.current = viewport;

      const el = pageRef.current;
      if (el) {
        register(pageNum, {
          el,
          // convertToPdfPoint handles rotation and the y-flip, so nothing here
          // has to know which way up the page is.
          toPdfQuad(rect: DOMRect): Quad {
            const base = el.getBoundingClientRect();
            const [x1, y1] = viewport.convertToPdfPoint(rect.left - base.left, rect.top - base.top);
            const [x2, y2] = viewport.convertToPdfPoint(rect.right - base.left, rect.bottom - base.top);
            return {
              x: Math.min(x1, x2), y: Math.min(y1, y2),
              width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
            };
          },
          toPdfPoint(clientX: number, clientY: number): Point {
            const base = el.getBoundingClientRect();
            const [x, y] = viewport.convertToPdfPoint(clientX - base.left, clientY - base.top);
            return { x, y };
          },
        });
      }

      // Widget annotations give the field geometry the document itself declares,
      // which is the only way to put an input exactly where the field is.
      try {
        const annots = await page.getAnnotations({ intent: 'display' });
        if (cancelled) return;

        const toBox = (r: number[]) => {
          const [ax, ay] = viewport.convertToViewportPoint(r[0], r[1]);
          const [bx, by] = viewport.convertToViewportPoint(r[2], r[3]);
          return {
            left: Math.min(ax, bx), top: Math.min(ay, by),
            width: Math.abs(bx - ax), height: Math.abs(by - ay),
          };
        };

        const found: FormField[] = [];
        const foundLinks: PageLink[] = [];

        for (const a of annots as unknown as Record<string, never>[]) {
          const item = a as unknown as {
            subtype?: string; fieldType?: string; fieldName?: string;
            fieldValue?: unknown; readOnly?: boolean; rect?: number[]; multiLine?: boolean;
            url?: string; dest?: unknown;
          };
          const r = item.rect;
          if (!r || r.length < 4) continue;

          if (item.subtype === 'Widget' && item.fieldType === 'Tx' && item.fieldName) {
            found.push({
              name: item.fieldName,
              value: typeof item.fieldValue === 'string' ? item.fieldValue : '',
              readOnly: Boolean(item.readOnly),
              multiline: Boolean(item.multiLine),
              box: toBox(r),
            });
            continue;
          }

          if (item.subtype === 'Link') {
            // An external URL is handed to the host; an internal destination is
            // resolved to a page here, because only the document can say which
            // page a named destination means.
            if (item.url) {
              foundLinks.push({ page: null, url: item.url, box: toBox(r) });
            } else if (item.dest != null) {
              try {
                const explicit = typeof item.dest === 'string'
                  ? await doc.getDestination(item.dest)
                  : item.dest;
                if (Array.isArray(explicit) && explicit.length) {
                  const index = await doc.getPageIndex(explicit[0] as never);
                  foundLinks.push({ page: index + 1, url: null, box: toBox(r) });
                }
              } catch {
                // A link whose destination does not resolve is left out, rather
                // than shown and then doing nothing when clicked.
              }
            }
          }
        }
        if (cancelled) return;
        setFields(found);
        setLinks(foundLinks);
      } catch {
        setFields([]);
        setLinks([]);
      }
    })();

    return () => {
      cancelled = true;
      register(pageNum, null);
    };
    // `register` is a stable callback from the viewer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNum, scale, rotation]);

  // ---- highlights ---------------------------------------------------------
  // Measured from the rendered spans, so zoom and rotation need no arithmetic
  // here: the browser has already laid the text out.
  const measure = useCallback(() => {
    const page = pageRef.current;
    const state = rendered.current;
    if (!page || !state || !matches.length) { setHits([]); return; }
    setHits(matches.map((m) => ({
      rects: rectsForMatch(page, state.divs, state.text, m),
      active: activeMatch != null
        && activeMatch.page === m.page
        && activeMatch.start === m.start,
    })));
  }, [matches, activeMatch]);

  // ---- text layer ---------------------------------------------------------
  useEffect(() => {
    const container = textRef.current;
    if (!container) return;
    let layer: TextLayer | null = null;
    let cancelled = false;
    rendered.current = null;

    void (async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (cancelled) return;
        const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });

        container.replaceChildren();
        // pdf.js positions every span from this one custom property.
        container.style.setProperty('--total-scale-factor', String(scale));

        layer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container,
          viewport,
        });
        await layer.render();
        if (cancelled) { container.replaceChildren(); return; }

        rendered.current = { divs: layer.textDivs, text: await readPageText(doc, pageNum) };
        if (!cancelled) measure();
      } catch {
        // Scrolling away cancels the layer, and `cancel()` REJECTS the pending
        // render() with an AbortException rather than resolving it. Without this
        // catch, every page that leaves the viewport mid-render becomes an
        // unhandled rejection -- silent in production, and the reason the e2e
        // harness watches for them.
        if (!cancelled) container.replaceChildren();
      }
    })();

    return () => {
      cancelled = true;
      layer?.cancel();
      rendered.current = null;
    };
    // `measure` is intentionally excluded: it changes whenever the match list
    // does, and rebuilding the whole text layer for a new search term would
    // throw away work the browser just did. The effect below re-measures instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNum, scale, rotation]);

  useEffect(() => { measure(); }, [measure]);

  // ---- annotation geometry ------------------------------------------------
  const drawn = useMemo<DrawnAnnot[]>(() => {
    const viewport = viewportRef.current;
    if (!viewport) return [];
    const toCss = (q: Quad) => {
      const [ax, ay] = viewport.convertToViewportPoint(q.x, q.y);
      const [bx, by] = viewport.convertToViewportPoint(q.x + q.width, q.y + q.height);
      return {
        left: Math.min(ax, bx), top: Math.min(ay, by),
        width: Math.abs(bx - ax), height: Math.abs(by - ay),
      };
    };
    return annotations.flatMap((a) => {
      const [r, g, b] = toRgb(a.color);
      const css = `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
      if (a.kind === 'note' && a.point) {
        const [x, y] = viewport.convertToViewportPoint(a.point.x, a.point.y);
        return [{
          id: a.id, kind: a.kind, color: css, contents: a.contents,
          box: { left: x, top: y, width: 18, height: 18 },
        }] satisfies DrawnAnnot[];
      }
      return (a.quads ?? []).map((q, i): DrawnAnnot => ({
        id: `${a.id}:${i}`, kind: a.kind, color: css, contents: a.contents, box: toCss(q),
      }));
    });
    // viewportRef is filled by the effect above; scale/rotation changing is what
    // makes the geometry stale, so they are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, scale, rotation, width, height]);

  // ---- ink ----------------------------------------------------------------
  const localPoint = useCallback((e: React.PointerEvent) => {
    const box = pageRef.current?.getBoundingClientRect();
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) };
  }, []);

  const startStroke = useCallback((e: React.PointerEvent) => {
    if (!inkMode || e.button !== 0) return;
    // Pointer capture is what keeps a stroke attached to this page when the
    // drag wanders over the gap between pages, or off the window entirely.
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setStroke([localPoint(e)]);
  }, [inkMode, localPoint]);

  const extendStroke = useCallback((e: React.PointerEvent) => {
    if (!inkMode) return;
    setStroke((prev) => (prev.length ? [...prev, localPoint(e)] : prev));
  }, [inkMode, localPoint]);

  const endStroke = useCallback(() => {
    setStroke((prev) => {
      const viewport = viewportRef.current;
      // A click without a drag is not a stroke, and a single point would write
      // an ink annotation with no extent.
      if (viewport && prev.length > 1) {
        onInkStroke(pageNum, prev.map((pt) => {
          const [x, y] = viewport.convertToPdfPoint(pt.x, pt.y);
          return { x, y };
        }));
      }
      return [];
    });
  }, [onInkStroke, pageNum]);

  /** Saved ink strokes, converted back to CSS pixels for drawing. */
  const inkPaths = useMemo(() => {
    const viewport = viewportRef.current;
    if (!viewport) return [] as { id: string; color: string; points: string }[];
    return annotations
      .filter((a) => a.kind === 'ink' && a.strokes?.length)
      .flatMap((a) => {
        const [r, g, b] = toRgb(a.color);
        const css = `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
        return (a.strokes ?? []).map((line, i) => ({
          id: `${a.id}:${i}`,
          color: css,
          points: line.map((pt) => {
            const [x, y] = viewport.convertToViewportPoint(pt.x, pt.y);
            return `${x},${y}`;
          }).join(' '),
        }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, scale, rotation, width, height]);

  return (
    <div
      ref={pageRef}
      className="rpage"
      data-page={pageNum}
      style={{ top: `${top}px`, width: `${width}px`, height: `${height}px` }}
    >
      <canvas ref={canvasRef} className="rpage__canvas" />

      <div className="rpage__hits" aria-hidden="true">
        {hits.map((hit, i) => hit.rects.map((r, j) => (
          <div
            key={`${i}:${j}`}
            className="rhit"
            data-active={hit.active}
            style={{
              left: `${r.x}px`, top: `${r.y}px`,
              width: `${r.width}px`, height: `${r.height}px`,
            }}
          />
        )))}
      </div>

      <div className="rpage__annots" aria-hidden="true">
        {drawn.map((d) => (
          <div
            key={d.id}
            className={`rannot rannot--${d.kind}`}
            title={d.contents || undefined}
            style={{
              left: `${d.box.left}px`, top: `${d.box.top}px`,
              width: `${d.box.width}px`, height: `${d.box.height}px`,
              // Text markup tints; a note is a solid pin.
              ['--annot' as string]: d.color,
            }}
          />
        ))}
      </div>

      {(inkPaths.length > 0 || stroke.length > 1) && (
        <svg className="rpage__ink" width={width} height={height} aria-hidden="true">
          {inkPaths.map((path) => (
            <polyline key={path.id} points={path.points} stroke={path.color} />
          ))}
          {stroke.length > 1 && (
            <polyline
              className="rink--live"
              points={stroke.map((pt) => `${pt.x},${pt.y}`).join(' ')}
            />
          )}
        </svg>
      )}

      {inkMode && (
        <div
          className="rpage__draw"
          onPointerDown={startStroke}
          onPointerMove={extendStroke}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
        />
      )}

      {links.length > 0 && (
        <div className="rpage__links">
          {links.map((l, i) => (
            <a
              key={i}
              className="rlink"
              href={l.url ?? undefined}
              // External links go through the window-open handler, which the
              // main process routes to the OS browser instead of a new window.
              target={l.url ? '_blank' : undefined}
              rel={l.url ? 'noreferrer' : undefined}
              onClick={(e) => {
                if (l.page !== null) { e.preventDefault(); onFollowLink(l.page); }
              }}
              style={{
                left: `${l.box.left}px`, top: `${l.box.top}px`,
                width: `${l.box.width}px`, height: `${l.box.height}px`,
              }}
            />
          ))}
        </div>
      )}

      <div ref={textRef} className="textLayer" />

      {formEditing && fields.length > 0 && (
        <div className="rpage__fields">
          {fields.map((f) => (
            <input
              key={f.name}
              className="rfield"
              aria-label={f.name}
              data-field={f.name}
              readOnly={f.readOnly}
              value={formValues[f.name] ?? f.value}
              onChange={(e) => onFormChange(f.name, e.target.value)}
              style={{
                left: `${f.box.left}px`, top: `${f.box.top}px`,
                width: `${f.box.width}px`, height: `${f.box.height}px`,
                fontSize: `${Math.max(9, Math.min(f.box.height * 0.62, 20))}px`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
