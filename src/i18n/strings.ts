import type { Plural } from './t.js';

/**
 * Every user-facing string in the app.
 *
 * `Strings` is declared explicitly rather than inferred from `en`, because that
 * is what turns a missing Hebrew translation into a TYPECHECK FAILURE instead of
 * a silent English fallback. `npm run typecheck` is the completeness check.
 *
 * Both dictionaries live in one file so the Hebrew can be reviewed as prose.
 */
export interface Strings {
  // ---------------------------------------------------------------- shell
  'app.title': string;
  'app.brand': string;
  'nav.editPages': string;
  'nav.merge': string;
  'nav.split': string;
  'nav.images': string;
  'nav.ocr': string;
  'nav.compress': string;
  'nav.about': string;
  'nav.language': string;

  // ---------------------------------------------------------------- common
  'common.openAnother': string;
  'common.browse': string;
  'common.clear': string;
  'common.opening': string;
  'common.open': string;
  'common.showInFolder': string;
  'common.dismiss': string;
  'common.originalUntouched': string;
  'common.originalsUntouched': string;
  'common.newFilesWritten': string;
  'common.pages': Plural;
  'common.files': Plural;
  'common.saved': string;
  'common.savedWithWarnings': string;
  'common.warningsStillWritten': string;
  'common.couldNotSave': string;
  'common.couldNotOpenPdf': string;
  'common.notAdded': string;
  'common.cancel': string;
  'common.cancelled': string;
  'common.nothingSaved': string;

  // ------------------------------------------------------------- dropzone
  'drop.pdf.title': string;
  'drop.pdf.hint': string;
  'drop.pdfs.title': string;
  'drop.pdfs.hint': string;
  'drop.pdfs.more.title': string;
  'drop.pdfs.more.hint': string;
  'drop.images.title': string;
  'drop.images.hint': string;
  'drop.images.more.title': string;
  'drop.images.more.hint': string;
  'drop.scan.title': string;
  'drop.reject.needPdf': string;
  'drop.reject.needImages': string;
  'drop.reject.singlePdf': string;
  'drop.reject.singleImage': string;
  'drop.reject.ignored': Plural;
  'drop.kind.pdf': string;
  'drop.kind.image': string;

  // ----------------------------------------------------------- edit pages
  'editPages.title': string;
  'editPages.blurb': string;
  'editPages.selectAll': string;
  'editPages.selectNone': string;
  'editPages.invert': string;
  'editPages.rotateLeft': string;
  'editPages.rotateRight': string;
  'editPages.reverse': string;
  'editPages.reverseHint': string;
  'editPages.resetOrder': string;
  'editPages.selectedCount': string;
  'editPages.reorderedSuffix': string;
  'editPages.pagesLabel': string;
  'editPages.pagesPlaceholder': string;
  'editPages.pagesHint': string;
  'editPages.whatToDo': string;
  'editPages.mode.all': string;
  'editPages.mode.allHint': string;
  'editPages.mode.keep': string;
  'editPages.mode.keepHint': string;
  'editPages.mode.remove': string;
  'editPages.mode.removeHint': string;
  'editPages.pre.outputPages': string;
  'editPages.pre.all': string;
  'editPages.pre.ofTotal': string;
  'editPages.pre.none': string;
  'editPages.pre.which': string;
  'editPages.pre.rotated': string;
  'editPages.pre.order': string;
  'editPages.pre.rearranged': string;
  'editPages.pre.bookmarks': string;
  'editPages.pre.bookmarksAll': string;
  'editPages.pre.bookmarksSome': string;
  'editPages.notice.form': string;
  'editPages.notice.bookmarksPruned': string;
  'editPages.notice.selectOne': string;
  'editPages.notice.wouldRemoveAll': string;
  'editPages.notice.noChanges': string;
  'editPages.action.saveAll': Plural;
  'editPages.action.saveSelected': string;
  'editPages.action.removeAndSave': string;
  'editPages.toast.bookmarksRemoved': Plural;
  'editPages.page': string;
  'editPages.pageMoved': string;
  'editPages.rotatePage': string;
  'editPages.rotateTitle': string;

  // ---------------------------------------------------------------- merge
  'merge.title': string;
  'merge.blurb': string;
  'merge.addPdfs': string;
  'merge.bookmarksLabel': string;
  'merge.generateBookmarks': string;
  'merge.generateBookmarksHint': string;
  'merge.pre.files': string;
  'merge.pre.totalPages': string;
  'merge.pre.order': string;
  'merge.pre.asListed': string;
  'merge.notice.laterBookmarks': Plural;
  'merge.notice.firstKeeps': string;
  'merge.notice.needMore': string;
  'merge.action.merge': Plural;
  'merge.toast.merged': string;
  'merge.toast.couldNotMerge': string;
  'merge.toast.skipped': string;
  'merge.toast.encrypted': string;
  'merge.toast.couldNotRead': string;
  'merge.chip.bookmarks': string;
  'merge.chip.form': string;
  'merge.reorder': string;
  'merge.remove': string;

  // ---------------------------------------------------------------- split
  'split.title': string;
  'split.blurb': string;
  'split.clickToSplit': string;
  'split.previewOnly': string;
  'split.clearPoints': string;
  'split.howLabel': string;
  'split.mode.points': string;
  'split.mode.pointsHint': string;
  'split.mode.every': string;
  'split.mode.everyHint': string;
  'split.mode.each': string;
  'split.mode.eachHint': string;
  'split.mode.bookmarks': string;
  'split.mode.bookmarksHint': string;
  'split.mode.bookmarksNone': string;
  'split.perFile': string;
  'split.saveInto': string;
  'split.chooseFolder': string;
  'split.filesToCreate': string;
  'split.andMore': string;
  'split.pre.files': string;
  'split.pre.totalPages': string;
  'split.action.split': Plural;
  'split.toast.wrote': Plural;
  'split.toast.couldNotSplit': string;
  'split.toast.clash': Plural;
  'split.toast.clashBody': string;
  'split.toast.clashAndMore': string;
  'split.toast.warnings': string;

  // --------------------------------------------------------------- images
  'images.title': string;
  'images.blurb': string;
  'images.addImages': string;
  'images.decoding': string;
  'images.pageSize': string;
  'images.size.fit': string;
  'images.size.fitHint': string;
  'images.size.a4': string;
  'images.size.letter': string;
  'images.size.centredHint': string;
  'images.margin': string;
  'images.pre.images': string;
  'images.pre.pages': string;
  'images.pre.sourceSize': string;
  'images.notice.jpeg': string;
  'images.notice.safe': string;
  'images.action.create': string;
  'images.toast.created': Plural;
  'images.toast.couldNotCreate': string;
  'images.toast.couldNotRead': string;
  'images.tiffPage': string;

  // ------------------------------------------------------------------ ocr
  'ocr.title': string;
  'ocr.blurb': string;
  'ocr.languages': string;
  'ocr.english': string;
  'ocr.hebrew': string;
  'ocr.languagesHint': string;
  'ocr.options': string;
  'ocr.skipText': string;
  'ocr.skipTextHint': string;
  'ocr.alsoText': string;
  'ocr.alsoTextHint': string;
  'ocr.pre.pages': string;
  'ocr.pre.resolution': string;
  'ocr.pre.languages': string;
  'ocr.notice.time': string;
  'ocr.action.run': string;
  'ocr.action.working': string;
  'ocr.phase.starting': string;
  'ocr.phase.loading': string;
  'ocr.phase.reading': string;
  'ocr.phase.writing': string;
  'ocr.progress': string;
  'ocr.toast.recognised': Plural;
  'ocr.toast.skipped': Plural;
  'ocr.toast.alsoSaved': string;
  'ocr.toast.noText': string;
  'ocr.toast.allHadText': string;
  'ocr.toast.nothingLegible': string;
  'ocr.toast.failed': string;

