import { authScopeForPath } from '~~/shared/utils/auth-scope'
import { loadDictionary } from '~/utils/dictionary'

/**
 * Superadmin copy ships as a chunk of its own, so entering an admin route from
 * anywhere else has to put it in memory before the page renders. Without this,
 * a client-side navigation into /admin would show translation keys.
 * The server already holds every dictionary.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return
  const { locale } = useI18n()
  await loadDictionary(
    languageForLocale(locale.value),
    authScopeForPath(to.path) === 'admin',
  )
})
