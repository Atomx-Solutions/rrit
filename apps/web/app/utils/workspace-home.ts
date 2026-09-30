type WorkspaceHomeState = {
  base: string
  hasContext: boolean
  onboarding: number
  onboardingSkipped: boolean
}

export function workspaceHomeDestination(state: WorkspaceHomeState) {
  if (!state.hasContext) return '/onboarding'
  if (state.onboardingSkipped) return `${state.base}/overview`
  if (state.onboarding < 3) return '/onboarding'
  return `${state.base}/overview`
}