  // ------------------------------------------------------------- compress
  'compress.title': string;
  'compress.blurb': string;
  'compress.pre.currentSize': string;
  'compress.pre.pages': string;
  'compress.pre.method': string;
  'compress.pre.lossless': string;
  'compress.notice.lossless': string;
  'compress.action.compress': string;
  'compress.toast.saved': string;
  'compress.toast.savedBody': string;
  'compress.toast.alreadySmall': string;
  'compress.toast.alreadySmallBody': string;
  'compress.toast.noSmaller': string;
  'compress.toast.onlySmaller': string;
  'compress.toast.failed': string;

  // ---------------------------------------------------------------- about
  'about.title': string;
  'about.blurb': string;
  'about.privacyTitle': string;
  'about.privacyBody': string;
  'about.filesTitle': string;
  'about.files1': string;
  'about.files2': string;
  'about.files3': string;
  'about.builtWith': string;
  'about.versions': string;
  'about.credit.qpdf': string;
  'about.credit.pdfjs': string;
  'about.credit.pdflib': string;
  'about.credit.electron': string;
  'about.credit.react': string;

  // --------------------------------------------------------------- errors
  'error.encrypted': string;
  'error.notPdf': string;
  'error.missing': string;
  'error.qpdf': string;
  'error.qpdfJson': string;
  'error.selectAtLeastOnePage': string;
  'error.needTwoPdfs': string;
  'error.noCanvas': string;
  'error.pickerFailed': string;

  // Thrown from library code, phrased here.
  'range.backwards': string;
  'range.notARange': string;
  'range.startsAtOne': string;
  'range.outOfRange': Plural;
  'range.badChunkSize': string;
  'range.noBookmarks': string;
  'range.pointOutside': string;
  'image.unreadable': string;
  'image.heicEmpty': string;
  'image.heicFailed': string;
  'image.tiffEmpty': string;
  'image.tiffFailed': string;
  'image.encodeFailed': string;

  // ---------------------------------------------------------------- reader
  'nav.reader': string;
  'reader.title': string;
  'reader.lead': string;
  'reader.drop.title': string;
  'reader.drop.hint': string;
  'reader.openAnother': string;
  'reader.page.label': string;
  'reader.page.of': string;
  'reader.zoom.in': string;
  'reader.zoom.out': string;
  'reader.zoom.fitWidth': string;
  'reader.zoom.fitPage': string;
  'reader.rotate': string;
  'reader.sidebar.toggle': string;
  'reader.sidebar.label': string;
  'reader.sidebar.outline': string;
  'reader.sidebar.thumbnails': string;
  'reader.outline.none': string;
  'reader.search.toggle': string;
  'reader.search.placeholder': string;
  'reader.search.searching': string;
  'reader.search.none': string;
  'reader.search.position': string;
  'reader.search.next': string;
  'reader.search.previous': string;
  'reader.annot.label': string;
  'reader.annot.highlight': string;
  'reader.annot.underline': string;
  'reader.annot.strikeout': string;
  'reader.annot.note': string;
  'reader.annot.ink': string;
  'reader.annot.notePrompt': string;
  'reader.annot.color': string;
  'reader.annot.undo': string;
  'reader.annot.count': Plural;
  'reader.annot.selectFirst': string;
  'reader.form.toggle': string;
  'reader.form.none': string;
  'reader.form.editing': string;
  'reader.save': string;
  'reader.save.nothing': string;
  'reader.save.done': string;
  'reader.save.failed': string;
  'reader.save.fontFailed': string;
  'nav.scan': string;
  'scan.title': string;
  'scan.blurb': string;
  'scan.mobileOnly': string;
  'scan.capture': string;
  'scan.addPages': string;
  'scan.empty.title': string;
  'scan.empty.hint': string;
  'scan.page': string;
  'scan.rotate': string;
  'scan.fileName': string;
  'scan.pre.pages': string;
  'scan.pre.size': string;
  'scan.pre.note': string;
  'scan.action.save': Plural;
  'scan.toast.saved': Plural;
  'scan.toast.failed': string;
  'crop.title': string;
  'crop.reset': string;
  'crop.apply': string;
  'scan.crop': string;
  'scan.cropped': string;
  'scan.rescan': string;
  'images.rotate': string;
  'images.crop': string;
  'common.close': string;
}

