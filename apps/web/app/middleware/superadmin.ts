// Guards /admin/** pages. The API decides who is a superadmin; any failure
// (not signed in, not a superadmin, network error) leads to the admin login.
export default defineNuxtRouteMiddleware(async (to) => {
  try {
    await $fetch('/api/admin/me', { retry: 0 })
  } catch (error) {
    // A signed-out visitor returns to the requested page after login; a
    // signed-in account without the role is told it has no admin access.
    const signedOut = (error as { statusCode?: number }).statusCode === 401
    return navigateTo(
      { path: '/admin/login', query: signedOut ? { redirect: to.fullPath } : { denied: '1' } },
      { replace: true },
    )
  }
})
