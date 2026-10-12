import sq from '~/locales/client/sq.json'
import en from '~/locales/client/en.json'
import de from '~/locales/client/de.json'
import adminSq from '~/locales/admin/sq.json'
import adminEn from '~/locales/admin/en.json'

export type AppLocale = 'sq-XK' | 'en-US' | 'de-DE'
export type AppLanguage = 'sq' | 'en' | 'de'

// Client/shared text and Superadmin text intentionally live in separate
// dictionaries. Consumers still use one translation function.
const dictionaries = {
  sq: { ...sq, ...adminSq },
  en: { ...en, ...adminEn },
  // German client text falls back to English until each screen is translated.
  de: { ...en, ...adminEn, ...de },
} as const

export function languageForLocale(value: string | undefined): AppLanguage {
  const normalized = value?.toLowerCase() || ''
  if (normalized.startsWith('de')) return 'de'
  return normalized.startsWith('en') ? 'en' : 'sq'
}

export function useI18n() {
  const cookie = useCookie<AppLocale>('rrit-locale', { default: () => 'de-DE' })
  const locale = useState<AppLocale>('rrit-ui-locale', () =>
    localeForLanguage(languageForLocale(cookie.value)),
  )
  // Nuxt hydrates useState from the server payload. Re-read the locale cookie on
  // the client so a saved language is applied before the first interactive render.
  if (import.meta.client && languageForLocale(cookie.value) !== languageForLocale(locale.value)) {
    locale.value = localeForLanguage(languageForLocale(cookie.value))
  }

  function t(key: string, params: Record<string, string | number> = {}) {
    const language = languageForLocale(locale.value)
    const value = (dictionaries[language] as Record<string, string>)[key] || key
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name] ?? ''))
  }

  function setLocale(value: string) {
    const next = localeForLanguage(languageForLocale(value))
    locale.value = next
    cookie.value = next
    if (import.meta.client) {
      document.documentElement.lang = languageForLocale(next)
      window.dispatchEvent(new CustomEvent('rrit-locale-change', { detail: next }))
    }
  }

  return { locale, language: computed(() => languageForLocale(locale.value)), t, setLocale, dictionaries }
}

function localeForLanguage(language: AppLanguage): AppLocale {
  if (language === 'de') return 'de-DE'
  return language === 'en' ? 'en-US' : 'sq-XK'
}
