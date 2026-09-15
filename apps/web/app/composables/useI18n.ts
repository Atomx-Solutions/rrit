import sq from '~/locales/sq.json'
import en from '~/locales/en.json'

export type AppLocale = 'sq-XK' | 'en-US'
export type AppLanguage = 'sq' | 'en'

const dictionaries = { sq, en } as const

export function languageForLocale(value: string | undefined): AppLanguage {
  return value?.toLowerCase().startsWith('en') ? 'en' : 'sq'
}

export function useI18n() {
  const cookie = useCookie<AppLocale>('rrit-locale', { default: () => 'sq-XK' })
  const locale = useState<AppLocale>('rrit-ui-locale', () =>
    languageForLocale(cookie.value) === 'en' ? 'en-US' : 'sq-XK',
  )
  // Nuxt hydrates useState from the server payload. Re-read the locale cookie on
  // the client so a saved language is applied before the first interactive render.
  if (import.meta.client && languageForLocale(cookie.value) !== languageForLocale(locale.value)) {
    locale.value = languageForLocale(cookie.value) === 'en' ? 'en-US' : 'sq-XK'
  }

  function t(key: string, params: Record<string, string | number> = {}) {
    const language = languageForLocale(locale.value)
    const value = (dictionaries[language] as Record<string, string>)[key] || key
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name] ?? ''))
  }

  function setLocale(value: string) {
    const next: AppLocale = languageForLocale(value) === 'en' ? 'en-US' : 'sq-XK'
    locale.value = next
    cookie.value = next
    if (import.meta.client) {
      document.documentElement.lang = next === 'en-US' ? 'en' : 'sq'
      window.dispatchEvent(new CustomEvent('rrit-locale-change', { detail: next }))
    }
  }

  return { locale, language: computed(() => languageForLocale(locale.value)), t, setLocale, dictionaries }
}
