export default defineNuxtRouteMiddleware(async (to) => {
  const workspace = useWorkspace()
  const { t } = useI18n()
  try {
    const routeId = typeof to.params.org === 'string' ? to.params.org : undefined
    const bootstrap = await workspace.initBootstrap(routeId)
    if (!bootstrap && to.path !== '/onboarding') return navigateTo('/onboarding', { replace: true })
    if (bootstrap) {
      await Promise.all([
        workspace.loadPosts({ page: 1, pageSize: 50 }),
        workspace.loadAssets({ page: 1, pageSize: 50 }),
      ])
    }
    if (bootstrap && to.path === '/onboarding' && bootstrap.onboarding >= 4)
      return navigateTo(`/app/${bootstrap.id}/${bootstrap.slug}/overview`, { replace: true })
    if (
      bootstrap &&
      to.params.org &&
      (to.params.org !== bootstrap.id || to.params.brand !== bootstrap.slug)
    )
      return abortNavigation(createError({ statusCode: 404, statusMessage: t('workspace.notFound') }))
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    if (status === 401) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
    return abortNavigation(
      createError({
        statusCode: status || 503,
        statusMessage: t('workspace.connectionFailed'),
      }),
    )
  }
})
