import { describe, expect, it, vi } from 'vitest'

const calls: string[] = []

vi.mock('../../server/utils/brands', () => ({
  getBrandBySlug: vi.fn(async () => ({ id: 'brand-1', revision: 3 })),
  updateBrand: vi.fn(async () => {
    calls.push('brand')
    return { id: 'brand-1', revision: 4 }
  }),
}))
vi.mock('../../server/utils/workspace-preferences', () => ({
  updateWorkspacePreferences: vi.fn(async () => {
    calls.push('preferences')
    return { workspaceRevision: 6, brandRevision: 4, preferences: {} }
  }),
}))
vi.mock('../../server/utils/workspace-metadata', () => ({
  updateWorkspaceMetadata: vi.fn(async () => {
    calls.push('metadata')
    return { workspaceRevision: 7, metadata: { onboarding: 1 } }
  }),
}))

describe('workspace onboarding transaction service', () => {
  it('runs Brand, preferences and metadata on the same client and returns all resources', async () => {
    const { saveWorkspaceOnboarding } = await import('../../server/utils/workspace-onboarding')
    const result = await saveWorkspaceOnboarding({} as never, {
      businessId: 'business-1',
      userId: 'user-1',
      slug: 'test-brand',
      input: {
        workspaceRevision: 5,
        brandRevision: 3,
        brand: { name: 'Test', profile: {}, category: 'cafe' },
        preferences: { timezone: 'UTC', locale: 'sq-XK', emailApprovals: true, emailPublished: true, emailTips: false },
        metadata: { onboarding: 1 },
      },
    })
    expect(calls).toEqual(['brand', 'preferences', 'metadata'])
    expect(result.workspaceRevision).toBe(7)
  })

  it('stops before later resources when an earlier resource fails', async () => {
    calls.length = 0
    const { updateBrand } = await import('../../server/utils/brands')
    vi.mocked(updateBrand).mockRejectedValueOnce(new Error('brand failed'))
    const { saveWorkspaceOnboarding } = await import('../../server/utils/workspace-onboarding')
    await expect(saveWorkspaceOnboarding({} as never, {
      businessId: 'business-1', userId: 'user-1', slug: 'test-brand',
      input: {
        workspaceRevision: 5, brandRevision: 3,
        brand: { name: 'Test', profile: {}, category: 'cafe' },
        preferences: { timezone: 'UTC', locale: 'sq-XK', emailApprovals: true, emailPublished: true, emailTips: false },
        metadata: { onboarding: 1 },
      },
    })).rejects.toThrow('brand failed')
    expect(calls).toEqual([])
  })

  it('stops before metadata when preferences fail so the transaction can roll back Brand', async () => {
    calls.length = 0
    const { updateWorkspacePreferences } = await import('../../server/utils/workspace-preferences')
    vi.mocked(updateWorkspacePreferences).mockRejectedValueOnce(new Error('preferences failed'))
    const { saveWorkspaceOnboarding } = await import('../../server/utils/workspace-onboarding')
    await expect(saveWorkspaceOnboarding({} as never, {
      businessId: 'business-1', userId: 'user-1', slug: 'test-brand',
      input: {
        workspaceRevision: 5, brandRevision: 3,
        brand: { name: 'Test', profile: {}, category: 'cafe' },
        preferences: { timezone: 'UTC' }, metadata: { onboarding: 1 },
      },
    })).rejects.toThrow('preferences failed')
    expect(calls).toEqual(['brand'])
  })

  it('propagates metadata failure so the transaction rolls back Brand and preferences', async () => {
    calls.length = 0
    const { updateWorkspaceMetadata } = await import('../../server/utils/workspace-metadata')
    vi.mocked(updateWorkspaceMetadata).mockRejectedValueOnce(new Error('metadata failed'))
    const { saveWorkspaceOnboarding } = await import('../../server/utils/workspace-onboarding')
    await expect(saveWorkspaceOnboarding({} as never, {
      businessId: 'business-1', userId: 'user-1', slug: 'test-brand',
      input: {
        workspaceRevision: 5, brandRevision: 3,
        brand: { name: 'Test', profile: {}, category: 'cafe' },
        preferences: { timezone: 'UTC' }, metadata: { onboarding: 1 },
      },
    })).rejects.toThrow('metadata failed')
    expect(calls).toEqual(['brand', 'preferences'])
  })
})
