// When a superadmin closes an organization, anyone still on its pages is sent
// to the login form, which signs the account out and says why. A light status
// check runs every half minute while a workspace page is open and visible, on
// returning to the tab and on every page change; any other request the page
// makes that is refused for the closure does the same at once.
const CHECK_INTERVAL_MS = 30_000

function closedResponse(status: number | undefined, body: unknown) {
  if (status !== 403 || !body || typeof body !== 'object') return false
  const data = body as { message?: string; data?: { code?: string } }
  return data.data?.code === 'ORGANIZATION_CLOSED' || data.message === 'server.ORGANIZATION_CLOSED'
}

export default defineNuxtPlugin((nuxtApp) => {
  let leaving = false

  function leave() {
    if (leaving || window.location.pathname === '/login') return
    leaving = true
    void Promise.resolve(
      nuxtApp.runWithContext(() => navigateTo({ path: '/login', query: { closed: '1' } }, { replace: true })),
    ).finally(() => { leaving = false })
  }

  const baseFetch = globalThis.$fetch
  globalThis.$fetch = baseFetch.create({
    onResponseError({ response }) {
      if (closedResponse(response.status, response._data)) leave()
    },
  }) as typeof globalThis.$fetch

  async function check() {
    if (document.visibilityState !== 'visible' || leaving) return
    if (!window.location.pathname.startsWith('/app/')) return
    // Read directly, so the answer never depends on how other requests are made.
    try {
      const response = await fetch('/api/workspace-status', { credentials: 'same-origin', cache: 'no-store' })
      if (response.status === 403 && closedResponse(403, await response.json().catch(() => null))) leave()
    } catch {
      // Offline or the server is restarting: the next check tries again.
    }
  }

  window.setInterval(check, CHECK_INTERVAL_MS)
  document.addEventListener('visibilitychange', check)
  window.addEventListener('focus', check)
  nuxtApp.$router.afterEach(() => { void check() })
})