export const en: Strings = {
  'app.title': 'PDF Toolkit',
  'app.brand': 'Toolkit',
  'nav.editPages': 'Edit Pages',
  'nav.merge': 'Merge PDFs',
  'nav.split': 'Split PDF',
  'nav.images': 'Images to PDF',
  'nav.ocr': 'Make Searchable',
  'nav.compress': 'Compress',
  'nav.about': 'About',
  'nav.language': 'Language',

  'common.openAnother': 'Open another',
  'common.browse': 'Browse',
  'common.clear': 'Clear',
  'common.opening': 'Opening…',
  'common.open': 'Open',
  'common.showInFolder': 'Show in folder',
  'common.dismiss': 'Dismiss',
  'common.originalUntouched': 'Saves to a new file — your original is untouched.',
  'common.originalsUntouched': 'Saves to a new file — your originals are untouched.',
  'common.newFilesWritten': 'Writes new files — your original is untouched.',
  'common.pages': { one: '{n} page', other: '{n} pages' },
  'common.files': { one: '{n} file', other: '{n} files' },
  'common.saved': 'Saved',
  'common.savedWithWarnings': 'Saved, with warnings',
  'common.warningsStillWritten': '{detail} — the file was still written.',
  'common.couldNotSave': 'Could not save',
  'common.couldNotOpenPdf': 'Could not open that PDF',
  'common.notAdded': 'Not added',
  'common.cancel': 'Cancel',
  'common.cancelled': 'Cancelled',
  'common.nothingSaved': 'Nothing was saved.',

  'drop.pdf.title': 'Drop a PDF here',
  'drop.pdf.hint': 'or click to browse — your original file is never changed',
  'drop.pdfs.title': 'Drop PDFs here',
  'drop.pdfs.hint': 'or click to browse — add as many as you like',
  'drop.pdfs.more.title': 'Add more PDFs',
  'drop.pdfs.more.hint': 'drop them here, or click to browse',
  'drop.images.title': 'Drop images here',
  'drop.images.hint': 'or click to browse — they become one page each, in this order',
  'drop.images.more.title': 'Add more images',
  'drop.images.more.hint': 'drop them here, or click to browse',
  'drop.scan.title': 'Drop a scanned PDF here',
  'drop.reject.needPdf': 'Drop a PDF file here.',
  'drop.reject.needImages': 'Drop image files here.',
  'drop.reject.singlePdf': 'This tool works on one PDF at a time.',
  'drop.reject.singleImage': 'This tool works on one image at a time.',
  'drop.reject.ignored': {
    one: 'Ignored {n} file that is not {kind}.',
    other: 'Ignored {n} files that are not {kind}.',
  },
  'drop.kind.pdf': 'a PDF',
  'drop.kind.image': 'an image',

  'editPages.title': 'Edit Pages',
  'editPages.blurb':
    'Pick the pages you want, then save just those or remove them and keep the rest. '
    + 'Drag pages to rearrange them, and rotate any of them while you are here. '
    + 'Bookmarks and form fields are preserved.',
  'editPages.selectAll': 'Select all',
  'editPages.selectNone': 'Select none',
  'editPages.invert': 'Invert',
  'editPages.rotateLeft': 'Rotate left',
  'editPages.rotateRight': 'Rotate right',
  'editPages.reverse': 'Reverse',
  'editPages.reverseHint': 'Put the pages in the opposite order',
  'editPages.resetOrder': 'Reset order',
  'editPages.selectedCount': '{selected} of {total} selected',
  'editPages.reorderedSuffix': ' · reordered',
  'editPages.pagesLabel': 'Pages',
  'editPages.pagesPlaceholder': 'e.g. 1-3, 5, 8-10',
  'editPages.pagesHint': 'Type a range, or click pages in the grid.',
  'editPages.whatToDo': 'What to do',
  'editPages.mode.all': 'Save the whole document',
  'editPages.mode.allHint': 'All {n} pages, with any rearranging and rotation you have done.',
  'editPages.mode.keep': 'Keep selected pages',
  'editPages.mode.keepHint': 'Save only the pages you picked.',
  'editPages.mode.remove': 'Remove selected pages',
  'editPages.mode.removeHint': 'Save everything except the pages you picked.',
  'editPages.pre.outputPages': 'Output pages',
  'editPages.pre.all': 'all {n}',
  'editPages.pre.ofTotal': '{n} of {total}',
  'editPages.pre.none': 'none',
  'editPages.pre.which': 'Which',
  'editPages.pre.rotated': 'Rotated',
  'editPages.pre.order': 'Order',
  'editPages.pre.rearranged': 'rearranged',
  'editPages.pre.bookmarks': 'Bookmarks',
  'editPages.pre.bookmarksAll': 'all {n}',
  'editPages.pre.bookmarksSome': '{kept} of {total}',
  'editPages.notice.form': 'This PDF has form fields. They will be preserved.',
  'editPages.notice.bookmarksPruned':
    '{dead} of {total} bookmarks point to pages you are removing, so they will be taken out '
    + 'of the bookmark list. A heading whose own page goes but whose sub-sections stay is '
    + 'kept, pointing at the first one left.',
  'editPages.notice.selectOne': 'Select at least one page to save.',
  'editPages.notice.wouldRemoveAll': 'That would remove every page.',
  'editPages.notice.noChanges':
    'Nothing has changed yet. Drag a page to rearrange it, rotate one, or pick pages to keep or remove.',
  'editPages.action.saveAll': { one: 'Save the page', other: 'Save all {n} pages' },
  'editPages.action.saveSelected': 'Save selected pages',
  'editPages.action.removeAndSave': 'Remove and save the rest',
  'editPages.toast.bookmarksRemoved': {
    one: '{n} bookmark removed',
    other: '{n} bookmarks removed',
  },
  'editPages.page': 'Page {n}',
  'editPages.pageMoved': 'Page {n}, now in position {pos}',
  'editPages.rotatePage': 'Rotate page {n}',
  'editPages.rotateTitle': 'Rotate this page 90 degrees clockwise',

  'merge.title': 'Merge PDFs',
  'merge.blurb':
    'Add two or more PDFs and drag them into the order you want. '
    + 'The first file keeps its bookmarks and form fields.',
  'merge.addPdfs': 'Add PDFs',
  'merge.bookmarksLabel': 'Bookmarks',
  'merge.generateBookmarks': 'Add a bookmark for each file',
  'merge.generateBookmarksHint':
    'One top-level entry per file, named after it, jumping to its first page.',
  'merge.pre.files': 'Files',
  'merge.pre.totalPages': 'Total pages',
  'merge.pre.order': 'Order',
  'merge.pre.asListed': 'as listed',
  'merge.notice.laterBookmarks': {
    one: 'One later file has its own bookmarks. Only the first file’s bookmark tree can be carried over.',
    other: '{n} later files have their own bookmarks. Only the first file’s bookmark tree can be carried over.',
  },
  'merge.notice.firstKeeps': '{name} has bookmarks. Its full tree is preserved.',
  'merge.notice.needMore': 'Add at least one more PDF to merge.',
  'merge.action.merge': { one: 'Merge', two: 'Merge both PDFs', other: 'Merge {n} PDFs' },
  'merge.toast.merged': 'Merged',
  'merge.toast.couldNotMerge': 'Could not merge',
  'merge.toast.skipped': 'Skipped a file',
  'merge.toast.encrypted': '{name} is password-protected, so it can’t be merged.',
  'merge.toast.couldNotRead': 'Could not read {name}',
  'merge.chip.bookmarks': 'bookmarks',
  'merge.chip.form': 'form',
  'merge.reorder': 'Reorder {name}',
  'merge.remove': 'Remove {name}',

  'split.title': 'Split PDF',
  'split.blurb':
    'Break one PDF into several files. Each piece keeps its own bookmarks and form fields.',
  'split.clickToSplit': 'Click a page to start a new file there.',
  'split.previewOnly': 'Preview of the pages in this document.',
  'split.clearPoints': 'Clear split points',
  'split.howLabel': 'How to split',
  'split.mode.points': 'At pages I choose',
  'split.mode.pointsHint': 'Click pages in the grid to start a new file there.',
  'split.mode.every': 'Every N pages',
  'split.mode.everyHint': 'Equal-sized chunks, with a shorter last file.',
  'split.mode.each': 'One file per page',
  'split.mode.eachHint': 'Splits into {n} separate files.',
  'split.mode.bookmarks': 'At top-level bookmarks',
  'split.mode.bookmarksHint': 'Uses the {n} top-level bookmarks, named after each.',
  'split.mode.bookmarksNone': 'This PDF has no top-level bookmarks.',
  'split.perFile': 'Pages per file',
  'split.saveInto': 'Save into',
  'split.chooseFolder': 'Choose a folder…',
  'split.filesToCreate': 'Files to create ({n})',
  'split.andMore': '…and {n} more',
  'split.pre.files': 'Files',
  'split.pre.totalPages': 'Pages in total',
  'split.action.split': { one: 'Split into 1 file', other: 'Split into {n} files' },
  'split.toast.wrote': { one: 'Wrote {n} file', other: 'Wrote {n} files' },
  'split.toast.couldNotSplit': 'Could not split',
  'split.toast.clash': {
    one: '{n} file already exists there',
    other: '{n} files already exist there',
  },
  'split.toast.clashBody': '{names}. Pick a different folder, or move those files first.',
  'split.toast.clashAndMore': ', and {n} more',
  'split.toast.warnings': 'Split, with warnings',

  'images.title': 'Images to PDF',
  'images.blurb':
    'Add pictures and drag them into order — one image per page. '
    + 'JPEG, PNG, WebP, GIF, BMP, AVIF, HEIC and TIFF are all supported.',
  'images.addImages': 'Add images',
  'images.decoding': 'Decoding…',
  'images.pageSize': 'Page size',
  'images.size.fit': 'Fit page to image',
  'images.size.fitHint': 'Each page is exactly the image size. Nothing is cropped or scaled.',
  'images.size.a4': 'A4',
  'images.size.letter': 'Letter',
  'images.size.centredHint': 'Centred, portrait or landscape to suit each image.',
  'images.margin': 'Margin: {mm} mm',
  'images.pre.images': 'Images',
  'images.pre.pages': 'Pages',
  'images.pre.sourceSize': 'Source size',
  'images.notice.jpeg': 'Images are saved into the PDF as JPEG at high quality.',
  'images.notice.safe': 'Creates a new PDF — your images are untouched.',
  'images.action.create': 'Create PDF',
  'images.toast.created': {
    one: 'Created a 1-page PDF',
    other: 'Created a {n}-page PDF',
  },
  'images.toast.couldNotCreate': 'Could not create the PDF',
  'images.toast.couldNotRead': 'Could not read {name}',
  'images.tiffPage': '{name} (page {n} of {total})',

  'ocr.title': 'Make Searchable',
  'ocr.blurb':
    'Reads the text in a scanned PDF and adds an invisible text layer, so you can search, '
    + 'select and copy. The page still looks exactly the same.',
  'ocr.languages': 'Languages',
  'ocr.english': 'English',
  'ocr.hebrew': 'Hebrew',
  'ocr.languagesHint':
    'Pick only the languages actually in the document — extra ones slow it down and can reduce accuracy.',
  'ocr.options': 'Options',
  'ocr.skipText': 'Skip pages that already have text',
  'ocr.skipTextHint': 'Stops a second run from doubling up the text.',
  'ocr.alsoText': 'Also save the text as a .txt file',
  'ocr.alsoTextHint': 'Written next to the PDF, with the same name.',
  'ocr.pre.pages': 'Pages',
  'ocr.pre.resolution': 'Resolution',
  'ocr.pre.languages': 'Languages',
  'ocr.notice.time': 'Recognition takes a few seconds per page and runs entirely on your device.',
  'ocr.action.run': 'Make searchable',
  'ocr.action.working': 'Working…',
  'ocr.phase.starting': 'Starting…',
  'ocr.phase.loading': 'Loading language data…',
  'ocr.phase.reading': 'Reading',
  'ocr.phase.writing': 'Writing text layer…',
  'ocr.progress': '{phase} page {page} of {total}',
  'ocr.toast.recognised': {
    one: 'Recognised {n} word',
    other: 'Recognised {n} words',
  },
  'ocr.toast.skipped': {
    one: 'skipped {n} page that already had text',
    other: 'skipped {n} pages that already had text',
  },
  'ocr.toast.alsoSaved': 'text file saved alongside',
  'ocr.toast.noText': 'No text found',
  'ocr.toast.allHadText': 'Every page already contains text, so there was nothing to do.',
  'ocr.toast.nothingLegible':
    'Nothing legible was recognised. The scan may be too low-resolution or the wrong language may be selected.',
  'ocr.toast.failed': 'Could not make it searchable',

  'compress.title': 'Compress',
  'compress.blurb':
    'Rebuilds the PDF more efficiently without touching image quality. Text-heavy documents '
    + 'usually shrink 5–20%; scanned documents barely change.',
  'compress.pre.currentSize': 'Current size',
  'compress.pre.pages': 'Pages',
  'compress.pre.method': 'Method',
  'compress.pre.lossless': 'Lossless',
  'compress.notice.lossless':
    'Nothing is re-encoded or downsampled, so the result looks exactly the same. That also '
    + 'means scans, which are mostly image data, will barely shrink.',
  'compress.action.compress': 'Compress',
  'compress.toast.saved': 'Saved {size} ({pct}% smaller)',
  'compress.toast.savedBody': '{before} → {after}',
  'compress.toast.alreadySmall': 'Already well compressed',
  'compress.toast.alreadySmallBody':
    '{name} came out {amount}. The new file was still saved — you can safely delete it.',
  'compress.toast.noSmaller': 'no smaller',
  'compress.toast.onlySmaller': 'only {pct}% smaller',
  'compress.toast.failed': 'Could not compress',

  'about.title': 'About',
  'about.blurb': 'A small offline toolkit for everyday PDF jobs.',
  'about.privacyTitle': 'Everything happens on your device.',
  'about.privacyBody':
    'No file ever leaves your machine, nothing is uploaded, and the app works with no '
    + 'internet connection. There are no AI features.',
  'about.filesTitle': 'How your files are treated',
  'about.files1': 'Every tool writes a new file. Your originals are never modified.',
  'about.files2': 'The only irreversible action is overwriting a file, and Windows asks first.',
  'about.files3': 'Password-protected PDFs are detected and reported, never altered.',
  'about.builtWith': 'Built with',
  'about.versions': 'Versions',
  'about.credit.qpdf':
    'Page selection, rotation, splitting and compression — the engine that preserves bookmarks and form fields.',
  'about.credit.pdfjs': 'Page previews and thumbnails.',
  'about.credit.pdflib': 'Building PDFs from images and writing merge bookmarks.',
  'about.credit.electron': 'The application shell.',
  'about.credit.react': 'The interface.',

  'error.encrypted': 'This PDF is password-protected, so it can’t be opened.',
  'error.notPdf': 'This file doesn’t look like a PDF.',
  'error.missing': 'That file could not be found — it may have been moved or renamed.',
  'error.qpdf': 'qpdf could not process this file.',
  'error.qpdfJson': 'qpdf answered with something that was not the expected data.',
  'error.selectAtLeastOnePage': 'Select at least one page to keep.',
  'error.needTwoPdfs': 'Choose at least two PDFs to merge.',
  'error.noCanvas': 'Could not create a drawing canvas.',
  'error.pickerFailed': 'Could not open the file picker',

  'range.backwards': '“{part}” goes backwards — did you mean {from}-{to}?',
  'range.notARange': '“{part}” isn’t a page or range. Try something like 1-3, 5, 8-10.',
  'range.startsAtOne': 'Pages start at 1.',
  'range.outOfRange': {
    one: 'This document has 1 page, so {page} doesn’t exist.',
    other: 'This document has {n} pages, so {page} doesn’t exist.',
  },
  'range.badChunkSize': 'Enter how many pages per file (1 or more).',
  'range.noBookmarks': 'This PDF has no top-level bookmarks to split at.',
  'range.pointOutside': 'Split point {page} is outside this document.',
  'image.unreadable': '{name} could not be read as an image.',
  'image.heicEmpty': 'That HEIC file contains no image.',
  'image.heicFailed': 'That HEIC file could not be decoded.',
  'image.tiffEmpty': 'That TIFF contains no image.',
  'image.tiffFailed': 'That TIFF could not be decoded.',
  'image.encodeFailed': 'That image could not be encoded.',

  // ---------------------------------------------------------------- reader
  'nav.reader': 'Read',
  'reader.title': 'Read',
  'reader.lead': 'Open a PDF to read it: search the text, follow its bookmarks, and copy from it.',
  'reader.drop.title': 'Drop a PDF here to read it',
  'reader.drop.hint': 'Or browse for one. Nothing is changed unless you save.',
  'reader.openAnother': 'Open another',
  'reader.page.label': 'Page number',
  'reader.page.of': 'of {n}',
  'reader.zoom.in': 'Zoom in',
  'reader.zoom.out': 'Zoom out',
  'reader.zoom.fitWidth': 'Fit width',
  'reader.zoom.fitPage': 'Fit page',
  'reader.rotate': 'Rotate view',
  'reader.sidebar.toggle': 'Toggle sidebar',
  'reader.sidebar.label': 'Document navigation',
  'reader.sidebar.outline': 'Bookmarks',
  'reader.sidebar.thumbnails': 'Pages',
  'reader.outline.none': 'This document has no bookmarks.',
  'reader.search.toggle': 'Find in document',
  'reader.search.placeholder': 'Find in document',
  'reader.search.searching': 'Searching…',
  'reader.search.none': 'No matches',
  'reader.search.position': '{i} of {n}',
  'reader.search.next': 'Next match',
  'reader.search.previous': 'Previous match',
  'reader.annot.label': 'Annotate',
  'reader.annot.highlight': 'Highlight',
  'reader.annot.underline': 'Underline',
  'reader.annot.strikeout': 'Strike out',
  'reader.annot.note': 'Add a note',
  'reader.annot.ink': 'Draw',
  'reader.annot.notePrompt': 'Note',
  'reader.annot.color': 'Colour',
  'reader.annot.undo': 'Undo last annotation',
  'reader.annot.count': { one: '{n} annotation', other: '{n} annotations' },
  'reader.annot.selectFirst': 'Select some text on the page first.',
  'reader.form.toggle': 'Fill form fields',
  'reader.form.none': 'This document has no fillable fields.',
  'reader.form.editing': 'Filling form fields',
  'reader.save': 'Save a copy',
  'reader.save.nothing': 'Nothing to save yet',
  'reader.save.done': 'Saved a copy',
  'reader.save.failed': 'Could not save the copy',
  'reader.save.fontFailed': 'Could not load the font needed for Hebrew text.',
  'nav.scan': 'Scan',
  'scan.title': 'Scan',
  'scan.blurb': 'Photograph pages with the camera, arrange them, and save one PDF.',
  'scan.mobileOnly': 'Scanning needs a camera, so this tool only appears on a phone or tablet. On a computer, use Images to PDF instead.',
  'scan.capture': 'Scan pages',
  'scan.addPages': 'Scan more',
  'scan.empty.title': 'Scan a document',
  'scan.empty.hint': 'The camera finds the page edges and straightens each photo for you. Scan as many pages as you like, then arrange them here.',
  'scan.page': 'Page {n}',
  'scan.rotate': 'Rotate this page',
  'scan.fileName': 'Scan.pdf',
  'scan.pre.pages': 'Pages',
  'scan.pre.size': 'Captured',
  'scan.pre.note': 'Writes a new file. Your scans stay as they were photographed.',
  'scan.action.save': { one: 'Save 1 page as PDF', other: 'Save {n} pages as PDF' },
  'scan.toast.saved': { one: 'Saved 1 scanned page', other: 'Saved {n} scanned pages' },
  'scan.toast.failed': 'Could not finish scanning',
  'crop.title': 'Crop this page',
  'crop.reset': 'Whole page',
  'crop.apply': 'Crop',
  'scan.crop': 'Crop this page',
  'scan.cropped': 'cropped',
  'scan.rescan': 'Photograph this page again',
  'images.rotate': 'Rotate this image',
  'images.crop': 'Crop this image',
  'common.close': 'Close',
};

