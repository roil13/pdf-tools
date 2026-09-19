/**
 * Mounts the real Reader screen in a real renderer against a stubbed platform,
 * and drives it from script.
 *
 * The unit tests cover the scroll arithmetic and the matcher. This covers what
 * they cannot: that pdf.js actually rasterises into the virtualised stack, that
 * the text layer produces selectable spans, that search finds text in a real
 * document, and that the outline resolves to real page numbers.
 */
import { useState } from 'react';
import type { DocRef } from '../src/platform/types.js';
import { createRoot } from 'react-dom/client';
import { Reader } from '../src/tools/Reader.js';
import { LocaleProvider, useLocale } from '../src/i18n/LocaleProvider.js';
import type { Toast } from '../src/components/ui.js';
import '../src/styles.css';

declare global {
  interface Window {
    e2eReader?: unknown;
    toastLog?: string[];
    setLocale?: (l: 'en' | 'he') => void;
    /** Base64 of the last bytes the screen asked the host to write. */
    lastWrite?: string | null;
  }
}

const FIXTURE = './outlined-form.pdf';

// Matches test/fixtures/outlined-form.pdf, as reported by qpdf.
const INFO = {
  path: 'C:/fake/outlined-form.pdf',
  name: 'outlined-form.pdf',
  pageCount: 10,
  sizeBytes: 3981,
  hasOutlines: true,
  hasAcroForm: true,
  isEncrypted: false,
  outline: [],
};

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

window.toastLog = [];
window.lastWrite = null;

// Stub the preload bridge, exactly as the Edit Pages harness does. The platform
// adapter under test sits ABOVE this, so it is exercised rather than replaced.
(window as unknown as { api: unknown }).api = {
  pathForFile: () => 'C:/fake/outlined-form.pdf',
  openPdfs: () => ok(['C:/fake/outlined-form.pdf']),
  inspect: () => ok(INFO),
  readFile: async () => {
    const bytes = new Uint8Array(await (await fetch(FIXTURE)).arrayBuffer());
    return { ok: true as const, value: bytes };
  },
  saveAs: () => ok('C:/fake/out.pdf'),
  writeFile: (_p: string, bytes: Uint8Array) => {
    // Kept so the driver can verify the real saved document, rather than
    // trusting that a toast appeared.
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    window.lastWrite = btoa(s);
    return ok('C:/fake/out.pdf');
  },
  openFile: () => ok(undefined),
  revealInFolder: () => ok(undefined),
};

const toasts = {
  toasts: [] as Toast[],
  push: () => 0,
  dismiss: () => {},
  error: (t: string, b?: string) => { window.toastLog!.push(`error: ${t} ${b ?? ''}`); return 0; },
  ok: (t: string, b?: string) => { window.toastLog!.push(`ok: ${t} ${b ?? ''}`); return 0; },
  info: (t: string) => { window.toastLog!.push(`info: ${t}`); return 0; },
  warn: (t: string, b?: string) => { window.toastLog!.push(`warn: ${t} ${b ?? ''}`); return 0; },
};

/**
 * The `.app` wrapper is not decoration: it is the flex parent that gives
 * `.screen` its height. Without it the reader's scroll container sizes to its
 * content and never scrolls, which is a harness artefact that looks exactly
 * like a broken virtualiser.
 */
function Harness() {
  const { setLocale } = useLocale();
  window.setLocale = setLocale;
  // Real state, not a stub: the reader writes to this slot on every open.
  const [doc, setDoc] = useState<DocRef | null>(null);
  return <div className="app"><Reader toasts={toasts as never} doc={doc} onDoc={setDoc} /></div>;
}

try {
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider><Harness /></LocaleProvider>,
  );
  window.e2eReader = { mounted: true };
} catch (err) {
  window.e2eReader = { mounted: false, error: String(err) };
}

window.addEventListener('error', (e) => {
  window.e2eReader = { mounted: false, error: String(e.message) };
});
window.addEventListener('unhandledrejection', (e) => {
  window.e2eReader = { mounted: false, error: `unhandled rejection: ${String(e.reason)}` };
});
