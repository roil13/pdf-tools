import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { IconShield } from '../components/icons.js';
import { useT } from '../i18n/LocaleProvider.js';
import type { StringKey } from '../i18n/strings.js';

/** Library names and licence identifiers are proper nouns and stay as-is. */
const CREDITS: [name: string, licence: string, blurb: StringKey][] = [
  ['qpdf', 'Apache-2.0', 'about.credit.qpdf'],
  ['pdf.js', 'Apache-2.0', 'about.credit.pdfjs'],
  ['pdf-lib', 'MIT', 'about.credit.pdflib'],
  ['Electron', 'MIT', 'about.credit.electron'],
  ['React', 'MIT', 'about.credit.react'],
];

export function About() {
  const t = useT();
  const [versions, setVersions] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    void api.versions().then(setVersions).catch(() => setVersions(null));
  }, []);

  return (
    <main className="screen">
      <header className="screen__head">
        <div>
          <h1>{t('about.title')}</h1>
          <p>{t('about.blurb')}</p>
        </div>
      </header>

      <div className="screen__body">
        <div className="screen__main">
          <div className="prose">
            <div className="notice notice--ok">
              <IconShield />
              <div>
                <strong>{t('about.privacyTitle')}</strong> {t('about.privacyBody')}
              </div>
            </div>

            <h2>{t('about.filesTitle')}</h2>
            <ul>
              <li>{t('about.files1')}</li>
              <li>{t('about.files2')}</li>
              <li>{t('about.files3')}</li>
            </ul>

            <h2>{t('about.builtWith')}</h2>
            <table className="credits">
              <tbody>
                {CREDITS.map(([name, licence, blurb]) => (
                  <tr key={name}>
                    <th><bdi>{name}</bdi></th>
                    <td className="credits__lic"><bdi>{licence}</bdi></td>
                    <td>{t(blurb)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {versions && (
              <>
                <h2>{t('about.versions')}</h2>
                <table className="credits">
                  <tbody>
                    {Object.entries(versions).map(([k, v]) => (
                      <tr key={k}>
                        <th><bdi>{k}</bdi></th>
                        <td colSpan={2} className="selectable"><bdi>{v}</bdi></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
