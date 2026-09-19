import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SharedDocProps } from '../App.js';
import { useSharedDoc } from '../lib/useSharedDoc.js';
import { api, formatBytes, stripExt, errorText } from '../lib/api.js';
import type { DocRef } from '../platform/types.js';
import { usePdfDoc } from '../lib/usePdfDoc.js';
import { renderCache } from '../lib/renderCache.js';
import { documentId } from '../lib/pdfRender.js';
import { clampScale, type ZoomMode } from '../lib/readerLayout.js';
import { DropZone, Notice } from '../components/ui.js';
import {
  IconSpinner, IconSearch, IconZoomIn, IconZoomOut, IconFitWidth, IconFitPage,
  IconRotate, IconSidebar, IconChevronUp, IconChevronDown, IconClose,
  IconHighlight, IconUnderline, IconStrikeout, IconNote, IconInk, IconForm, IconSave, IconUndo,
  IconFolder,
} from '../components/icons.js';
import { Viewer, type ViewerHandle } from '../reader/Viewer.js';
import { Sidebar, readOutline, type OutlineNode, type SidebarTab } from '../reader/Sidebar.js';
import { searchDocument, matchNearPage, type Match } from '../reader/search.js';
import {
  writeAnnotations, writeFormValues, readAnnotations, formNeedsUnicodeFont, newId,
  ANNOT_COLORS, type Annotation, type AnnotKind, type Point,
} from '../reader/annotations.js';
import { UserError } from '../lib/errors.js';
import { useT } from '../i18n/LocaleProvider.js';

/**
 * The Unicode font for Hebrew form values. Fetched rather than bundled because
 * it is only needed when a value actually contains such a character -- the same
 * arrangement the OCR text layer uses.
 */
async function loadUnicodeFont(): Promise<Uint8Array> {
  const res = await fetch('./fonts/NotoSansHebrew-Regular.ttf');
  if (!res.ok) throw new UserError('reader.save.fontFailed');
  return new Uint8Array(await res.arrayBuffer());
}

