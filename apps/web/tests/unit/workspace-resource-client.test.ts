import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Brand } from '../../shared/schemas/brand'
import { createDemo } from '../fixtures/workspace'

const businessId = 'f0297959-5015-49c4-9eb4-e59e4fb27a46'
const brandId = '04a3b6af-e3f6-44de-b823-bbc64181d80c'

function makeBrand(revision = 3): Brand {
  return {
    id: brandId,
    organizationId: businessId,
    revision,
    slug: 'test-brand',
    name: 'Test Brand',
    profile: {
      description: 'Përshkrim',
      voice: 'Miqësor',
      audience: 'Klientë lokalë',
      industry: 'Kafene',
      city: 'Prishtinë',
      color: '#17694d',
      facebookUrl: '',
      instagramUrl: '',
      goals: [],
      researchSources: [],
      facts: [],
      guardrails: [],
    },
    settings: { emailApprovals: true, emailPublished: true, emailTips: false },
    timezone: 'Europe/Belgrade',
    locale: 'sq-XK',
    category: 'Kafene',
    status: 'active',
    archivedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
  }
}

describe('useWorkspace resource client', () => {
  const states = new Map<string, ReturnType<typeof ref>>()

  beforeEach(() => {
    states.clear()
    vi.resetModules()
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
    vi.stubGlobal('useState', (key: string, init: () => unknown) => {
      if (!states.has(key)) states.set(key, ref(init()))
      return states.get(key)
    })
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('getCurrentInstance', () => null)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('initializes bootstrap metadata without loading posts or assets arrays', async () => {
    const workspace = createDemo()
    workspace.revision = 9
    const bootstrap = {
      id: businessId,
      slug: 'test-brand',
      revision: 10,
      brand: makeBrand(4),
      preferences: workspace.preferences,
      onboarding: 2,
      dismissed: ['welcome'],
      notificationsRead: false,
      postCount: 37,
      assetCount: 12,
      capabilities: { posts: true, assets: true, brand: true, preferences: true },
    }
    const fetchMock = vi.fn().mockResolvedValue(bootstrap)
    vi.stubGlobal('$fetch', fetchMock)
    const { useWorkspace } = await import('../../app/composables/useWorkspace')
    const client = useWorkspace()
    client.applyBusiness({ id: businessId, slug: 'test-brand', workspace, brand: makeBrand(3) })

    await client.initBootstrap()
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspaces/${businessId}/bootstrap`, {
      retry: 0,
      timeout: 30000,
    })
    expect(client.bootstrap.value).toEqual(bootstrap)
    expect(client.data.value.revision).toBe(10)
    expect(client.data.value.brandRevision).toBe(4)
    expect(client.data.value.posts).toEqual(workspace.posts)
    expect(client.data.value.assets).toEqual(workspace.assets)
  })

  it('discovers the workspace without using the full /api/business response', async () => {
    const workspace = createDemo()
    const bootstrap = {
      id: businessId,
      slug: 'test-brand',
      revision: 10,
      brand: makeBrand(4),
      preferences: workspace.preferences,
      onboarding: 2,
      dismissed: [],
      notificationsRead: false,
      postCount: 2,
      assetCount: 1,
      capabilities: { posts: true, assets: true, brand: true, preferences: true },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce([{ id: businessId, slug: 'organization-slug' }])
      .mockResolvedValueOnce(bootstrap)
    vi.stubGlobal('$fetch', fetchMock)
    const { useWorkspace } = await import('../../app/composables/useWorkspace')
    const client = useWorkspace()

    const result = await client.initBootstrap()
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/organizations', {
      retry: 0,
      timeout: 30000,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/workspaces/${businessId}/bootstrap`, {
      retry: 0,
      timeout: 30000,
    })
    expect(fetchMock.mock.calls.flat().join(' ')).not.toContain('/api/business')
    expect(client.storageError.value).toBe('')
    expect(result).toEqual(bootstrap)
  })

  it('projects paginated resource refreshes into the compatibility arrays without duplicates', async () => {
    const workspace = createDemo()
    const post = { ...workspace.posts[0]!, caption: 'Refreshed' }
    const asset = { ...workspace.assets[0]!, rights: false }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ items: [post], page: 1, pageSize: 20, total: 1, hasNext: false })
      .mockResolvedValueOnce({ items: [asset], page: 1, pageSize: 20, total: 1, hasNext: false })
    vi.stubGlobal('$fetch', fetchMock)
    const { useWorkspace } = await import('../../app/composables/useWorkspace')
    const client = useWorkspace()
    client.applyBusiness({ id: businessId, slug: 'test-brand', workspace, brand: null })

    await client.loadPosts({ page: 1, pageSize: 20 })
    await client.loadAssets({ page: 1, pageSize: 20 })

    expect(client.data.value.posts.filter((item) => item.id === post.id)).toEqual([post])
    expect(client.data.value.assets.filter((item) => item.id === asset.id)).toEqual([asset])
  })

  it('updates the matching compatibility post and invalidates post pages after a mutation', async () => {
    const workspace = createDemo()
    workspace.revision = 1
    const updated = { ...workspace.posts[0]!, caption: 'Caption i ri', version: 2 }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ items: [workspace.posts[0]], page: 1, pageSize: 20, total: 2, hasNext: false })
      .mockResolvedValueOnce({ post: updated, workspaceRevision: 2 })
    vi.stubGlobal('$fetch', fetchMock)
    const { useWorkspace } = await import('../../app/composables/useWorkspace')
    const client = useWorkspace()
    client.applyBusiness({ id: businessId, slug: 'test-brand', workspace, brand: null })

    await client.loadPosts({ page: 1, pageSize: 20 })
    await expect(
      client.updatePost('p1', { caption: 'Caption i ri', workspaceRevision: 1, postVersion: 1 }),
    ).resolves.toEqual(updated)

    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/workspaces/${businessId}/posts`, {
      query: { page: 1, pageSize: 20 },
      retry: 0,
      timeout: 30000,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/workspaces/${businessId}/posts/p1`, {
      method: 'PUT',
      body: { caption: 'Caption i ri', workspaceRevision: 1, postVersion: 1 },
      retry: 0,
      timeout: 30000,
    })
    expect(client.postsCache.value).toEqual({})
    expect(client.data.value.posts.find((post) => post.id === updated.id)).toEqual(updated)
    expect(client.data.value.revision).toBe(2)
  })

  it('uses resource APIs for preferences and invalidates affected asset pages', async () => {
    const workspace = createDemo()
    workspace.revision = 4
    const brand = makeBrand(6)
    const asset = { ...workspace.assets[0]!, id: 'a-new', name: 'E re' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        items: [workspace.assets[0]],
        page: 1,
        pageSize: 20,
        total: 1,
        hasNext: false,
      })
      .mockResolvedValueOnce({ asset, workspaceRevision: 5 })
      .mockResolvedValueOnce({ preferences: { ...workspace.preferences, locale: 'en-US' }, workspaceRevision: 6, brandRevision: 7 })
    vi.stubGlobal('$fetch', fetchMock)
    const { useWorkspace } = await import('../../app/composables/useWorkspace')
    const client = useWorkspace()
    client.applyBusiness({ id: businessId, slug: 'test-brand', workspace, brand })

    await client.loadAssets({ page: 1, pageSize: 20 })
    await expect(client.updateAsset('a0', { name: 'E re', workspaceRevision: 4 })).resolves.toEqual(asset)
    await expect(client.updatePreferences({ locale: 'en-US' })).resolves.toMatchObject({
      workspaceRevision: 6,
      brandRevision: 7,
    })

    expect(client.assetsCache.value).toEqual({})
    expect(client.data.value.assets.find((item) => item.id === asset.id)).toEqual(asset)
    expect(client.data.value.revision).toBe(6)
    expect(client.data.value.brandRevision).toBe(7)
    expect(client.data.value.preferences.locale).toBe('en-US')
    expect(fetchMock).toHaveBeenNthCalledWith(3, `/api/workspaces/${businessId}/preferences`, {
      method: 'PUT',
      body: {
        locale: 'en-US',
        workspaceRevision: 5,
        brandRevision: 6,
      },
      retry: 0,
      timeout: 30000,
    })
  })

  it('keeps local state and sets conflict when a resource mutation returns 409', async () => {
    const workspace = createDemo()
    workspace.revision = 3
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ statusCode: 409, data: { message: 'Conflict' } }))
    const { useWorkspace } = await import('../../app/composables/useWorkspace')
    const client = useWorkspace()
    client.applyBusiness({ id: businessId, slug: 'test-brand', workspace, brand: null })

    await expect(client.updatePost('p1', { caption: 'new', workspaceRevision: 3, postVersion: 1 })).resolves.toBe(false)
    expect(client.conflict.value).toBe(true)
    expect(client.data.value.revision).toBe(3)
    expect(client.data.value.posts[0]!.caption).toBe(workspace.posts[0]!.caption)
  })

  it('invalidates filtered post pages after a mutation changes membership', async () => {
    const workspace = createDemo()
    workspace.revision = 3
    const updated = { ...workspace.posts[0]!, status: 'approved' as const, version: 2 }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ items: [workspace.posts[0]], page: 1, pageSize: 20, total: 1, hasNext: false })
      .mockResolvedValueOnce({ post: updated, workspaceRevision: 4 })
    vi.stubGlobal('$fetch', fetchMock)
    const { useWorkspace } = await import('../../app/composables/useWorkspace')
    const client = useWorkspace()
    client.applyBusiness({ id: businessId, slug: 'test-brand', workspace, brand: null })

    await client.loadPosts({ page: 1, pageSize: 20, status: 'scheduled' })
    await client.updatePost('p1', { status: 'approved', workspaceRevision: 3, postVersion: 1 })

    expect(client.postsCache.value).toEqual({})
    expect(client.data.value.posts[0]!.status).toBe('approved')
  })

  it('propagates bootstrap failures so middleware can distinguish authentication and missing-workspace errors', async () => {
    const failure = { statusCode: 401, data: { message: 'Session expired' } }
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(failure))
    const { useWorkspace } = await import('../../app/composables/useWorkspace')
    const client = useWorkspace()
    client.applyBusiness({ id: businessId, slug: 'test-brand', workspace: createDemo(), brand: null })

    await expect(client.initBootstrap()).rejects.toBe(failure)
    expect(client.storageError.value).toBe('workspace.sessionExpired')
  })

  it('updates metadata through PATCH without sending the full workspace', async () => {
    const workspace = createDemo()
    workspace.revision = 8
    const fetchMock = vi.fn().mockResolvedValue({
      workspaceRevision: 9,
      metadata: { onboarding: 2 },
    })
    vi.stubGlobal('$fetch', fetchMock)
    const { useWorkspace } = await import('../../app/composables/useWorkspace')
    const client = useWorkspace()
    client.applyBusiness({ id: businessId, slug: 'test-brand', workspace, brand: null })

    await expect(client.updateMetadata({ onboarding: 2 })).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspaces/${businessId}`, {
      method: 'PATCH',
      body: { onboarding: 2, revision: 8 },
      retry: 0,
      timeout: 30000,
    })
    expect(client.data.value.revision).toBe(9)
    expect(client.data.value.onboarding).toBe(2)
  })

  it('exports all post and asset pages through resource APIs', async () => {
    const workspace = createDemo()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ items: [workspace.posts[0]], page: 1, pageSize: 50, total: 2, hasNext: true })
      .mockResolvedValueOnce({ items: [workspace.posts[1]], page: 2, pageSize: 50, total: 2, hasNext: false })
      .mockResolvedValueOnce({ items: [workspace.assets[0]], page: 1, pageSize: 50, total: 1, hasNext: false })
    vi.stubGlobal('$fetch', fetchMock)
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }))
    vi.stubGlobal('document', { createElement: vi.fn(() => ({ click: vi.fn() })) })
    const { useWorkspace } = await import('../../app/composables/useWorkspace')
    const client = useWorkspace()
    client.applyBusiness({ id: businessId, slug: 'test-brand', workspace, brand: null })

    await client.exportData()
    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/workspaces/${businessId}/posts`, expect.objectContaining({ query: { page: 1, pageSize: 50 } }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/workspaces/${businessId}/posts`, expect.objectContaining({ query: { page: 2, pageSize: 50 } }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, `/api/workspaces/${businessId}/assets`, expect.objectContaining({ query: { page: 1, pageSize: 50 } }))
  })
})
