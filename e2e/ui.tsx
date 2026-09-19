/**
 * Mounts the real Edit Pages screen in a real renderer, against a stubbed IPC
 * layer, and drives it from script.
 *
 * Unit tests cover the pure selection and ordering rules; this covers the part
 * they cannot -- that the component actually renders, that dnd-kit is wired up,
 * and that what reaches the main process matches what the grid is showing.
 */
import { useState } from 'react';
import type { DocRef } from '../src/platform/types.js';
import { createRoot } from 'react-dom/client';
import { EditPages } from '../src/tools/EditPages.js';
import { LocaleProvider, useLocale } from '../src/i18n/LocaleProvider.js';
import type { Toast } from '../src/components/ui.js';
import '../src/styles.css';

declare global {
  interface Window {
    e2eUi?: unknown;
    lastEdit?: unknown;
    toastLog?: string[];
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
  outline: [
    { title: 'Chapter One', page: 1, depth: 0 },
    { title: 'Section 1.1', page: 2, depth: 1 },
    { title: 'Section 1.2', page: 5, depth: 1 },
    { title: 'Chapter Two', page: 6, depth: 0 },
    { title: 'פרק שלוש', page: 8, depth: 0 },
  ],
};

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

window.toastLog = [];

// Stub the preload bridge. Only what Edit Pages actually calls.
(window as unknown as { api: unknown }).api = {
  pathForFile: () => 'C:/fake/outlined-form.pdf',
  openPdfs: () => ok(['C:/fake/outlined-form.pdf']),
  inspect: () => ok(INFO),
  readFile: async () => {
    const bytes = new Uint8Array(await (await fetch(FIXTURE)).arrayBuffer());
    return { ok: true as const, value: bytes };
  },
  saveAs: () => ok('C:/fake/out.pdf'),
  editPages: (req: unknown) => {
    window.lastEdit = req;
    return ok({ output: 'C:/fake/out.pdf', bookmarks: { removed: 0, retargeted: 0 } });
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

/** Exposes the locale setter so the driver can switch language from script. */
function Harness() {
  const { setLocale } = useLocale();
  (window as unknown as { setLocale?: (l: 'en' | 'he') => void }).setLocale = setLocale;
  // The shared document slot is real state here rather than a stub, because the
  // screen writes to it whenever a file is loaded -- a no-op prop would pass the
  // type checker and then throw on the first open.
  const [doc, setDoc] = useState<DocRef | null>(null);
  return <EditPages toasts={toasts as never} doc={doc} onDoc={setDoc} />;
}

try {
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider><Harness /></LocaleProvider>,
  );
  window.e2eUi = { mounted: true };
} catch (err) {
  window.e2eUi = { mounted: false, error: String(err) };
}

// Surface anything that blows up after mount, which is where the interesting
// failures live (effects, lazy rendering, event handlers).
window.addEventListener('error', (e) => {
  window.e2eUi = { mounted: false, error: String(e.message) };
});
window.addEventListener('unhandledrejection', (e) => {
  window.e2eUi = { mounted: false, error: `unhandled rejection: ${String(e.reason)}` };
});
