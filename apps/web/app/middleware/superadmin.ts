// Guards /admin/** pages. The API decides who is a superadmin; any failure
// (not signed in, not a superadmin, network error) leaves the admin area.
export default defineNuxtRouteMiddleware(async (to) => {
  try {
    await $fetch('/api/admin/me', { retry: 0 })
  } catch (error) {
    // Only a signed-out visitor returns to the admin page after login; a
    // signed-in non-superadmin would otherwise loop between login and /admin.
    const signedOut = (error as { statusCode?: number }).statusCode === 401
    return navigateTo(
      signedOut ? { path: '/login', query: { redirect: to.fullPath } } : '/login',
      { replace: true },
    )
  }
})
