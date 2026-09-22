// Guards /admin/** pages. The API decides who is a superadmin; any failure
// (not signed in, not a superadmin, network error) leads to the admin login.
//
// A successful check is remembered for a few minutes so moving between admin
// pages does not wait for a round trip each time. This only affects which
// page is shown: every /api/admin/** request is still verified on the server.
const VERIFIED_FOR_MS = 5 * 60 * 1000

export default defineNuxtRouteMiddleware(async (to) => {
  const verifiedAt = useState<number>('superadmin-verified-at', () => 0)
  if (Date.now() - verifiedAt.value < VERIFIED_FOR_MS) return
  try {
    await $fetch('/api/admin/me', { retry: 0 })
    verifiedAt.value = Date.now()
  } catch (error) {
    verifiedAt.value = 0
    // A signed-out visitor returns to the requested page after login; a
    // signed-in account without the role is told it has no admin access.
    const signedOut = (error as { statusCode?: number }).statusCode === 401
    return navigateTo(
      { path: '/admin/login', query: signedOut ? { redirect: to.fullPath } : { denied: '1' } },
      { replace: true },
    )
  }
})
