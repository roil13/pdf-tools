/** Types shared between the Electron main process and the renderer. */

export interface OutlineEntry {
  title: string;
  /** 1-indexed page, or null when the bookmark points at a page not in this document. */
  page: number | null;
  depth: number;
}

export interface PdfInfo {
  path: string;
  name: string;
  pageCount: number;
  sizeBytes: number;
  hasOutlines: boolean;
  hasAcroForm: boolean;
  isEncrypted: boolean;
  outline: OutlineEntry[];
}

export interface Rotation {
  /** 1-indexed page number in the SOURCE document. */
  page: number;
  /** Net clockwise rotation to apply, one of 90 / 180 / 270. */
  degrees: 90 | 180 | 270;
}

export interface EditPagesRequest {
  input: string;
  output: string;
  /**
   * 1-indexed source pages to keep, IN OUTPUT ORDER. Not necessarily
   * ascending: the order here is the order the pages end up in.
   */
  keep: number[];
  rotations: Rotation[];
  /**
   * Set when the user deliberately rearranged pages. Bookmark destinations
   * follow their pages automatically, but the outline is only re-sorted to
   * match the new page order when this is true.
   */
  reordered?: boolean;
}

export interface MergeRequest {
  inputs: string[];
  output: string;
  /** Add one top-level bookmark per appended file. */
  generateBookmarks: boolean;
}

export interface SplitPart {
  /** 1-indexed source pages for this output file. */
  pages: number[];
  fileName: string;
}

export interface SplitRequest {
  input: string;
  outputDir: string;
  parts: SplitPart[];
}

export interface CompressRequest {
  input: string;
  output: string;
}

export interface BookmarkChanges {
  /** Bookmarks dropped because their target page is no longer present. */
  removed: number;
  /** Bookmarks kept, but re-pointed at their first surviving child. */
  retargeted: number;
}

export interface OpResult {
  output: string;
  /** qpdf complained but still produced valid output (exit 3). */
  warnings?: string;
  bookmarks?: BookmarkChanges;
}

export interface CompressResult extends OpResult {
  beforeBytes: number;
  afterBytes: number;
}

export interface SplitResult {
  outputs: string[];
  warnings?: string;
}
