import { useCallback, useState } from 'react';
import type { SharedDocProps } from '../App.js';
import { useSharedDoc } from '../lib/useSharedDoc.js';
import { api, formatBytes, stripExt, errorText } from '../lib/api.js';
import type { DocRef, DocInfo } from '../platform/types.js';
import { UserError } from '../lib/errors.js';
import { DropZone, Notice, Preflight } from '../components/ui.js';
import { IconSpinner, IconCompress } from '../components/icons.js';
import { useT } from '../i18n/LocaleProvider.js';

export function Compress({ toasts, doc, onDoc }: SharedDocProps) {
  const t = useT();
  const [info, setInfo] = useState<DocInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refs: DocRef[]) => {
    try {
      const next = await api.inspect(refs[0]);
      if (next.isEncrypted) throw new UserError('error.encrypted');
      setInfo(next);
      // Only once it opened: announcing a file that failed would hand the same
      // broken document to the next tool.
      onDoc(refs[0]);
    } catch (err) {
      toasts.error(t('common.couldNotOpenPdf'), errorText(err, t));
    }
  }, [toasts, t, onDoc]);
  // Pick up whatever the previous tool had open.
  useSharedDoc(doc, info?.ref.id, load);


  const browse = useCallback(async () => {
    const picked = await api.openPdfs(false);
    if (picked.length) await load(picked);
  }, [load]);

  const run = useCallback(async () => {
    if (!info) return;
    const output = await api.saveAs(`${stripExt(info.ref.name)} (compressed).pdf`);
    if (!output) return;

    setBusy(true);
    try {
      const res = await api.compress(info.ref, output);
      const saved = res.beforeBytes - res.afterBytes;
      const pct = res.beforeBytes ? (saved / res.beforeBytes) * 100 : 0;

      if (pct < 1) {
        // Be honest rather than dressing up a non-result as a win.
        toasts.info(
          t('compress.toast.alreadySmall'),
          t('compress.toast.alreadySmallBody', {
            name: output.name,
            amount: pct <= 0
              ? t('compress.toast.noSmaller')
              : t('compress.toast.onlySmaller', { pct: pct.toFixed(1) }),
          }),
        );
      } else {
        toasts.ok(
          t('compress.toast.saved', { size: formatBytes(saved), pct: pct.toFixed(0) }),
          t('compress.toast.savedBody', {
            before: formatBytes(res.beforeBytes), after: formatBytes(res.afterBytes),
          }),
          [
            { label: t('common.open'), run: () => void api.openFile(output) },
            { label: t('common.showInFolder'), run: () => void api.revealInFolder(output) },
          ],
        );
      }
    } catch (err) {
      toasts.error(t('compress.toast.failed'), errorText(err, t));
    } finally {
      setBusy(false);
    }
  }, [info, toasts, t]);

  return (
    <main className="screen">
      <header className="screen__head">
        <div>
          <h1>{t('compress.title')}</h1>
          <p>{t('compress.blurb')}</p>
        </div>
        {info && (
          <div className="screen__headActions">
            <button className="btn" onClick={() => void browse()}>{t('common.openAnother')}</button>
          </div>
        )}
      </header>

      <div className="screen__body">
        <div className="screen__main">
          <div className="empty">
            {!info ? (
              <DropZone
                accept="pdf"
                single
                onFiles={(p) => void load(p)}
                onBrowse={() => void browse()}
                onReject={(m) => toasts.warn(t('common.notAdded'), m)}
                title={t('drop.pdf.title')}
                hint={t('drop.pdf.hint')}
              />
            ) : (
              <div className="bigfile">
                <div className="bigfile__name"><bdi>{info.ref.name}</bdi></div>
                <div className="bigfile__meta">
                  {t('common.pages', { n: info.pageCount })} · {formatBytes(info.sizeBytes)}
                </div>
              </div>
            )}
          </div>
        </div>

        {info && (
          <aside className="panel">
            <Preflight
              rows={[
                [t('compress.pre.currentSize'), formatBytes(info.sizeBytes)],
                [t('compress.pre.pages'), `${info.pageCount}`],
                [t('compress.pre.method'), t('compress.pre.lossless')],
              ]}
              safeNote={t('common.originalUntouched')}
            />

            <Notice kind="info">{t('compress.notice.lossless')}</Notice>

            <div className="panel__actions">
              <button className="btn btn--primary btn--block" disabled={busy} onClick={() => void run()}>
                {busy ? <IconSpinner /> : <IconCompress />}
                {t('compress.action.compress')}
              </button>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
