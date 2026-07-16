'use client'

/**
 * Minimal client-side i18n: a context, a t() lookup, and a header
 * switcher. The choice persists in localStorage; English is both the
 * default and the fallback for any string a dictionary hasn't covered
 * yet — untranslated pages degrade to English, never to blank keys.
 */
import { createContext, useContext, useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import { DICTIONARIES, LOCALES, type Locale } from '@/lib/i18n-dict'

type I18n = { locale: Locale; setLocale: (l: Locale) => void; t: (key: string) => string }

const I18nContext = createContext<I18n>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => DICTIONARIES.en[key] ?? key,
})

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en')

  useEffect(() => {
    try {
      const stored = localStorage.getItem('locale') as Locale | null
      if (stored && stored in DICTIONARIES) setLocaleState(stored)
    } catch {
      /* private mode */
    }
  }, [])

  // Keep <html lang> honest so browser auto-translate (Chrome/Safari) and
  // screen readers see the real page language instead of a hardcoded "en".
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = (l: Locale) => {
    setLocaleState(l)
    try {
      localStorage.setItem('locale', l)
    } catch {
      /* private mode */
    }
  }

  const t = (key: string) => DICTIONARIES[locale][key] ?? DICTIONARIES.en[key] ?? key

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n()
  return (
    <label className="flex h-9 items-center gap-1.5 rounded-md border border-border px-2 text-muted-foreground hover:bg-secondary">
      <Globe className="size-4" />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="bg-transparent text-xs font-medium outline-none"
        aria-label="Language"
      >
        {LOCALES.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  )
}
