import type { Workspace } from '../schemas/workspace'
export function emptyWorkspace(name = '', email = ''): Workspace {
  return {
    revision: 0,
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
      facts: [],
    },
    preferences: {
      name,
      email,
      timezone: 'Europe/Belgrade',
      currency: 'EUR',
      emailApprovals: true,
      emailPublished: true,
      emailTips: false,
    },
    posts: [],
    assets: [],
    campaigns: [],
    strategies: [],
    onboarding: 0,
    dismissed: [],
    notificationsRead: false,
  }
}
