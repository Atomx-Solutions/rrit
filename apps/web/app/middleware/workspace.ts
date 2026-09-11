export default defineNuxtRouteMiddleware(async (to) => {
  const workspace = useWorkspace()
  try {
    const business = await workspace.initLive()
    if (!business && to.path !== '/onboarding') return navigateTo('/onboarding', { replace: true })
    if (business && to.path === '/onboarding' && business.workspace.onboarding >= 4)
      return navigateTo(`/app/${business.id}/${business.slug}/overview`, { replace: true })
    if (
      business &&
      to.params.org &&
      (to.params.org !== business.id || to.params.brand !== business.slug)
    )
      return abortNavigation(createError({ statusCode: 404, statusMessage: 'Hapësira nuk u gjet' }))
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    if (status === 401) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
    return abortNavigation(
      createError({
        statusCode: status || 503,
        statusMessage: 'Lidhja me hapësirën dështoi. Provo sërish.',
      }),
    )
  }
})
