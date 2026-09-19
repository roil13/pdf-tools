import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconUpload, IconWarn, IconInfo, IconCheck, IconShield } from './icons.js';
import { useT } from '../i18n/LocaleProvider.js';
import { api } from '../lib/api.js';
import type { DocRef } from '../platform/types.js';

/* ------------------------------------------------------------------ notices */

export type NoticeKind = 'info' | 'warn' | 'error' | 'ok';

export function Notice({ kind = 'info', children }: { kind?: NoticeKind; children: React.ReactNode }) {
  const Icon = kind === 'warn' || kind === 'error' ? IconWarn : kind === 'ok' ? IconCheck : IconInfo;
  return (
    <div className={`notice notice--${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      <Icon />
      <div>{children}</div>
    </div>
  );
}

/* ----------------------------------------------------------------- dropzone */

interface DropZoneProps {
  onFiles: (refs: DocRef[]) => void;
  onBrowse: () => void;
  accept: 'pdf' | 'image';
  /** Reject multi-file drops outright rather than silently taking the first. */
  single?: boolean;
  title: string;
  hint: string;
  slim?: boolean;
  onReject?: (message: string) => void;
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|tiff?|heic|heif)$/i;

export function DropZone({
  onFiles, onBrowse, accept, single, title, hint, slim, onReject,
}: DropZoneProps) {
  const t = useT();
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);

    // How a dropped File becomes a handle is the host's problem, not this
    // component's: under Electron it needs webUtils, because Electron 32
    // removed File.path.
    const all = api.filesToRefs([...e.dataTransfer.files]);
    const match = accept === 'pdf' ? /\.pdf$/i : IMAGE_EXT;
    const good = all.filter((r) => match.test(r.name));
    const ignored = all.length - good.length;

    if (!good.length) {
      onReject?.(t(accept === 'pdf' ? 'drop.reject.needPdf' : 'drop.reject.needImages'));
      return;
    }
    if (single && good.length > 1) {
      onReject?.(t(accept === 'pdf' ? 'drop.reject.singlePdf' : 'drop.reject.singleImage'));
      return;
    }
    if (ignored > 0) {
      onReject?.(t('drop.reject.ignored', {
        n: ignored,
        kind: t(accept === 'pdf' ? 'drop.kind.pdf' : 'drop.kind.image'),
      }));
    }
    onFiles(good);
  }, [accept, single, onFiles, onReject, t]);

  return (
    <div
      className={`drop ${slim ? 'drop--slim' : 'drop--full'}`}
      data-over={over}
      role="button"
      tabIndex={0}
      onClick={onBrowse}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBrowse(); } }}
      onDragEnter={(e) => { e.preventDefault(); depth.current++; setOver(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => { if (--depth.current <= 0) { depth.current = 0; setOver(false); } }}
      onDrop={handleDrop}
    >
      <div className="drop__icon"><IconUpload /></div>
      <strong>{title}</strong>
      <span>{hint}</span>
    </div>
  );
}

/* -------------------------------------------------------------- preflight */

export function Preflight({
  rows, safeNote,
}: { rows: [string, string][]; safeNote?: string }) {
  return (
    <div className="preflight">
      {rows.map(([k, v]) => (
        <div className="preflight__line" key={k}>
          <span className="preflight__k">{k}</span>
          <span className="preflight__v">{v}</span>
        </div>
      ))}
      {safeNote && (
        <div className="preflight__safe"><IconShield />{safeNote}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ toasts */

export interface Toast {
  id: number;
  kind: NoticeKind;
  title: string;
  body?: string;
  actions?: { label: string; run: () => void }[];
  /** 0 keeps the toast until dismissed. */
  ttl?: number;
}

let toastId = 0;

/**
 * Errors, and successes offering an action, stay until dismissed. Without a cap
 * a run of operations pushes the oldest off the top of the screen, where they
 * cannot be reached or dismissed.
 */
const MAX_TOASTS = 4;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { ...t, id }].slice(-MAX_TOASTS));
    return id;
  }, []);

  // Memoised as a whole: every screen lists this object in useCallback deps, so
  // a fresh object each render would rebuild all of their callbacks and defeat
  // the memoisation entirely.
  return useMemo(() => ({
    toasts,
    push,
    dismiss,
    error: (title: string, body?: string) => push({ kind: 'error', title, body, ttl: 0 }),
    ok: (title: string, body?: string, actions?: Toast['actions']) =>
      push({ kind: 'ok', title, body, actions, ttl: actions ? 0 : 4000 }),
    info: (title: string, body?: string) => push({ kind: 'info', title, body, ttl: 4000 }),
    warn: (title: string, body?: string) => push({ kind: 'warn', title, body, ttl: 6000 }),
  }), [toasts, push, dismiss]);
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toasts">
      {toasts.map((t) => <ToastCard key={t.id} toast={t} dismiss={dismiss} />)}
    </div>
  );
}

function ToastCard({ toast, dismiss }: { toast: Toast; dismiss: (id: number) => void }) {
  const t = useT();
  useEffect(() => {
    if (!toast.ttl) return;
    const h = setTimeout(() => dismiss(toast.id), toast.ttl);
    return () => clearTimeout(h);
  }, [toast, dismiss]);

  return (
    <div className={`toast toast--${toast.kind}`} role="status">
      <div className="toast__title">{toast.title}</div>
      {toast.body && <div className="toast__body selectable"><bdi>{toast.body}</bdi></div>}
      <div className="toast__actions">
        {toast.actions?.map((a) => (
          <button key={a.label} className="btn btn--sm" onClick={() => { a.run(); dismiss(toast.id); }}>
            {a.label}
          </button>
        ))}
        <button className="btn btn--sm btn--ghost" onClick={() => dismiss(toast.id)}>{t('common.dismiss')}</button>
      </div>
    </div>
  );
}
