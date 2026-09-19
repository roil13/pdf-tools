import { useState } from 'react';
import { Toasts, useToasts } from './components/ui.js';
import { api } from './lib/api.js';
import {
  IconPages, IconMerge, IconSplit, IconImage, IconOcr, IconCompress, IconInfo,
  IconReader, IconScan,
} from './components/icons.js';
import { LocaleProvider, useLocale } from './i18n/LocaleProvider.js';
import type { StringKey } from './i18n/strings.js';
import type { DocRef } from './platform/types.js';
import { Reader } from './tools/Reader.js';
import { Scan } from './tools/Scan.js';
import { EditPages } from './tools/EditPages.js';
import { Merge } from './tools/Merge.js';
import { Split } from './tools/Split.js';
import { ImagesToPdf } from './tools/ImagesToPdf.js';
import { Ocr } from './tools/Ocr.js';
import { Compress } from './tools/Compress.js';
import { About } from './tools/About.js';

export type ToolId = 'reader' | 'scan' | 'pages' | 'merge' | 'split' | 'images' | 'ocr' | 'compress' | 'about';

const TOOLS: { id: ToolId; label: StringKey; Icon: () => React.JSX.Element }[] = [
  { id: 'reader',   label: 'nav.reader',    Icon: IconReader },
  { id: 'scan',     label: 'nav.scan',      Icon: IconScan },
  { id: 'pages',    label: 'nav.editPages', Icon: IconPages },
  { id: 'merge',    label: 'nav.merge',     Icon: IconMerge },
  { id: 'split',    label: 'nav.split',     Icon: IconSplit },
  { id: 'images',   label: 'nav.images',    Icon: IconImage },
  { id: 'ocr',      label: 'nav.ocr',       Icon: IconOcr },
  { id: 'compress', label: 'nav.compress',  Icon: IconCompress },
];

export function App() {
  return (
    <LocaleProvider>
      <Shell />
    </LocaleProvider>
  );
}

function Shell() {
  const [tool, setTool] = useState<ToolId>('reader');
  const toasts = useToasts();
  const { t } = useLocale();
  /**
   * The document the single-document tools share.
   *
   * Switching tools unmounts the old one, so without this every screen starts
   * empty and asks for a file again -- a storage picker round trip on a phone
   * for a document that is already open. Merge, Images to PDF and Scan are not
   * here on purpose: they take many files or produce them, so there is no single
   * current document to carry.
   */
  const [doc, setDoc] = useState<DocRef | null>(null);
  const shared = { doc, onDoc: setDoc };

  return (
    <div className="app">
      <nav className="rail" aria-label={t('app.title')}>
        <div className="rail__brand">
          <div className="rail__mark">PDF</div>
          <div className="rail__title">{t('app.brand')}</div>
        </div>

        {TOOLS.filter(({ id }) => id !== 'scan' || api.capabilities.camera).map(({ id, label, Icon }) => (
          <button
            key={id}
            className="rail__item"
            aria-current={tool === id}
            onClick={() => setTool(id)}
          >
            <Icon />{t(label)}
          </button>
        ))}

        <div className="rail__spacer" />
        <LanguageSwitch />
        <button className="rail__item" aria-current={tool === 'about'} onClick={() => setTool('about')}>
          <IconInfo />{t('nav.about')}
        </button>
      </nav>

      {tool === 'reader'   && <Reader toasts={toasts} {...shared} />}
      {tool === 'scan'     && <Scan toasts={toasts} />}
      {tool === 'pages'    && <EditPages toasts={toasts} {...shared} />}
      {tool === 'merge'    && <Merge toasts={toasts} />}
      {tool === 'split'    && <Split toasts={toasts} {...shared} />}
      {tool === 'images'   && <ImagesToPdf toasts={toasts} />}
      {tool === 'ocr'      && <Ocr toasts={toasts} {...shared} />}
      {tool === 'compress' && <Compress toasts={toasts} {...shared} />}
      {tool === 'about'    && <About />}

      <Toasts toasts={toasts.toasts} dismiss={toasts.dismiss} />
    </div>
  );
}

/**
 * Switching is instant: `dir`, `lang` and every string come from context, so
 * there is nothing to reload.
 */
function LanguageSwitch() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div className="langswitch" role="group" aria-label={t('nav.language')}>
      <button aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>English</button>
      <button aria-pressed={locale === 'he'} onClick={() => setLocale('he')} lang="he">עברית</button>
    </div>
  );
}

export type ToastApi = ReturnType<typeof useToasts>;

/**
 * What a single-document tool is given.
 *
 * `doc` is the document the app currently has open, shared so switching tools
 * does not mean picking the same file again; `onDoc` is how a tool announces
 * that the user picked a different one. See `src/lib/useSharedDoc.ts`.
 */
export interface SharedDocProps {
  toasts: ToastApi;
  doc: DocRef | null;
  onDoc: (ref: DocRef | null) => void;
}
