import { authClient } from '~/utils/auth-client'

export default defineNuxtPlugin(() => {
  let refreshing = false

  async function refreshWhenVisible() {
    if (document.visibilityState !== 'visible' || refreshing) return
    refreshing = true
    try {
      await authClient.refreshSession()
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