export function Reader({ toasts, doc, onDoc }: SharedDocProps) {
  const t = useT();
  const [source, setSource] = useState<DocRef | null>(null);
  const viewer = useRef<ViewerHandle | null>(null);

  const { loaded, loading } = usePdfDoc(source, (err) => {
    toasts.error(t('common.couldNotOpenPdf'), errorText(err, t));
    setSource(null);
    // Drop it from the shared slot too. Leaving a document there that has just
    // failed to open would hand it straight back on the next render, and to
    // every other tool after that.
    onDoc(null);
  });

  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [zoom, setZoom] = useState<ZoomMode>({ kind: 'fitWidth' });
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  // Open beside the page on a desktop, closed on a phone: there it is an overlay
  // covering most of the screen, and opening onto a hidden document is a strange
  // way to start reading.
  const [sidebar, setSidebar] = useState(
    () => !(typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches),
  );
  const [tab, setTab] = useState<SidebarTab>('outline');
  const [outline, setOutline] = useState<OutlineNode[]>([]);

  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [color, setColor] = useState<string>(ANNOT_COLORS[0]);
  const [formEditing, setFormEditing] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [noteMode, setNoteMode] = useState(false);
  const [inkMode, setInkMode] = useState(false);
  /** A note that has been placed but not yet given its text. */
  const [draftNote, setDraftNote] = useState<
    { page: number; point: Point; left: number; topPx: number; text: string } | null
  >(null);

  const load = useCallback((refs: DocRef[]) => {
    setSource(refs[0]);
    setPage(1);
    setPageInput('1');
    setRotation(0);
    setZoom({ kind: 'fitWidth' });
    setQuery('');
    setMatches([]);
    setActiveIndex(-1);
    setAnnotations([]);
    setFormValues({});
    setFormEditing(false);
    setNoteMode(false);
    setInkMode(false);
    setDraftNote(null);
    onDoc(refs[0]);
  }, [onDoc]);
  // Pick up whatever the previous tool had open.
  useSharedDoc(doc, source?.id, load);


  const browse = useCallback(async () => {
    try {
      const picked = await api.openPdfs(false);
      if (picked.length) load(picked);
    } catch (err) {
      toasts.error(t('error.pickerFailed'), errorText(err, t));
    }
  }, [load, toasts, t]);

  // Bitmaps for a closed document can never be asked for again, so holding them
  // would be a leak rather than a cache.
  useEffect(() => {
    const doc = loaded?.doc;
    if (!doc) return;
    const id = documentId(doc);
    return () => {
      renderCache.dropDocument(id);
      renderCache.dropDocument(`${id}~thumb`);
    };
  }, [loaded?.doc]);

  // Text markup already in the file, so the reader shows what is there rather
  // than only what this session added. Marked `source: 'file'` so saving does
  // not write a second copy of each one.
  useEffect(() => {
    if (!source || !loaded) return;
    let cancelled = false;
    void (async () => {
      try {
        const bytes = await api.readFile(source);
        const found = await readAnnotations(bytes);
        if (!cancelled && found.length) setAnnotations((prev) => [...found, ...prev]);
      } catch {
        // An unreadable annotation table is not a reason to refuse the document.
      }
    })();
    return () => { cancelled = true; };
    // Keyed on the document, not on `annotations`, which this sets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id, loaded?.doc]);

  useEffect(() => {
    const doc = loaded?.doc;
    if (!doc) { setOutline([]); return; }
    let cancelled = false;
    void readOutline(doc).then((nodes) => { if (!cancelled) setOutline(nodes); });
    return () => { cancelled = true; };
  }, [loaded?.doc]);

  // Open on whichever tab the document can actually populate.
  useEffect(() => {
    setTab(outline.length ? 'outline' : 'thumbs');
  }, [outline.length]);

  useEffect(() => { setPageInput(String(page)); }, [page]);

  // ---- search -------------------------------------------------------------
  useEffect(() => {
    const doc = loaded?.doc;
    if (!doc || !query.trim()) { setMatches([]); setActiveIndex(-1); setSearching(false); return; }

    const ctrl = new AbortController();
    setSearching(true);
    // Debounced: every keystroke would otherwise start a full-document scan, and
    // the scans would race to set the results.
    const timer = setTimeout(() => {
      void searchDocument(doc, query, ctrl.signal)
        .then((found) => {
          if (ctrl.signal.aborted) return;
          setMatches(found);
          setActiveIndex(found.length ? matchNearPage(found, page) : -1);
          setSearching(false);
        })
        .catch(() => { if (!ctrl.signal.aborted) setSearching(false); });
    }, 250);

    return () => { ctrl.abort(); clearTimeout(timer); };
    // `page` is read only to pick a starting match; re-running on every scroll
    // would restart the search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded?.doc, query]);

  const activeMatch = activeIndex >= 0 ? matches[activeIndex] ?? null : null;

  useEffect(() => {
    if (activeMatch) viewer.current?.revealMatch(activeMatch);
  }, [activeMatch]);

  const step = useCallback((by: number) => {
    setActiveIndex((i) => {
      if (!matches.length) return -1;
      return (i + by + matches.length) % matches.length;
    });
  }, [matches.length]);

  // ---- annotations --------------------------------------------------------
  const markup = useCallback((kind: AnnotKind) => {
    const made = viewer.current?.annotateSelection(kind, color) ?? [];
    if (!made.length) {
      toasts.info(t('reader.annot.label'), t('reader.annot.selectFirst'));
      return;
    }
    setAnnotations((prev) => [...prev, ...made]);
  }, [color, toasts, t]);

  const undo = useCallback(() => setAnnotations((prev) => {
    // Remove the most recent mark THIS session made; the file's own annotations
    // are not ours to undo.
    const last = prev.map((a) => a.source).lastIndexOf('new');
    return last < 0 ? prev : [...prev.slice(0, last), ...prev.slice(last + 1)];
  }), []);

  const addStroke = useCallback((page: number, stroke: Point[]) => {
    // One annotation per stroke, so undo removes the stroke the user just drew
    // rather than everything they have drawn on the page.
    setAnnotations((prev) => [...prev, {
      id: newId(), kind: 'ink', page, color, strokes: [stroke], source: 'new',
    }]);
  }, [color]);

  const placeNote = useCallback((page: number, point: Point, clientX: number, clientY: number) => {
    setNoteMode(false);
    setDraftNote({ page, point, left: clientX, topPx: clientY, text: '' });
  }, []);

  const commitNote = useCallback(() => {
    setDraftNote((draft) => {
      // An empty note would be an invisible pin with nothing to say, so it is
      // discarded rather than written.
      if (draft && draft.text.trim()) {
        setAnnotations((prev) => [...prev, {
          id: newId(), kind: 'note', page: draft.page, color,
          point: draft.point, contents: draft.text.trim(), source: 'new',
        }]);
      }
      return null;
    });
  }, [color]);

  const onFormChange = useCallback((name: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const mine = useMemo(() => annotations.filter((a) => a.source === 'new'), [annotations]);
  const dirty = mine.length > 0 || Object.keys(formValues).length > 0;

  const save = useCallback(async () => {
    if (!loaded || !source || !dirty) {
      toasts.info(t('reader.save.nothing'), t('common.nothingSaved'));
      return;
    }
    const output = await api.saveAs(`${stripExt(loaded.info.ref.name)} (annotated).pdf`);
    if (!output) return;

    setSaving(true);
    try {
      // Re-read the original rather than reusing the bytes pdf.js holds: it
      // DETACHES the buffer it is given (see openDocument), so they are gone.
      let bytes = await api.readFile(source);

      if (mine.length) {
        bytes = await writeAnnotations(bytes, mine, t('app.title'));
      }

      const edits = Object.entries(formValues).map(([name, value]) => ({ name, value }));
      if (edits.length) {
        // Only fetched when a value actually needs it: the unsubsetted font is
        // ~16 KB on the wire and several times that in the output file.
        const font = formNeedsUnicodeFont(edits) ? await loadUnicodeFont() : null;
        bytes = await writeFormValues(bytes, edits, font);
      }

      await api.writeFile(output, bytes);
      toasts.ok(t('reader.save.done'), output.name, [
        { label: t('common.open'), run: () => void api.openFile(output) },
        { label: t('common.showInFolder'), run: () => void api.revealInFolder(output) },
      ]);
    } catch (err) {
      toasts.error(t('reader.save.failed'), errorText(err, t));
    } finally {
      setSaving(false);
    }
  }, [loaded, source, dirty, mine, formValues, toasts, t]);

  // ---- zoom / rotate ------------------------------------------------------
  const zoomBy = useCallback((factor: number) => {
    setZoom({ kind: 'fixed', scale: clampScale(scale * factor) });
  }, [scale]);

  const goToPage = useCallback((n: number) => {
    viewer.current?.goToPage(n);
  }, []);

  const submitPage = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const n = Number.parseInt(pageInput, 10);
    if (Number.isFinite(n) && loaded) {
      goToPage(Math.min(Math.max(n, 1), loaded.info.pageCount));
    } else {
      setPageInput(String(page));
    }
  }, [pageInput, loaded, goToPage, page]);

  // ---- keyboard -----------------------------------------------------------
  useEffect(() => {
    if (!loaded) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Never steal keys from a field the user is typing in.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
        if (e.key === 'Escape') (target as HTMLInputElement).blur();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomBy(1.25); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoomBy(0.8); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); setZoom({ kind: 'fitWidth' }); return; }
      if (e.key === 'Home') { e.preventDefault(); goToPage(1); return; }
      if (e.key === 'End') { e.preventDefault(); goToPage(loaded.info.pageCount); return; }
      if (e.key === 'Escape' && searchOpen) { setSearchOpen(false); setQuery(''); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loaded, zoomBy, goToPage, searchOpen]);

  const total = loaded?.info.pageCount ?? 0;
  const zoomLabel = useMemo(() => `${Math.round(scale * 100)}%`, [scale]);

  if (!loaded) {
    return (
      <main className="screen">
        <header className="screen__head">
          <h1>{t('reader.title')}</h1>
          <p>{t('reader.lead')}</p>
        </header>
        {loading
          ? <div className="screen__busy"><IconSpinner />{t('common.opening')}</div>
          : (
            <DropZone
              accept="pdf" single onFiles={load} onBrowse={browse}
              title={t('reader.drop.title')} hint={t('reader.drop.hint')}
              onReject={(m) => toasts.warn(t('common.notAdded'), m)}
            />
          )}
      </main>
    );
  }

  return (
    <main className="screen screen--reader">
      <div className="rbar">
        <button
          className="rbar__btn" aria-pressed={sidebar}
          onClick={() => setSidebar((s) => !s)}
          title={t('reader.sidebar.toggle')} aria-label={t('reader.sidebar.toggle')}
        ><IconSidebar /></button>

        <form className="rbar__pages" onSubmit={submitPage}>
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={submitPage}
            inputMode="numeric"
            aria-label={t('reader.page.label')}
          />
          <span>{t('reader.page.of', { n: total })}</span>
        </form>

        <div className="rbar__gap" />

        <button className="rbar__btn" onClick={() => zoomBy(0.8)}
          title={t('reader.zoom.out')} aria-label={t('reader.zoom.out')}><IconZoomOut /></button>
        <span className="rbar__zoom">{zoomLabel}</span>
        <button className="rbar__btn" onClick={() => zoomBy(1.25)}
          title={t('reader.zoom.in')} aria-label={t('reader.zoom.in')}><IconZoomIn /></button>
        <button className="rbar__btn" aria-pressed={zoom.kind === 'fitWidth'}
          onClick={() => setZoom({ kind: 'fitWidth' })}
          title={t('reader.zoom.fitWidth')} aria-label={t('reader.zoom.fitWidth')}><IconFitWidth /></button>
        <button className="rbar__btn" aria-pressed={zoom.kind === 'fitPage'}
          onClick={() => setZoom({ kind: 'fitPage' })}
          title={t('reader.zoom.fitPage')} aria-label={t('reader.zoom.fitPage')}><IconFitPage /></button>
        <button className="rbar__btn" onClick={() => setRotation((r) => (r + 90) % 360)}
          title={t('reader.rotate')} aria-label={t('reader.rotate')}><IconRotate /></button>

        <button
          className="rbar__btn" aria-pressed={searchOpen}
          onClick={() => setSearchOpen((s) => !s)}
          title={t('reader.search.toggle')} aria-label={t('reader.search.toggle')}
        ><IconSearch /></button>

        <span className="rbar__sep" role="separator" />

        <div className="rbar__swatches" role="group" aria-label={t('reader.annot.color')}>
          {ANNOT_COLORS.map((c) => (
            <button
              key={c}
              className="rswatch"
              style={{ background: c }}
              aria-pressed={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
            />
          ))}
        </div>

        <button className="rbar__btn" onClick={() => markup('highlight')}
          title={t('reader.annot.highlight')} aria-label={t('reader.annot.highlight')}><IconHighlight /></button>
        <button className="rbar__btn" onClick={() => markup('underline')}
          title={t('reader.annot.underline')} aria-label={t('reader.annot.underline')}><IconUnderline /></button>
        <button className="rbar__btn" onClick={() => markup('strikeout')}
          title={t('reader.annot.strikeout')} aria-label={t('reader.annot.strikeout')}><IconStrikeout /></button>
        <button className="rbar__btn" aria-pressed={noteMode}
          onClick={() => { setInkMode(false); setNoteMode((n) => !n); }}
          title={t('reader.annot.note')} aria-label={t('reader.annot.note')}><IconNote /></button>
        <button className="rbar__btn" aria-pressed={inkMode}
          onClick={() => { setNoteMode(false); setInkMode((i) => !i); }}
          title={t('reader.annot.ink')} aria-label={t('reader.annot.ink')}><IconInk /></button>
        <button className="rbar__btn" onClick={undo} disabled={!mine.length}
          title={t('reader.annot.undo')} aria-label={t('reader.annot.undo')}><IconUndo /></button>

        <button
          className="rbar__btn" aria-pressed={formEditing}
          onClick={() => {
            if (!loaded.info.hasAcroForm) {
              toasts.info(t('reader.form.toggle'), t('reader.form.none'));
              return;
            }
            setFormEditing((f) => !f);
          }}
          title={t('reader.form.toggle')} aria-label={t('reader.form.toggle')}
        ><IconForm /></button>

        <div className="rbar__gap" />
        <span className="rbar__name" title={loaded.info.ref.name}>
          {/* Both parts are isolated: a size renders as "KB 3.9" inside a Hebrew
              line without it, for the same reason a filename needs it. */}
          <bdi>{loaded.info.ref.name}</bdi> · <bdi>{formatBytes(loaded.info.sizeBytes)}</bdi>
        </span>
        {mine.length > 0 && (
          <span className="rbar__count">{t('reader.annot.count', { n: mine.length })}</span>
        )}
        <button
          className="btn"
          onClick={save}
          disabled={!dirty || saving}
          // The label is hidden on a narrow screen to keep the toolbar to two
          // rows, so the button needs a name of its own rather than borrowing
          // one from text that may not be rendered.
          aria-label={t('reader.save')}
        >
          {saving ? <IconSpinner /> : <IconSave />}
          <span className="btn__label">{t('reader.save')}</span>
        </button>
        <button
          className="btn btn--ghost"
          onClick={browse}
          // Same reason as Save above: on a phone this is icon-only, so it needs
          // a name that does not depend on the label being rendered.
          aria-label={t('reader.openAnother')}
          title={t('reader.openAnother')}
        >
          <IconFolder />
          <span className="btn__label">{t('reader.openAnother')}</span>
        </button>
      </div>

      {searchOpen && (
        <div className="rfind" role="search">
          <IconSearch />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
              if (e.key === 'Escape') { setSearchOpen(false); setQuery(''); }
            }}
            placeholder={t('reader.search.placeholder')}
            aria-label={t('reader.search.placeholder')}
          />
          <span className="rfind__count" aria-live="polite">
            {searching
              ? t('reader.search.searching')
              : query.trim() === ''
                ? ''
                : matches.length === 0
                  ? t('reader.search.none')
                  : t('reader.search.position', { i: activeIndex + 1, n: matches.length })}
          </span>
          <button className="rbar__btn" onClick={() => step(-1)} disabled={!matches.length}
            title={t('reader.search.previous')} aria-label={t('reader.search.previous')}><IconChevronUp /></button>
          <button className="rbar__btn" onClick={() => step(1)} disabled={!matches.length}
            title={t('reader.search.next')} aria-label={t('reader.search.next')}><IconChevronDown /></button>
          <button className="rbar__btn" onClick={() => { setSearchOpen(false); setQuery(''); }}
            title={t('common.close')} aria-label={t('common.close')}><IconClose /></button>
        </div>
      )}

      <div className="rbody">
        {sidebar && (
          <Sidebar
            doc={loaded.doc}
            nodes={outline}
            currentPage={page}
            tab={tab}
            onTab={setTab}
            onGo={goToPage}
          />
        )}
        <Viewer
          ref={viewer}
          doc={loaded.doc}
          zoom={zoom}
          rotation={rotation}
          matches={matches}
          activeMatch={activeMatch}
          annotations={annotations}
          formValues={formValues}
          formEditing={formEditing}
          onFormChange={onFormChange}
          noteMode={noteMode}
          onPlaceNote={placeNote}
          onFollowLink={goToPage}
          inkMode={inkMode}
          onInkStroke={addStroke}
          onPageChange={setPage}
          onScaleChange={setScale}
          onZoomTo={(s) => setZoom({ kind: 'fixed', scale: s })}
        />
      </div>

      {draftNote && (
        <div
          className="rnote"
          style={{ left: `${draftNote.left}px`, top: `${draftNote.topPx}px` }}
        >
          <textarea
            autoFocus
            aria-label={t('reader.annot.notePrompt')}
            placeholder={t('reader.annot.notePrompt')}
            value={draftNote.text}
            onChange={(e) => setDraftNote((d) => (d ? { ...d, text: e.target.value } : d))}
            onBlur={commitNote}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); setDraftNote(null); }
              // Enter commits; shift+Enter is a newline, as in any comment box.
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitNote(); }
            }}
          />
        </div>
      )}

      {loaded.info.isEncrypted && (
        <Notice kind="warn">{t('error.encrypted')}</Notice>
      )}
    </main>
  );
}
