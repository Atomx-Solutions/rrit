import { loadAllDictionaries, loadDictionary } from '~/utils/dictionary'

/**
 * Puts the active language's dictionary in memory before anything renders, so
 * `t()` stays synchronous without every page shipping all five dictionaries.
 * Nothing may translate before this resolves, hence `enforce: 'pre'`.
 */
export default defineNuxtPlugin({
  name: 'i18n-dictionary',
  enforce: 'pre',
  parallel: false,
  async setup() {
    if (import.meta.server) {
      await loadAllDictionaries()
      return
    }
    const { locale } = useI18n()
    await loadDictionary(languageForLocale(locale.value))
  },
})