export const he: Strings = {
  'app.title': 'ארגז כלים ל‑PDF',
  'app.brand': 'ארגז כלים',
  'nav.editPages': 'עריכת עמודים',
  'nav.merge': 'איחוד קבצים',
  'nav.split': 'פיצול קובץ',
  'nav.images': 'תמונות ל‑PDF',
  'nav.ocr': 'הפיכה לחיפוש',
  'nav.compress': 'כיווץ',
  'nav.about': 'אודות',
  'nav.language': 'שפה',

  'common.openAnother': 'פתיחת קובץ אחר',
  'common.browse': 'עיון',
  'common.clear': 'ניקוי',
  'common.opening': 'פותח…',
  'common.open': 'פתיחה',
  'common.showInFolder': 'הצגה בתיקייה',
  'common.dismiss': 'סגירה',
  'common.originalUntouched': 'נשמר לקובץ חדש — הקובץ המקורי נשאר כמו שהוא.',
  'common.originalsUntouched': 'נשמר לקובץ חדש — הקבצים המקוריים נשארים כמו שהם.',
  'common.newFilesWritten': 'נכתבים קבצים חדשים — הקובץ המקורי נשאר כמו שהוא.',
  'common.pages': { one: 'עמוד אחד', two: 'שני עמודים', other: '{n} עמודים' },
  'common.files': { one: 'קובץ אחד', two: 'שני קבצים', other: '{n} קבצים' },
  'common.saved': 'נשמר',
  'common.savedWithWarnings': 'נשמר, עם אזהרות',
  'common.warningsStillWritten': '{detail} — הקובץ נכתב בכל זאת.',
  'common.couldNotSave': 'לא ניתן היה לשמור',
  'common.couldNotOpenPdf': 'לא ניתן היה לפתוח את קובץ ה‑PDF',
  'common.notAdded': 'לא נוסף',
  'common.cancel': 'ביטול',
  'common.cancelled': 'בוטל',
  'common.nothingSaved': 'שום דבר לא נשמר.',

  'drop.pdf.title': 'גררו לכאן קובץ PDF',
  'drop.pdf.hint': 'או לחצו לעיון — הקובץ המקורי לעולם לא משתנה',
  'drop.pdfs.title': 'גררו לכאן קובצי PDF',
  'drop.pdfs.hint': 'או לחצו לעיון — אפשר להוסיף כמה שתרצו',
  'drop.pdfs.more.title': 'הוספת קובצי PDF',
  'drop.pdfs.more.hint': 'גררו לכאן, או לחצו לעיון',
  'drop.images.title': 'גררו לכאן תמונות',
  'drop.images.hint': 'או לחצו לעיון — כל תמונה תהפוך לעמוד, לפי הסדר הזה',
  'drop.images.more.title': 'הוספת תמונות',
  'drop.images.more.hint': 'גררו לכאן, או לחצו לעיון',
  'drop.scan.title': 'גררו לכאן קובץ PDF סרוק',
  'drop.reject.needPdf': 'גררו לכאן קובץ PDF.',
  'drop.reject.needImages': 'גררו לכאן קובצי תמונה.',
  'drop.reject.singlePdf': 'הכלי הזה עובד על קובץ PDF אחד בכל פעם.',
  'drop.reject.singleImage': 'הכלי הזה עובד על תמונה אחת בכל פעם.',
  'drop.reject.ignored': {
    one: 'קובץ אחד לא נוסף כי הוא אינו {kind}.',
    two: 'שני קבצים לא נוספו כי הם אינם {kind}.',
    other: '{n} קבצים לא נוספו כי הם אינם {kind}.',
  },
  'drop.kind.pdf': 'קובץ PDF',
  'drop.kind.image': 'קובץ תמונה',

  'editPages.title': 'עריכת עמודים',
  'editPages.blurb':
    'בחרו את העמודים הרצויים, ואז שמרו רק אותם או הסירו אותם והשאירו את השאר. '
    + 'אפשר לגרור עמודים כדי לסדר אותם מחדש, ולסובב כל עמוד. '
    + 'הסימניות ושדות הטופס נשמרים.',
  'editPages.selectAll': 'בחירת הכול',
  'editPages.selectNone': 'ביטול הבחירה',
  'editPages.invert': 'היפוך הבחירה',
  'editPages.rotateLeft': 'סיבוב שמאלה',
  'editPages.rotateRight': 'סיבוב ימינה',
  'editPages.reverse': 'היפוך הסדר',
  'editPages.reverseHint': 'סידור העמודים בסדר הפוך',
  'editPages.resetOrder': 'איפוס הסדר',
  'editPages.selectedCount': '{selected} מתוך {total} נבחרו',
  'editPages.reorderedSuffix': ' · סודר מחדש',
  'editPages.pagesLabel': 'עמודים',
  'editPages.pagesPlaceholder': 'לדוגמה 1-3, 5, 8-10',
  'editPages.pagesHint': 'הקלידו טווח, או לחצו על עמודים ברשת.',
  'editPages.whatToDo': 'מה לעשות',
  'editPages.mode.all': 'שמירת המסמך כולו',
  'editPages.mode.allHint': 'כל {n} העמודים, כולל הסידור מחדש והסיבובים שביצעתם.',
  'editPages.mode.keep': 'שמירת העמודים שנבחרו',
  'editPages.mode.keepHint': 'שמירת העמודים שבחרתם בלבד.',
  'editPages.mode.remove': 'הסרת העמודים שנבחרו',
  'editPages.mode.removeHint': 'שמירת הכול חוץ מהעמודים שבחרתם.',
  'editPages.pre.outputPages': 'עמודים בפלט',
  'editPages.pre.all': 'כל {n}',
  'editPages.pre.ofTotal': '{n} מתוך {total}',
  'editPages.pre.none': 'אין',
  'editPages.pre.which': 'אילו',
  'editPages.pre.rotated': 'סובבו',
  'editPages.pre.order': 'סדר',
  'editPages.pre.rearranged': 'סודר מחדש',
  'editPages.pre.bookmarks': 'סימניות',
  'editPages.pre.bookmarksAll': 'כל {n}',
  'editPages.pre.bookmarksSome': '{kept} מתוך {total}',
  'editPages.notice.form': 'לקובץ הזה יש שדות טופס. הם יישמרו.',
  'editPages.notice.bookmarksPruned':
    '{dead} מתוך {total} סימניות מפנות לעמודים שאתם מסירים, ולכן הן יוסרו מרשימת הסימניות. '
    + 'כותרת שהעמוד שלה מוסר אך תת‑הסעיפים שלה נשארים תישמר, ותפנה לראשון שנשאר.',
  'editPages.notice.selectOne': 'בחרו לפחות עמוד אחד לשמירה.',
  'editPages.notice.wouldRemoveAll': 'פעולה זו תסיר את כל העמודים.',
  'editPages.notice.noChanges':
    'עדיין לא שיניתם כלום. גררו עמוד כדי לסדר מחדש, סובבו עמוד, או בחרו עמודים לשמירה או להסרה.',
  'editPages.action.saveAll': {
    one: 'שמירת העמוד',
    two: 'שמירת שני העמודים',
    other: 'שמירת כל {n} העמודים',
  },
  'editPages.action.saveSelected': 'שמירת העמודים שנבחרו',
  'editPages.action.removeAndSave': 'הסרה ושמירת השאר',
  'editPages.toast.bookmarksRemoved': {
    one: 'סימנייה אחת הוסרה',
    two: 'שתי סימניות הוסרו',
    other: '{n} סימניות הוסרו',
  },
  'editPages.page': 'עמוד {n}',
  'editPages.pageMoved': 'עמוד {n}, כעת במקום {pos}',
  'editPages.rotatePage': 'סיבוב עמוד {n}',
  'editPages.rotateTitle': 'סיבוב העמוד ב‑90 מעלות עם כיוון השעון',

  'merge.title': 'איחוד קובצי PDF',
  'merge.blurb':
    'הוסיפו שני קבצים או יותר וגררו אותם לסדר הרצוי. '
    + 'הקובץ הראשון שומר על הסימניות ושדות הטופס שלו.',
  'merge.addPdfs': 'הוספת קבצים',
  'merge.bookmarksLabel': 'סימניות',
  'merge.generateBookmarks': 'הוספת סימנייה לכל קובץ',
  'merge.generateBookmarksHint':
    'רשומה אחת ברמה העליונה לכל קובץ, על שמו, שמובילה לעמוד הראשון שלו.',
  'merge.pre.files': 'קבצים',
  'merge.pre.totalPages': 'סך העמודים',
  'merge.pre.order': 'סדר',
  'merge.pre.asListed': 'לפי הרשימה',
  'merge.notice.laterBookmarks': {
    one: 'לקובץ אחד נוסף יש סימניות משלו. רק עץ הסימניות של הקובץ הראשון יכול לעבור.',
    two: 'לשני קבצים נוספים יש סימניות משלהם. רק עץ הסימניות של הקובץ הראשון יכול לעבור.',
    other: 'ל‑{n} קבצים נוספים יש סימניות משלהם. רק עץ הסימניות של הקובץ הראשון יכול לעבור.',
  },
  'merge.notice.firstKeeps': 'ל‑{name} יש סימניות. העץ המלא שלו נשמר.',
  'merge.notice.needMore': 'הוסיפו עוד קובץ PDF אחד לפחות כדי לאחד.',
  'merge.action.merge': {
    one: 'איחוד',
    two: 'איחוד שני הקבצים',
    other: 'איחוד {n} קבצים',
  },
  'merge.toast.merged': 'אוחד',
  'merge.toast.couldNotMerge': 'לא ניתן היה לאחד',
  'merge.toast.skipped': 'קובץ אחד דולג',
  'merge.toast.encrypted': '{name} מוגן בסיסמה, ולכן לא ניתן לאחד אותו.',
  'merge.toast.couldNotRead': 'לא ניתן היה לקרוא את {name}',
  'merge.chip.bookmarks': 'סימניות',
  'merge.chip.form': 'טופס',
  'merge.reorder': 'שינוי מיקום של {name}',
  'merge.remove': 'הסרת {name}',

  'split.title': 'פיצול קובץ PDF',
  'split.blurb':
    'פיצול קובץ PDF אחד לכמה קבצים. כל חלק שומר על הסימניות ושדות הטופס שלו.',
  'split.clickToSplit': 'לחצו על עמוד כדי להתחיל שם קובץ חדש.',
  'split.previewOnly': 'תצוגה מקדימה של העמודים במסמך.',
  'split.clearPoints': 'ניקוי נקודות הפיצול',
  'split.howLabel': 'איך לפצל',
  'split.mode.points': 'בעמודים שאבחר',
  'split.mode.pointsHint': 'לחצו על עמודים ברשת כדי להתחיל שם קובץ חדש.',
  'split.mode.every': 'כל N עמודים',
  'split.mode.everyHint': 'מקטעים בגודל שווה, כשהאחרון עשוי להיות קצר יותר.',
  'split.mode.each': 'קובץ לכל עמוד',
  'split.mode.eachHint': 'פיצול ל‑{n} קבצים נפרדים.',
  'split.mode.bookmarks': 'לפי סימניות ראשיות',
  'split.mode.bookmarksHint': 'שימוש ב‑{n} הסימניות הראשיות, כל קובץ על שם הסימנייה שלו.',
  'split.mode.bookmarksNone': 'לקובץ הזה אין סימניות ראשיות.',
  'split.perFile': 'עמודים בכל קובץ',
  'split.saveInto': 'שמירה לתוך',
  'split.chooseFolder': 'בחירת תיקייה…',
  'split.filesToCreate': 'קבצים שייווצרו ({n})',
  'split.andMore': '…ועוד {n}',
  'split.pre.files': 'קבצים',
  'split.pre.totalPages': 'סך העמודים',
  'split.action.split': {
    one: 'פיצול לקובץ אחד',
    two: 'פיצול לשני קבצים',
    other: 'פיצול ל‑{n} קבצים',
  },
  'split.toast.wrote': {
    one: 'נכתב קובץ אחד',
    two: 'נכתבו שני קבצים',
    other: 'נכתבו {n} קבצים',
  },
  'split.toast.couldNotSplit': 'לא ניתן היה לפצל',
  'split.toast.clash': {
    one: 'כבר קיים שם קובץ אחד בשם הזה',
    two: 'כבר קיימים שם שני קבצים בשמות האלה',
    other: 'כבר קיימים שם {n} קבצים בשמות האלה',
  },
  'split.toast.clashBody': '{names}. בחרו תיקייה אחרת, או העבירו את הקבצים האלה קודם.',
  'split.toast.clashAndMore': ', ועוד {n}',
  'split.toast.warnings': 'פוצל, עם אזהרות',

  'images.title': 'תמונות ל‑PDF',
  'images.blurb':
    'הוסיפו תמונות וגררו אותן לסדר הרצוי — כל תמונה הופכת לעמוד. '
    + 'נתמכים JPEG, PNG, WebP, GIF, BMP, AVIF, HEIC ו‑TIFF.',
  'images.addImages': 'הוספת תמונות',
  'images.decoding': 'מפענח…',
  'images.pageSize': 'גודל העמוד',
  'images.size.fit': 'התאמת העמוד לתמונה',
  'images.size.fitHint': 'כל עמוד יהיה בדיוק בגודל התמונה. שום דבר לא נחתך ולא נמתח.',
  'images.size.a4': 'A4',
  'images.size.letter': 'Letter',
  'images.size.centredHint': 'ממורכז, לרוחב או לאורך בהתאם לכל תמונה.',
  'images.margin': 'שוליים: {mm} מ״מ',
  'images.pre.images': 'תמונות',
  'images.pre.pages': 'עמודים',
  'images.pre.sourceSize': 'גודל המקור',
  'images.notice.jpeg': 'התמונות נשמרות בקובץ ה‑PDF כ‑JPEG באיכות גבוהה.',
  'images.notice.safe': 'נוצר קובץ PDF חדש — התמונות שלכם נשארות כמו שהן.',
  'images.action.create': 'יצירת PDF',
  'images.toast.created': {
    one: 'נוצר קובץ PDF בן עמוד אחד',
    two: 'נוצר קובץ PDF בן שני עמודים',
    other: 'נוצר קובץ PDF בן {n} עמודים',
  },
  'images.toast.couldNotCreate': 'לא ניתן היה ליצור את קובץ ה‑PDF',
  'images.toast.couldNotRead': 'לא ניתן היה לקרוא את {name}',
  'images.tiffPage': '{name} (עמוד {n} מתוך {total})',

  'ocr.title': 'הפיכה לניתן לחיפוש',
  'ocr.blurb':
    'קורא את הטקסט בקובץ PDF סרוק ומוסיף שכבת טקסט בלתי נראית, כך שאפשר לחפש, '
    + 'לסמן ולהעתיק. העמוד ממשיך להיראות בדיוק אותו הדבר.',
  'ocr.languages': 'שפות',
  'ocr.english': 'אנגלית',
  'ocr.hebrew': 'עברית',
  'ocr.languagesHint':
    'בחרו רק את השפות שבאמת מופיעות במסמך — שפות מיותרות מאטות את התהליך ועלולות לפגוע בדיוק.',
  'ocr.options': 'אפשרויות',
  'ocr.skipText': 'דילוג על עמודים שכבר יש בהם טקסט',
  'ocr.skipTextHint': 'מונע הכפלה של הטקסט בהרצה חוזרת.',
  'ocr.alsoText': 'שמירת הטקסט גם כקובץ ‎.txt',
  'ocr.alsoTextHint': 'נשמר ליד קובץ ה‑PDF, באותו שם.',
  'ocr.pre.pages': 'עמודים',
  'ocr.pre.resolution': 'רזולוציה',
  'ocr.pre.languages': 'שפות',
  'ocr.notice.time': 'הזיהוי אורך כמה שניות לעמוד ורץ כולו על המכשיר שלך.',
  'ocr.action.run': 'הפיכה לניתן לחיפוש',
  'ocr.action.working': 'עובד…',
  'ocr.phase.starting': 'מתחיל…',
  'ocr.phase.loading': 'טוען נתוני שפה…',
  'ocr.phase.reading': 'קורא',
  'ocr.phase.writing': 'כותב את שכבת הטקסט…',
  'ocr.progress': '{phase} עמוד {page} מתוך {total}',
  'ocr.toast.recognised': {
    one: 'זוהתה מילה אחת',
    two: 'זוהו שתי מילים',
    other: 'זוהו {n} מילים',
  },
  'ocr.toast.skipped': {
    one: 'דולג עמוד אחד שכבר היה בו טקסט',
    two: 'דולגו שני עמודים שכבר היה בהם טקסט',
    other: 'דולגו {n} עמודים שכבר היה בהם טקסט',
  },
  'ocr.toast.alsoSaved': 'קובץ הטקסט נשמר לצידו',
  'ocr.toast.noText': 'לא נמצא טקסט',
  'ocr.toast.allHadText': 'בכל העמודים כבר יש טקסט, ולכן לא היה מה לעשות.',
  'ocr.toast.nothingLegible':
    'לא זוהה טקסט קריא. ייתכן שהסריקה ברזולוציה נמוכה מדי, או שנבחרה השפה הלא נכונה.',
  'ocr.toast.failed': 'לא ניתן היה להפוך את הקובץ לניתן לחיפוש',

  'compress.title': 'כיווץ',
  'compress.blurb':
    'בונה מחדש את קובץ ה‑PDF ביעילות רבה יותר בלי לפגוע באיכות התמונות. מסמכים עתירי טקסט '
    + 'מתכווצים בדרך כלל ב‑5%–20%; מסמכים סרוקים כמעט שלא משתנים.',
  'compress.pre.currentSize': 'גודל נוכחי',
  'compress.pre.pages': 'עמודים',
  'compress.pre.method': 'שיטה',
  'compress.pre.lossless': 'ללא אובדן איכות',
  'compress.notice.lossless':
    'שום דבר לא מקודד מחדש ולא מוקטן, ולכן התוצאה נראית בדיוק אותו הדבר. המשמעות היא גם '
    + 'שסריקות, שהן בעיקר נתוני תמונה, כמעט לא יתכווצו.',
  'compress.action.compress': 'כיווץ',
  'compress.toast.saved': 'נחסכו {size} ({pct}% פחות)',
  'compress.toast.savedBody': '{before} ← {after}',
  'compress.toast.alreadySmall': 'הקובץ כבר מכווץ היטב',
  'compress.toast.alreadySmallBody':
    '{name} יצא {amount}. הקובץ החדש נשמר בכל זאת — אפשר למחוק אותו בבטחה.',
  'compress.toast.noSmaller': 'לא קטן יותר',
  'compress.toast.onlySmaller': 'קטן ב‑{pct}% בלבד',
  'compress.toast.failed': 'לא ניתן היה לכווץ',

  'about.title': 'אודות',
  'about.blurb': 'ארגז כלים קטן ומקומי למשימות PDF יומיומיות.',
  'about.privacyTitle': 'הכול קורה על המכשיר שלך.',
  'about.privacyBody':
    'שום קובץ לא יוצא מהמחשב שלכם, שום דבר לא מועלה לרשת, והאפליקציה עובדת גם ללא חיבור '
    + 'לאינטרנט. אין בה שום יכולות בינה מלאכותית.',
  'about.filesTitle': 'איך מטופלים הקבצים שלכם',
  'about.files1': 'כל כלי כותב קובץ חדש. הקבצים המקוריים לעולם אינם משתנים.',
  'about.files2': 'הפעולה הבלתי הפיכה היחידה היא דריסת קובץ קיים, ו‑Windows שואל לפני כן.',
  'about.files3': 'קובצי PDF מוגני סיסמה מזוהים ומדווחים, ולעולם אינם משתנים.',
  'about.builtWith': 'נבנה בעזרת',
  'about.versions': 'גרסאות',
  'about.credit.qpdf':
    'בחירת עמודים, סיבוב, פיצול וכיווץ — המנוע ששומר על הסימניות ועל שדות הטופס.',
  'about.credit.pdfjs': 'תצוגות מקדימות ותמונות ממוזערות של עמודים.',
  'about.credit.pdflib': 'בניית קובצי PDF מתמונות וכתיבת סימניות באיחוד.',
  'about.credit.electron': 'מעטפת האפליקציה.',
  'about.credit.react': 'הממשק.',

  'error.encrypted': 'קובץ ה‑PDF הזה מוגן בסיסמה, ולכן לא ניתן לפתוח אותו.',
  'error.notPdf': 'הקובץ הזה לא נראה כמו קובץ PDF.',
  'error.missing': 'הקובץ לא נמצא — ייתכן שהוא הועבר או ששמו שונה.',
  'error.qpdf': 'qpdf לא הצליח לעבד את הקובץ הזה.',
  'error.qpdfJson': 'qpdf החזיר משהו שאינו הנתונים המצופים.',
  'error.selectAtLeastOnePage': 'בחרו לפחות עמוד אחד לשמירה.',
  'error.needTwoPdfs': 'בחרו לפחות שני קובצי PDF לאיחוד.',
  'error.noCanvas': 'לא ניתן היה ליצור משטח ציור.',
  'error.pickerFailed': 'לא ניתן היה לפתוח את בורר הקבצים',

  'range.backwards': '"{part}" בסדר הפוך — התכוונתם ל‑{from}-{to}?',
  'range.notARange': '"{part}" אינו עמוד או טווח. נסו משהו כמו 1-3, 5, 8-10.',
  'range.startsAtOne': 'מספור העמודים מתחיל ב‑1.',
  'range.outOfRange': {
    one: 'במסמך הזה יש עמוד אחד, ולכן {page} לא קיים.',
    two: 'במסמך הזה יש שני עמודים, ולכן {page} לא קיים.',
    other: 'במסמך הזה יש {n} עמודים, ולכן {page} לא קיים.',
  },
  'range.badChunkSize': 'הזינו כמה עמודים יהיו בכל קובץ (1 או יותר).',
  'range.noBookmarks': 'לקובץ הזה אין סימניות ראשיות שאפשר לפצל לפיהן.',
  'range.pointOutside': 'נקודת הפיצול {page} נמצאת מחוץ למסמך.',
  'image.unreadable': 'לא ניתן היה לקרוא את {name} כתמונה.',
  'image.heicEmpty': 'קובץ ה‑HEIC הזה אינו מכיל תמונה.',
  'image.heicFailed': 'לא ניתן היה לפענח את קובץ ה‑HEIC הזה.',
  'image.tiffEmpty': 'קובץ ה‑TIFF הזה אינו מכיל תמונה.',
  'image.tiffFailed': 'לא ניתן היה לפענח את קובץ ה‑TIFF הזה.',
  'image.encodeFailed': 'לא ניתן היה לקודד את התמונה.',
  // ---------------------------------------------------------------- reader
  'nav.reader': 'קריאה',
  'reader.title': 'קריאה',
  'reader.lead': 'פתחו קובץ PDF כדי לקרוא אותו: לחפש בטקסט, לעקוב אחר הסימניות ולהעתיק ממנו.',
  'reader.drop.title': 'גררו לכאן קובץ PDF לקריאה',
  'reader.drop.hint': 'או בחרו קובץ. דבר אינו משתנה אלא אם תשמרו.',
  'reader.openAnother': 'פתיחת קובץ אחר',
  'reader.page.label': 'מספר עמוד',
  'reader.page.of': 'מתוך {n}',
  'reader.zoom.in': 'הגדלה',
  'reader.zoom.out': 'הקטנה',
  'reader.zoom.fitWidth': 'התאמה לרוחב',
  'reader.zoom.fitPage': 'התאמה לעמוד',
  'reader.rotate': 'סיבוב התצוגה',
  'reader.sidebar.toggle': 'הצגת סרגל צד',
  'reader.sidebar.label': 'ניווט במסמך',
  'reader.sidebar.outline': 'סימניות',
  'reader.sidebar.thumbnails': 'עמודים',
  'reader.outline.none': 'במסמך זה אין סימניות.',
  'reader.search.toggle': 'חיפוש במסמך',
  'reader.search.placeholder': 'חיפוש במסמך',
  'reader.search.searching': 'מחפש…',
  'reader.search.none': 'אין תוצאות',
  'reader.search.position': '{i} מתוך {n}',
  'reader.search.next': 'התוצאה הבאה',
  'reader.search.previous': 'התוצאה הקודמת',
  'reader.annot.label': 'סימון',
  'reader.annot.highlight': 'הדגשה',
  'reader.annot.underline': 'קו תחתון',
  'reader.annot.strikeout': 'קו חוצה',
  'reader.annot.note': 'הוספת הערה',
  'reader.annot.ink': 'ציור',
  'reader.annot.notePrompt': 'הערה',
  'reader.annot.color': 'צבע',
  'reader.annot.undo': 'ביטול הסימון האחרון',
  'reader.annot.count': { one: 'סימון אחד', two: 'שני סימונים', other: '{n} סימונים' },
  'reader.annot.selectFirst': 'בחרו קודם טקסט בעמוד.',
  'reader.form.toggle': 'מילוי שדות טופס',
  'reader.form.none': 'במסמך זה אין שדות למילוי.',
  'reader.form.editing': 'מילוי שדות טופס',
  'reader.save': 'שמירת עותק',
  'reader.save.nothing': 'אין עדיין מה לשמור',
  'reader.save.done': 'עותק נשמר',
  'reader.save.failed': 'לא ניתן היה לשמור את העותק',
  'reader.save.fontFailed': 'לא ניתן היה לטעון את הגופן הדרוש לטקסט בעברית.',
  'nav.scan': 'סריקה',
  'scan.title': 'סריקה',
  'scan.blurb': 'צלמו עמודים במצלמה, סדרו אותם ושמרו קובץ PDF אחד.',
  'scan.mobileOnly': 'סריקה דורשת מצלמה, ולכן הכלי הזה מופיע רק בטלפון או בטאבלט. במחשב השתמשו ב\u2018תמונות ל\u2011PDF\u2019.',
  'scan.capture': 'סריקת עמודים',
  'scan.addPages': 'סריקת עוד',
  'scan.empty.title': 'סריקת מסמך',
  'scan.empty.hint': 'המצלמה מזהה את גבולות העמוד ומיישרת כל תצלום עבורכם. סרקו כמה עמודים שתרצו, ואז סדרו אותם כאן.',
  'scan.page': 'עמוד {n}',
  'scan.rotate': 'סיבוב העמוד',
  'scan.fileName': 'סריקה.pdf',
  'scan.pre.pages': 'עמודים',
  'scan.pre.size': 'נלכד',
  'scan.pre.note': 'נכתב קובץ חדש. הסריקות נשמרות כפי שצולמו.',
  'scan.action.save': { one: 'שמירת עמוד אחד כ\u2011PDF', two: 'שמירת שני עמודים כ\u2011PDF', other: 'שמירת {n} עמודים כ\u2011PDF' },
  'scan.toast.saved': { one: 'נשמר עמוד סרוק אחד', two: 'נשמרו שני עמודים סרוקים', other: 'נשמרו {n} עמודים סרוקים' },
  'scan.toast.failed': 'לא ניתן היה להשלים את הסריקה',
  'crop.title': 'חיתוך העמוד',
  'crop.reset': 'העמוד כולו',
  'crop.apply': 'חיתוך',
  'scan.crop': 'חיתוך העמוד',
  'scan.cropped': 'נחתך',
  'scan.rescan': 'צילום העמוד מחדש',
  'images.rotate': 'סיבוב התמונה',
  'images.crop': 'חיתוך התמונה',
  'common.close': 'סגירה',
};

export const dictionaries = { en, he } as const;
export type StringKey = keyof Strings;
