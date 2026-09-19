/**
 * Drops bookmarks whose target page is gone, and re-points the ones whose target
 * is gone but whose children survive.
 *
 * Bytes in, bytes out, and the outline tree comes in as a parameter rather than
 * being fetched here. Reading it through qpdf's JSON is still deliberate -- qpdf
 * has already resolved every destination, including named ones via the /Names
 * tree -- but doing that is the caller's job, because the caller is the one that
 * owns a qpdf runner. What is left here is pure, and identical on every platform.
 */
import { PDFDocument, PDFName, PDFNumber, PDFDict, PDFRef, PDFArray } from 'pdf-lib';

/**
 * Prune bookmarks that no longer point anywhere.
 *
 * qpdf copies the outline tree wholesale when pages are selected, so a
 * bookmark whose target page was dropped survives as a dead entry that
 * simply does nothing when clicked. This walks the tree and removes them.
 *
 * The case that makes this non-trivial: a bookmark can be dead while its
 * CHILDREN survive -- "Chapter One" pointing at a dropped page 1, with
 * "Section 1.1" pointing at a page that was kept. Deleting the parent
 * would orphan a section that is still in the document, so such nodes are
 * kept and retargeted to their first surviving descendant instead.
 */

export interface QpdfOutline {
  title: string;
  /** 1-indexed page in THIS file, or null when the target is gone. */
  destpageposfrom1: number | null;
  /** e.g. "26 0 R". qpdf has already resolved named destinations for us. */
  object: string;
  open: boolean;
  kids: QpdfOutline[];
}

interface Plan {
  /** Object numbers to delete outright. */
  remove: Set<number>;
  /** Object number -> 1-indexed page to point it at instead. */
  retarget: Map<number, number>;
  /** Object number -> the page it effectively lands on, for sorting. */
  pageOf: Map<number, number>;
}

export interface PruneOptions {
  /**
   * Re-sort each level of the outline by the page its entries now point to.
   *
   * Only meaningful after the user has deliberately reordered pages: the
   * destinations follow the page objects on their own, but a viewer lists
   * bookmarks in tree order, so without this a bookmark on page 1 can still
   * appear last. Off by default, because an outline that was never in page
   * order to begin with (an index, say) should not be silently rewritten.
   */
  sortByPage?: boolean;
}

export interface PruneResult {
  /** The document with its outline fixed. */
  bytes: Uint8Array;
  removed: number;
  retargeted: number;
}

/** "26 0 R" -> 26. Generation is always 0 for objects qpdf writes. */
function objNum(ref: string): number {
  return Number.parseInt(ref, 10);
}

/**
 * Decide the fate of every node. A node survives if its own destination
 * survived, or if anything in its subtree did.
 */
function planFor(nodes: QpdfOutline[], plan: Plan): { alive: boolean; firstPage: number | null } {
  let anyAlive = false;
  let firstPage: number | null = null;

  for (const node of nodes) {
    const kids = planFor(node.kids ?? [], plan);
    const selfAlive = node.destpageposfrom1 !== null;
    const alive = selfAlive || kids.alive;

    if (!alive) {
      plan.remove.add(objNum(node.object));
    } else if (!selfAlive && kids.firstPage !== null) {
      // Keeps a section heading whose own page is gone but whose
      // contents partly survived.
      plan.retarget.set(objNum(node.object), kids.firstPage);
    }

    if (alive) {
      anyAlive = true;
      const page = selfAlive ? node.destpageposfrom1 : kids.firstPage;
      if (page !== null) {
        plan.pageOf.set(objNum(node.object), page);
        if (firstPage === null || page < firstPage) firstPage = page;
      }
    }
  }

  return { alive: anyAlive, firstPage };
}

/**
 * Rewrite one level of the sibling chain, dropping pruned nodes and
 * relinking /First, /Last, /Next and /Prev around the gaps.
 * Returns what the parent should record.
 */
