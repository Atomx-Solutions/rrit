import { authScopeForPath } from '~~/shared/utils/auth-scope'

// Supabase stores both sessions in cookies it names after the storage key.
const SESSION_COOKIE_PREFIX = 'sb-'

function hasStoredSession() {
  return document.cookie.split('; ').some((entry) => entry.startsWith(SESSION_COOKIE_PREFIX))
}

export default defineNuxtPlugin(() => {
  let refreshing = false

  async function refreshWhenVisible() {
    if (document.visibilityState !== 'visible' || refreshing) return
    // Public pages carry no session, and loading the auth client there would
    // pull the Supabase SDK into the landing page's critical path for nothing.
    if (!hasStoredSession()) return
    refreshing = true
    try {
      const { authClientFor } = await import('~/utils/auth-client')
      await authClientFor(authScopeForPath(window.location.pathname)).refreshSession()
    } catch {
      // A best-effort refresh: a missing configuration or an offline tab must
      // not surface as an unhandled rejection.
    } finally {
      refreshing = false
    }
  }

  document.addEventListener('visibilitychange', refreshWhenVisible)
  window.addEventListener('focus', refreshWhenVisible)

  return {
    provide: {
      refreshAuthSession: refreshWhenVisible,
    },
  }
})
