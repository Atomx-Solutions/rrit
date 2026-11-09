import { canReuseWorkspaceRedirect } from '~/utils/workspace-redirect'
import { authClient } from '~/utils/auth-client'

function startMonthlyPlannerLoad(path: string) {
  if (!/\/monthly-planner\/?$/.test(path)) return null
  // The endpoint derives the current month from the saved workspace timezone.
  // It can run alongside /api/business once the session check is complete.
  return useMonthlyPlannerData()
}

export default defineNuxtRouteMiddleware(async (to) => {
  // An account opened through Google skips the sign-up form; nothing in the
  // workspace opens until its terms are accepted on the consent step.
  if (import.meta.client && (await authClient.termsAccepted()) === false)
    return navigateTo({ path: '/auth/callback', query: { next: to.fullPath } }, { replace: true })
  const plannerLoad = startMonthlyPlannerLoad(to.path)
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
    // The client still navigates immediately; on the server the plan must be
    // ready before HTML is sent or the main content would remain client-only.
    if (import.meta.server && plannerLoad) await plannerLoad
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
