import { authScopeForPath } from '~~/shared/utils/auth-scope'
import { dictionaryFor, isDictionaryReady, loadDictionary, type AppLanguage } from '~/utils/dictionary'

export type AppLocale = 'sq-XK' | 'en-US' | 'de-CH' | 'it-CH' | 'fr-CH' | 'tr-TR'

export function languageForLocale(value: string | undefined): AppLanguage {
  const normalized = value?.toLowerCase() || ''
  if (normalized.startsWith('de')) return 'de'
  if (normalized.startsWith('it')) return 'it'
  if (normalized.startsWith('fr')) return 'fr'
  if (normalized.startsWith('tr')) return 'tr'
  return normalized.startsWith('en') ? 'en' : 'sq'
}

/** Superadmin copy is only needed while the browser is on an admin route. */
export function needsAdminDictionary() {
  if (!import.meta.client) return true
  return authScopeForPath(window.location.pathname) === 'admin'
}

/**
 * The admin console and the client app each remember their own language, so
 * switching the console to English never changes what a client reads.
 */
export function localeCookieName() {
  const path = import.meta.client ? window.location.pathname : useRequestURL().pathname
  return authScopeForPath(path) === 'admin' ? 'rrit-admin-locale' : 'rrit-locale'
}

export function useI18n() {
  const cookie = useCookie<AppLocale>(localeCookieName(), { default: () => 'de-CH' })
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
    const value = dictionaryFor(language)?.[key] || key
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name] ?? ''))
  }

  function apply(next: AppLocale) {
    locale.value = next
    cookie.value = next
    if (import.meta.client) {
      document.documentElement.lang = next
      window.dispatchEvent(new CustomEvent('rrit-locale-change', { detail: next }))
    }
  }

  function setLocale(value: string) {
    const next = localeForLanguage(languageForLocale(value))
    const language = languageForLocale(next)
    const admin = needsAdminDictionary()
    // Switch only once the new dictionary is in hand: applying it earlier would
    // render translation keys instead of text.
    if (isDictionaryReady(language, admin)) {
      apply(next)
      return
    }
    void loadDictionary(language, admin).then(() => apply(next))
  }

  return { locale, language: computed(() => languageForLocale(locale.value)), t, setLocale }
}

function localeForLanguage(language: AppLanguage): AppLocale {
  if (language === 'de') return 'de-CH'
  if (language === 'it') return 'it-CH'
  if (language === 'fr') return 'fr-CH'
  if (language === 'tr') return 'tr-TR'
  return language === 'en' ? 'en-US' : 'sq-XK'
}
