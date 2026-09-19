import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import { dictionaries, type StringKey } from './strings.js';
import { resolve, type Locale, type Vars } from './t.js';

const STORAGE_KEY = 'pdf-toolkit.locale';

export type Translate = (key: StringKey, vars?: Vars) => string;

interface LocaleContextValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: Translate;
  setLocale: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/** Hebrew is the only RTL language here; keep the check data-driven anyway. */
const RTL_LOCALES = new Set<Locale>(['he']);

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'he') return saved;
  } catch {
    // Private mode or blocked storage: fall through to OS detection.
  }
  // Electron reports the system locale here, so a Hebrew Windows starts in Hebrew.
  return navigator.language?.toLowerCase().startsWith('he') ? 'he' : 'en';
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const dir: 'ltr' | 'rtl' = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';

  // Set on <html> so every descendant inherits direction without any component
  // needing to know about it -- this is what mirrors the whole layout.
  // useLayoutEffect, not useEffect: applied after paint, a Hebrew user would see
  // the interface flash left-to-right on startup before it flipped.
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* not fatal */ }
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => resolve(dictionaries[locale][key], locale, vars),
    [locale],
  );

  const value = useMemo(
    () => ({ locale, dir, t, setLocale }),
    [locale, dir, t, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used inside a LocaleProvider');
  return ctx;
}

/** Convenience for the common case of only needing the translate function. */
export function useT(): Translate {
  return useLocale().t;
}
