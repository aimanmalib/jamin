// UI text lives in lang/en.json and lang/ms.json (same keys); components ask for a dotted key.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };
import { config } from './data/config.js';
import { lookup, type Dict } from './text.js';

export type Lang = 'en' | 'ms';
const DICTS: Record<Lang, Dict> = { en, ms };

interface LangState { lang: Lang; setLang: (l: Lang) => void; t: (key: string, vars?: Record<string, string | number>) => string }

const LangContext = createContext<LangState | null>(null);

function initialLang(): Lang {
  const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(config.web.languageStorageKey);
  return saved === 'ms' || saved === 'en' ? saved : config.site.defaultLanguage;
}

export function LangProvider({ children }: { children: ReactNode }): ReactNode {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const value = useMemo<LangState>(() => ({
    lang,
    setLang: (l) => { localStorage.setItem(config.web.languageStorageKey, l); setLangState(l); },
    t: (key, vars) => lookup(DICTS[lang], key, vars),
  }), [lang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangState {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang outside LangProvider');
  return ctx;
}
