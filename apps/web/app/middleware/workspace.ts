import { canReuseWorkspaceRedirect } from '~/utils/workspace-redirect'

export default defineNuxtRouteMiddleware(async (to) => {
  const workspace = useWorkspace()
  const { t } = useI18n()
  const pendingRedirect = useState<string | null>('workspace-home-redirect', () => null)
  const reuse = canReuseWorkspaceRedirect(
    pendingRedirect.value,
    to.path,
    workspace.ready.value,
    workspace.context.value,
  )
  pendingRedirect.value = null
  if (reuse) return
  // Moving between pages of the workspace already loaded needs no round trip
  // before the page shows; refresh it in the background instead.
  const loaded = workspace.ready.value ? workspace.context.value : null
  if (loaded && to.params.org === loaded.id && to.params.brand === loaded.slug) {
    workspace.initLive().catch((error) => {
      if ((error as { statusCode?: number }).statusCode === 401)
        navigateTo({ path: '/login', query: { redirect: to.fullPath } })
    })
    return
  }
  try {
    const business = await workspace.initLive()
    if (!business && to.path !== '/onboarding') return navigateTo('/onboarding', { replace: true })
    if (
      business &&
      to.path === '/onboarding' &&
      (business.workspace.onboarding >= 4 || business.workspace.onboardingSkipped)
    )
      return navigateTo(`/app/${business.id}/${business.slug}/overview`, { replace: true })
    if (
      business &&
      to.params.org &&
      (to.params.org !== business.id || to.params.brand !== business.slug)
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