function rebuildLevel(
  doc: PDFDocument,
  parentRef: PDFRef,
  firstRef: PDFRef | undefined,
  plan: Plan,
  pageRefs: PDFRef[],
  sortByPage: boolean,
): { first: PDFRef | null; last: PDFRef | null; visible: number } {
  const ctx = doc.context;

  // Collect the level first: the chain is about to be rewritten under us.
  const chain: PDFRef[] = [];
  let cursor: PDFRef | undefined = firstRef;
  const guard = new Set<number>();
  while (cursor) {
    if (guard.has(cursor.objectNumber)) break; // malformed loop; stop rather than hang
    guard.add(cursor.objectNumber);
    chain.push(cursor);
    const dict = ctx.lookupMaybe(cursor, PDFDict);
    const next = dict?.get(PDFName.of('Next'));
    cursor = next instanceof PDFRef ? next : undefined;
  }

  const kept: PDFRef[] = [];
  let visible = 0;

  for (const ref of chain) {
    if (plan.remove.has(ref.objectNumber)) continue;
    const dict = ctx.lookupMaybe(ref, PDFDict);
    if (!dict) continue;

    const childFirst = dict.get(PDFName.of('First'));
    const sub = rebuildLevel(
      doc, ref, childFirst instanceof PDFRef ? childFirst : undefined, plan, pageRefs, sortByPage,
    );

    if (sub.first) {
      dict.set(PDFName.of('First'), sub.first);
      dict.set(PDFName.of('Last'), sub.last!);
      // /Count sign carries open/closed state: keep it, resize the magnitude.
      const prior = dict.get(PDFName.of('Count'));
      const wasOpen = !(prior instanceof PDFNumber) || prior.asNumber() >= 0;
      dict.set(PDFName.of('Count'), PDFNumber.of(wasOpen ? sub.visible : -sub.visible));
      visible += wasOpen ? 1 + sub.visible : 1;
    } else {
      dict.delete(PDFName.of('First'));
      dict.delete(PDFName.of('Last'));
      dict.delete(PDFName.of('Count'));
      visible += 1;
    }

    const retarget = plan.retarget.get(ref.objectNumber);
    if (retarget !== undefined) {
      const page = pageRefs[retarget - 1];
      if (page) {
        dict.set(PDFName.of('Dest'), ctx.obj([page, PDFName.of('Fit')]) as PDFArray);
        // A /A GoTo action would override the /Dest we just fixed.
        dict.delete(PDFName.of('A'));
      }
    }

    dict.set(PDFName.of('Parent'), parentRef);
    kept.push(ref);
  }

  if (sortByPage) {
    // Array.prototype.sort is stable, so bookmarks landing on the same page
    // keep the order the author gave them.
    kept.sort((a, b) => {
      const pa = plan.pageOf.get(a.objectNumber);
      const pb = plan.pageOf.get(b.objectNumber);
      if (pa === undefined || pb === undefined) return 0;
      return pa - pb;
    });
  }

  kept.forEach((ref, i) => {
    const dict = ctx.lookup(ref, PDFDict);
    if (i > 0) dict.set(PDFName.of('Prev'), kept[i - 1]);
    else dict.delete(PDFName.of('Prev'));
    if (i < kept.length - 1) dict.set(PDFName.of('Next'), kept[i + 1]);
    else dict.delete(PDFName.of('Next'));
  });

  return {
    first: kept[0] ?? null,
    last: kept[kept.length - 1] ?? null,
    visible,
  };
}

/**
 * Read the outline of `file` with qpdf, prune dead bookmarks, and write the
 * result to `output`. Returns how many were removed and retargeted.
 *
 * Reading the tree through qpdf's JSON is deliberate: it has already resolved
 * every destination, including named ones via the /Names tree, so this only
 * has to prune by object number rather than re-implementing that resolution.
 */
/**
 * Whether pruning would change anything, decided from the outline tree ALONE.
 *
 * Separate from the work so a caller can answer it without reading the document.
 * On the desktop that is the difference between copying a file and loading the
 * whole thing into memory to save it back unchanged -- which is what the
 * pre-extraction code did, and what this preserves.
 */
export function needsPruning(outlines: QpdfOutline[], sortByPage: boolean): boolean {
  if (outlines.length === 0) return false;
  if (sortByPage) return true;
  const plan: Plan = { remove: new Set(), retarget: new Map(), pageOf: new Map() };
  planFor(outlines, plan);
  return plan.remove.size > 0 || plan.retarget.size > 0;
}

export async function pruneDeadBookmarks(
  pdfBytes: Uint8Array,
  outlines: QpdfOutline[],
  options: PruneOptions = {},
): Promise<PruneResult> {
  const plan: Plan = { remove: new Set(), retarget: new Map(), pageOf: new Map() };
  planFor(outlines, plan);

  const sortByPage = options.sortByPage ?? false;
  const nothingToDo = plan.remove.size === 0 && plan.retarget.size === 0 && !sortByPage;
  if (nothingToDo || outlines.length === 0) {
    return { bytes: pdfBytes, removed: 0, retargeted: 0 };
  }

  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const ctx = doc.context;
  const pageRefs = doc.getPages().map((p) => p.ref);

  const rootRef = doc.catalog.get(PDFName.of('Outlines'));
  if (rootRef instanceof PDFRef) {
    const root = ctx.lookupMaybe(rootRef, PDFDict);
    const first = root?.get(PDFName.of('First'));
    if (root && first instanceof PDFRef) {
      const res = rebuildLevel(doc, rootRef, first, plan, pageRefs, sortByPage);
      if (res.first) {
        root.set(PDFName.of('First'), res.first);
        root.set(PDFName.of('Last'), res.last!);
        root.set(PDFName.of('Count'), PDFNumber.of(res.visible));
      } else {
        // Nothing survived: drop the outline entirely rather than leaving
        // an empty panel behind.
        doc.catalog.delete(PDFName.of('Outlines'));
      }
    }
  }

  const bytes = await doc.save({ updateFieldAppearances: false });
  return { bytes, removed: plan.remove.size, retargeted: plan.retarget.size };
}

