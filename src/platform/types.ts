/**
 * What the app needs from its host, stated without reference to a filesystem.
 *
 * The renderer used to talk to Electron directly, in absolute path strings. That
 * vocabulary has no meaning on a phone: Android's Storage Access Framework hands
 * out `content://` URIs and iOS hands out security-scoped URLs, neither of which
 * is a path and neither of which can be constructed, joined or split. Replacing
 * the native qpdf binary alone would not have produced a working mobile app --
 * this seam is the other half of that job.
 *
 * Everything the app touches is therefore an opaque handle. Only the
 * implementation in this directory knows what is inside one.
 */
import type {
  OutlineEntry, Rotation, SplitPart, BookmarkChanges,
} from '../../shared/types.js';

export type { OutlineEntry, Rotation, SplitPart, BookmarkChanges };

/**
 * A document the user gave us. `id` is opaque -- an absolute path under
 * Electron, a content URI on Android -- and must never be parsed or built by
 * anything outside `src/platform/`.
 *
 * `name` travels alongside rather than being derived from `id`, because on
 * Android it cannot be derived: a content URI carries no display name, and the
 * only way to learn one is to ask the OS at pick time.
 */
export interface DocRef {
  id: string;
  name: string;
}

/**
 * A place the app may write. Structurally identical to DocRef today, and kept
 * separate for what it says rather than what it enforces: on Android a read
 * grant and a write grant are genuinely different permissions, so the two are
 * worth not confusing even while TypeScript cannot tell them apart.
 */
export interface DestRef {
  id: string;
  name: string;
}

/** Everything the UI needs to know about a PDF before acting on it. */
export interface DocInfo {
  ref: DocRef;
  pageCount: number;
  sizeBytes: number;
  hasOutlines: boolean;
  hasAcroForm: boolean;
  isEncrypted: boolean;
  outline: OutlineEntry[];
}

export interface OpOutcome {
  output: DestRef;
  /** qpdf complained but still produced valid output (exit 3). */
  warnings?: string;
  bookmarks?: BookmarkChanges;
}

export interface CompressOutcome extends OpOutcome {
  beforeBytes: number;
  afterBytes: number;
}

export interface SplitOutcome {
  outputs: DestRef[];
  warnings?: string;
}

export interface EditPagesOptions {
  /**
   * 1-indexed source pages to keep, IN OUTPUT ORDER. Not necessarily
   * ascending: the order here is the order the pages end up in.
   */
  keep: number[];
  rotations: Rotation[];
  /** Set when the user deliberately rearranged pages, which re-sorts the outline. */
  reordered?: boolean;
}

/**
 * Affordances that do not exist everywhere, so a screen can hide one rather
 * than call it and fail. Only the two that are already known to diverge are
 * listed; the rest get added when a host that lacks them exists.
 */
export interface Capabilities {
  /** Show a file in the OS file manager. No Android analogue -- share instead. */
  revealInFolder: boolean;
  /** Hand a file to the OS default application. */
  openExternal: boolean;
  /**
   * A camera document scanner with edge detection. Provided by the OS on mobile
   * and by nothing at all on the desktop, so the tool is hidden rather than
   * offered and then failing.
   */
  camera: boolean;
}

export interface Platform {
  readonly capabilities: Capabilities;

  /** Turn an OS drag-and-drop into handles. */
  filesToRefs(files: File[]): DocRef[];

  openPdfs(multi: boolean): Promise<DocRef[]>;
  openImages(): Promise<DocRef[]>;
  chooseFolder(): Promise<DestRef | null>;
  saveAs(suggestedName: string): Promise<DestRef | null>;

  /**
   * A destination beside `dest` with the same stem and a different extension,
   * or null when that would collide with `dest` itself. Used for the optional
   * companion .txt the OCR screen writes.
   */
  siblingWithExtension(dest: DestRef, ext: string): DestRef | null;

  readFile(ref: DocRef): Promise<Uint8Array>;
  writeFile(dest: DestRef, bytes: Uint8Array): Promise<DestRef>;
  existsIn(dir: DestRef, name: string): Promise<boolean>;

  inspect(ref: DocRef): Promise<DocInfo>;
  editPages(input: DocRef, output: DestRef, opts: EditPagesOptions): Promise<OpOutcome>;
  merge(inputs: DocRef[], output: DestRef, generateBookmarks: boolean): Promise<OpOutcome>;
  split(input: DocRef, outputDir: DestRef, parts: SplitPart[]): Promise<SplitOutcome>;
  compress(input: DocRef, output: DestRef): Promise<CompressOutcome>;

  /**
   * Capture pages with the OS document scanner.
   *
   * Returns each page as the scanner's own perspective-corrected JPEG. Bytes
   * rather than file handles because these are the app's own temporary output,
   * not something the user picked and can be asked for again.
   *
   * Resolves empty when the user backs out, which is not an error.
   */
  scanDocument(maxPages: number): Promise<Uint8Array[]>;

  revealInFolder(ref: DestRef): Promise<void>;
  openFile(ref: DestRef): Promise<void>;
  versions(): Promise<Record<string, string>>;
}
