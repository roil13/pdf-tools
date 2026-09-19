/**
 * Writes the per-file bookmarks that a merge adds.
 *
 * Bytes in, bytes out: the algorithm never touches a filesystem, so it serves the
 * Electron host (temp files on disk) and the mobile one (qpdf-wasm's in-memory
 * filesystem) without knowing which it is running under.
 */
import {
  PDFDocument, PDFName, PDFNumber, PDFHexString, PDFDict, PDFRef, PDFArray, PDFObject,
} from 'pdf-lib';

export interface BookmarkMark {
  title: string;
  /** 1-indexed page in the merged document. */
  page: number;
}

/**
 * Add one top-level bookmark per appended file to an already-merged PDF.
 *
 * qpdf takes document-level structure (outlines, AcroForm, tags) from the
 * PRIMARY input only, so files 2..N contribute pages but no navigation. This
 * post-pass restores navigation for them without disturbing the primary's own
 * outline tree or form fields.
 *
 * Two paths, both needed -- most PDFs have no outline at all, so the "create the
 * root" branch is the common case, not the edge case.
 */
export async function addMergeBookmarks(
  pdfBytes: Uint8Array,
  marks: BookmarkMark[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const ctx = doc.context;
  const pages = doc.getPages();

  const catalog = doc.catalog;
  const existingRef = catalog.get(PDFName.of('Outlines'));
  const existing = existingRef ? ctx.lookup(existingRef, PDFDict) : undefined;

  // Reserve refs first so siblings can point at each other.
  const newRefs = marks.map(() => ctx.nextRef());
  const rootRef: PDFRef = existingRef instanceof PDFRef ? existingRef : ctx.nextRef();

  // Tail of the existing top-level chain, if any.
  const existingLast = existing?.get(PDFName.of('Last'));
  const hasExisting = Boolean(existing && existingLast);

  marks.forEach((mark, i) => {
    const pageIndex = Math.min(Math.max(mark.page - 1, 0), pages.length - 1);
    const dest = ctx.obj([pages[pageIndex].ref, PDFName.of('Fit')]) as PDFArray;

    const dict: Record<string, PDFObject> = {
      // UTF-16BE via PDFHexString: the only encoding that survives non-Latin
      // titles such as Hebrew. PDFString would mangle them.
      Title: PDFHexString.fromText(mark.title),
      Parent: rootRef,
      Dest: dest,
    };
    const prev = i === 0 ? (hasExisting ? existingLast : undefined) : newRefs[i - 1];
    if (prev) dict.Prev = prev;
    if (i < newRefs.length - 1) dict.Next = newRefs[i + 1];

    ctx.assign(newRefs[i], ctx.obj(dict));
  });

  if (hasExisting && existing) {
    // Splice onto the end of the existing top-level sibling chain.
    const lastDict = ctx.lookup(existingLast, PDFDict);
    lastDict.set(PDFName.of('Next'), newRefs[0]);
    existing.set(PDFName.of('Last'), newRefs[newRefs.length - 1]);

    // /Count on the root counts VISIBLE descendants and already encodes the
    // primary's open/closed state. Add to it; never recompute from scratch.
    const current = existing.get(PDFName.of('Count'));
    const currentCount = current instanceof PDFNumber ? current.asNumber() : 0;
    const sign = currentCount < 0 ? -1 : 1; // negative means the root is collapsed
    existing.set(PDFName.of('Count'), PDFNumber.of(sign * (Math.abs(currentCount) + marks.length)));
  } else {
    // No outline tree at all -- build the root. This is the common case.
    ctx.assign(rootRef, ctx.obj({
      Type: 'Outlines',
      First: newRefs[0],
      Last: newRefs[newRefs.length - 1],
      Count: PDFNumber.of(marks.length),
    }));
    catalog.set(PDFName.of('Outlines'), rootRef);
  }

  // updateFieldAppearances:false leaves the primary's AcroForm untouched.
  return doc.save({ updateFieldAppearances: false });
}
