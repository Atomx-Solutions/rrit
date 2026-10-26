import type { Workspace } from '../schemas/workspace'
import { DEFAULT_TIMEZONE, videoDeliverablesDefault } from '../schemas/workspace'
export function emptyWorkspace(name = '', email = ''): Workspace {
  return {
    revision: 0,
    brandRevision: 0,
    brand: {
      name: '',
      industry: '',
      city: '',
      description: '',
      voice: '',
      audience: '',
      color: '#137d59',
      facebookUrl: '',
      instagramUrl: '',
      goals: [],
      status: 'active',
      researchSources: [],
      eventResearch: {
        enabled: false,
        categories: { publicEvents: true, seasonalEvents: true, industryTrends: true },
      },
      videoDeliverables: videoDeliverablesDefault,
      facts: [],
    },
    preferences: {
      name,
      email,
      timezone: DEFAULT_TIMEZONE,
      locale: 'de-CH',
      currency: 'CHF',
    },
    posts: [],
    assets: [],
    campaigns: [],
    strategies: [],
    onboarding: 0,
    onboardingSkipped: false,
    dismissed: [],
    notificationsRead: false,
  }
}
