import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { api } from './api.js';
import type { DocRef, DocInfo } from '../platform/types.js';
import { openDocument, closeDocument } from './pdfRender.js';
import { UserError } from './errors.js';

export interface LoadedPdf {
  info: DocInfo;
  doc: PDFDocumentProxy;
}

/**
 * Load a PDF for both inspection (via the host) and rendering (via pdf.js in the
 * renderer). Returns null while nothing is loaded.
 */
export function usePdfDoc(ref: DocRef | null, onError: (err: unknown) => void) {
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Clear on every document change, not only on unmount: the cleanup below
    // destroys the previous proxy, and leaving it in state would let thumbnails
    // keep rendering against a destroyed document.
    setLoaded(null);
    if (!ref) return;

    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    setLoading(true);

    void (async () => {
      try {
        const info = await api.inspect(ref);
        // Same key the main process uses, rather than a second copy of the words.
        if (info.isEncrypted) throw new UserError('error.encrypted');
        const bytes = await api.readFile(ref);
        const doc = await openDocument(bytes);
        opened = doc;
        if (cancelled) { void closeDocument(doc); return; }
        setLoaded({ info, doc });
      } catch (err) {
        if (!cancelled) {
          setLoaded(null);
          onError(err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      void closeDocument(opened);
    };
    // Keyed on the id rather than the handle so that a caller rebuilding an
    // equivalent DocRef does not reload the document.
    // onError is intentionally excluded: callers pass an inline closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref?.id]);

  return { loaded, loading };
}
