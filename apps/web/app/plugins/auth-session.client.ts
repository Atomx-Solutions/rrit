import { authClientFor } from '~/utils/auth-client'
import { authScopeForPath } from '~~/shared/utils/auth-scope'

export default defineNuxtPlugin(() => {
  let refreshing = false

  async function refreshWhenVisible() {
    if (document.visibilityState !== 'visible' || refreshing) return
    refreshing = true
    try {
      await authClientFor(authScopeForPath(window.location.pathname)).refreshSession()
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
