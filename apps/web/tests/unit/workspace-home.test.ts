import { describe, expect, it } from 'vitest'
import { workspaceHomeDestination } from '../../app/utils/workspace-home'

describe('workspace home destination', () => {
  it('opens Overview after completed onboarding', () => {
    expect(workspaceHomeDestination({
      base: '/app/org/brand',
      hasContext: true,
      onboarding: 3,
      onboardingSkipped: false,
    })).toBe('/app/org/brand/overview')
  })

  it('keeps skipped onboarding users out of onboarding', () => {
    expect(workspaceHomeDestination({
      base: '/app/org/brand',
      hasContext: true,
      onboarding: 1,
      onboardingSkipped: true,
    })).toBe('/app/org/brand/overview')
  })
})
