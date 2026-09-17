import {
  workspaceSchema,
  validateTransition,
  type Workspace,
  type Post,
  type Asset,
} from '../../shared/schemas/workspace'
import { emptyWorkspace } from '../../shared/utils/empty-workspace'
import type { Brand } from '../../shared/schemas/brand'
import type {
  AssetMetadataUpdate,
  AssetUploadMetadata,
  PaginatedResponse,
  PostCreate,
  PostUpdate,
  WorkspaceAssetListQuery,
  WorkspaceBootstrap,
  WorkspaceMetadataUpdate,
  WorkspacePostListQuery,
  PreferencesUpdate,
  WorkspacePreferencesResponse,
  WorkspaceOnboardingUpdate,
} from '../../shared/schemas/workspace-resources'

export function useWorkspace() {
  const { t } = useI18n()
  const data = useState<Workspace>('workspace', () => emptyWorkspace())
  const ready = useState('workspace-ready', () => false)
  const context = useState<{ id: string; slug: string } | null>('workspace-context', () => null)
  const canonicalBrand = useState<Brand | null>('canonical-brand', () => null)
  const storageError = useState('storage-error', () => '')
  const conflict = useState('workspace-conflict', () => false)
  const syncing = useState('workspace-syncing', () => false)
  const bootstrap = useState<WorkspaceBootstrap | null>('workspace-bootstrap', () => null)
  const postsCache = useState<Record<string, PaginatedResponse<Post>>>('workspace-posts-cache', () => ({}))
  const assetsCache = useState<Record<string, PaginatedResponse<Asset>>>('workspace-assets-cache', () => ({}))
  const brandState = computed(() => canonicalBrand.value)
  const preferencesState = computed(() => data.value.preferences)
  const toast = getCurrentInstance() ? useToast() : null
  const base = computed(() =>
    context.value ? `/app/${context.value.id}/${context.value.slug}` : '/app',
  )
  function applyCanonicalBrand(brand: Brand) {
    canonicalBrand.value = brand
    data.value.brand = workspaceSchema.shape.brand.parse({
      ...brand.profile,
      name: brand.name,
      industry: brand.profile.industry || brand.category,
      status: brand.status,
    })
    data.value.brandRevision = brand.revision
  }
  function applyBusiness(business: { id: string; slug: string; workspace: Workspace; brand?: Brand | null }) {
    data.value = workspaceSchema.parse(business.workspace)
    context.value = { id: business.id, slug: business.slug }
    if (business.brand) applyCanonicalBrand(business.brand)
    else canonicalBrand.value = null
    ready.value = true
    storageError.value = ''
    conflict.value = false
  }
  function resourceError(error: unknown) {
    const problem = error as { statusCode?: number; data?: { message?: string } }
    if (problem.statusCode === 409) conflict.value = true
    storageError.value =
      problem.statusCode === 401
        ? t('workspace.sessionExpired')
        : problem.data?.message || t('workspace.saveFailed')
  }
  function replacePost(post: Post) {
    data.value.posts = data.value.posts.map((item) => (item.id === post.id ? post : item))
    for (const page of Object.values(postsCache.value)) {
      if (page.items.some((item) => item.id === post.id)) page.items = page.items.map((item) => (item.id === post.id ? post : item))
    }
  }
  function applyPostResource(post: Post, workspaceRevision: number) {
    data.value.revision = workspaceRevision
    replacePost(post)
    invalidatePosts()
  }
  function addPost(post: Post) {
    if (!data.value.posts.some((item) => item.id === post.id)) data.value.posts = [post, ...data.value.posts]
    const first = postsCache.value['{"page":1,"pageSize":20}']
    if (first && !first.items.some((item) => item.id === post.id)) first.items = [post, ...first.items].slice(0, first.pageSize)
  }
  function replaceAssetAt(id: string, asset: Asset) {
    data.value.assets = data.value.assets.map((item) => (item.id === id ? asset : item))
    for (const page of Object.values(assetsCache.value)) {
      page.items = page.items.map((item) => (item.id === id ? asset : item))
    }
  }
  function addAsset(asset: Asset) {
    if (!data.value.assets.some((item) => item.id === asset.id)) data.value.assets = [asset, ...data.value.assets]
    const first = assetsCache.value['{"page":1,"pageSize":20}']
    if (first && !first.items.some((item) => item.id === asset.id)) first.items = [asset, ...first.items].slice(0, first.pageSize)
  }
  function removeAsset(id: string) {
    data.value.assets = data.value.assets.filter((item) => item.id !== id)
    for (const page of Object.values(assetsCache.value)) page.items = page.items.filter((item) => item.id !== id)
  }
  function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
    const refreshed = new Map(incoming.map((item) => [item.id, item]))
    return [...incoming, ...current.filter((item) => !refreshed.has(item.id))]
  }
  function invalidatePosts() {
    postsCache.value = {}
  }
  function invalidateAssets() {
    assetsCache.value = {}
  }
  async function initBootstrap(id = context.value?.id) {
    try {
      let workspaceId = id
      if (!workspaceId) {
        const organizations = await $fetch<{ id: string }[]>('/api/v1/organizations', {
          retry: 0,
          timeout: 30000,
        })
        workspaceId = organizations[0]?.id
      }
      if (!workspaceId) {
        data.value = emptyWorkspace()
        context.value = null
        canonicalBrand.value = null
        bootstrap.value = null
        ready.value = true
        storageError.value = ''
        conflict.value = false
        return null
      }
      const result = await $fetch<WorkspaceBootstrap>(`/api/workspaces/${workspaceId}/bootstrap`, { retry: 0, timeout: 30000 })
      bootstrap.value = result
      context.value = { id: result.id, slug: result.slug }
      data.value.revision = result.revision
      data.value.brandRevision = result.brand?.revision ?? data.value.brandRevision
      data.value.preferences = result.preferences
      data.value.onboarding = result.onboarding
      data.value.dismissed = result.dismissed
      data.value.notificationsRead = result.notificationsRead
      if (result.brand) applyCanonicalBrand(result.brand)
      else canonicalBrand.value = null
      ready.value = true
      storageError.value = ''
      conflict.value = false
      return result
    } catch (error) {
      resourceError(error)
      throw error
    }
  }
  const postsKey = (query: WorkspacePostListQuery) => JSON.stringify(query)
  const assetsKey = (query: WorkspaceAssetListQuery) => JSON.stringify(query)
  async function loadPosts(query: WorkspacePostListQuery = { page: 1, pageSize: 20 }) {
    if (!context.value) return null
    try {
      const result = await $fetch<PaginatedResponse<Post>>(`/api/workspaces/${context.value.id}/posts`, { query, retry: 0, timeout: 30000 })
      postsCache.value[postsKey(query)] = result
      data.value.posts = mergeById(data.value.posts, result.items)
      return result
    } catch (error) { resourceError(error); return null }
  }
  async function createPost(input: PostCreate) {
    if (!context.value) return null
    try {
      const result = await $fetch<{ post: Post; workspaceRevision: number }>(`/api/workspaces/${context.value.id}/posts`, { method: 'POST', body: input, retry: 0, timeout: 30000 })
      data.value.revision = result.workspaceRevision
      addPost(result.post)
      invalidatePosts()
      return result.post
    } catch (error) { resourceError(error); return false }
  }
  async function updatePost(id: string, input: PostUpdate) {
    if (!context.value) return null
    try {
      const result = await $fetch<{ post: Post; workspaceRevision: number }>(`/api/workspaces/${context.value.id}/posts/${id}`, { method: 'PUT', body: input, retry: 0, timeout: 30000 })
      applyPostResource(result.post, result.workspaceRevision)
      conflict.value = false
      return result.post
    } catch (error) { resourceError(error); return false }
  }
  async function loadAssets(query: WorkspaceAssetListQuery = { page: 1, pageSize: 20 }) {
    if (!context.value) return null
    try {
      const result = await $fetch<PaginatedResponse<Asset>>(`/api/workspaces/${context.value.id}/assets`, { query, retry: 0, timeout: 30000 })
      assetsCache.value[assetsKey(query)] = result
      data.value.assets = mergeById(data.value.assets, result.items)
      return result
    } catch (error) { resourceError(error); return false }
  }
  async function uploadAsset(file: File, metadata: Omit<AssetUploadMetadata, 'workspaceRevision'> & { workspaceRevision?: number }) {
    if (!context.value) return null
    const form = new FormData()
    form.append('file', file)
    form.append('workspaceRevision', String(metadata.workspaceRevision ?? data.value.revision))
    form.append('name', metadata.name)
    form.append('tags', JSON.stringify(metadata.tags))
    form.append('rights', String(metadata.rights))
    try {
      const result = await $fetch<{ asset: Asset; workspaceRevision: number }>(`/api/workspaces/${context.value.id}/assets`, { method: 'POST', body: form, retry: 0, timeout: 30000 })
      data.value.revision = result.workspaceRevision
      addAsset(result.asset)
      invalidateAssets()
      return result.asset
    } catch (error) { resourceError(error); return false }
  }
  async function updateAsset(id: string, metadata: AssetMetadataUpdate) {
    if (!context.value) return null
    try {
      const result = await $fetch<{ asset: Asset; workspaceRevision: number }>(`/api/workspaces/${context.value.id}/assets/${id}`, { method: 'PUT', body: metadata, retry: 0, timeout: 30000 })
      data.value.revision = result.workspaceRevision
      replaceAssetAt(id, result.asset)
      invalidateAssets()
      return result.asset
    } catch (error) { resourceError(error); return false }
  }
  async function deleteAsset(id: string) {
    if (!context.value) return null
    try {
      const result = await $fetch<{ deleted: boolean; assetId: string; workspaceRevision: number }>(`/api/workspaces/${context.value.id}/assets/${id}`, { method: 'DELETE', body: { workspaceRevision: data.value.revision }, retry: 0, timeout: 30000 })
      data.value.revision = result.workspaceRevision
      removeAsset(result.assetId)
      invalidateAssets()
      return result
    } catch (error) { resourceError(error); return false }
  }
  async function updatePreferences(input: Partial<Omit<PreferencesUpdate, 'workspaceRevision' | 'brandRevision'>> & Partial<Pick<PreferencesUpdate, 'workspaceRevision' | 'brandRevision'>>) {
    if (!context.value) return null
    const body = { ...input, workspaceRevision: input.workspaceRevision ?? data.value.revision, brandRevision: input.brandRevision ?? data.value.brandRevision }
    try {
      const result = await $fetch<WorkspacePreferencesResponse>(`/api/workspaces/${context.value.id}/preferences`, { method: 'PUT', body, retry: 0, timeout: 30000 })
      data.value.preferences = result.preferences
      data.value.revision = result.workspaceRevision
      data.value.brandRevision = result.brandRevision
      if (canonicalBrand.value) canonicalBrand.value = { ...canonicalBrand.value, revision: result.brandRevision }
      return result
    } catch (error) { resourceError(error); return false }
  }
  async function updateMetadata(input: Omit<WorkspaceMetadataUpdate, 'revision'>) {
    if (!context.value) return false
    try {
      const result = await $fetch<{ workspaceRevision: number; metadata: Partial<Workspace> }>(`/api/workspaces/${context.value.id}`, {
        method: 'PATCH',
        body: { ...input, revision: data.value.revision },
        retry: 0,
        timeout: 30000,
      })
      Object.assign(data.value, result.metadata)
      data.value.revision = result.workspaceRevision
      conflict.value = false
      storageError.value = ''
      return true
    } catch (error) { resourceError(error); return false }
  }
  async function commit(change: (draft: Workspace) => void) {
    if (syncing.value || conflict.value) return false
    const draft = structuredClone(toRaw(data.value))
    change(draft)
    draft.revision++
    const parsed = workspaceSchema.safeParse(draft)
    if (!parsed.success) {
      toast?.add({
        title: t('workspace.formInvalidTitle'),
        description: t('workspace.formInvalidDescription'),
        color: 'error',
      })
      return false
    }
    if (!context.value) return false
    syncing.value = true
    try {
      const result = await $fetch(`/api/workspaces/${context.value.id}`, {
        method: 'PUT',
        body: parsed.data,
        retry: 0,
        timeout: 30000,
      })
      applyBusiness(result)
      return true
    } catch (error) {
      const problem = error as { statusCode?: number; data?: { message?: string } }
      if (problem.statusCode === 409) conflict.value = true
      storageError.value =
        problem.statusCode === 401
          ? t('workspace.sessionExpired')
          : problem.data?.message || t('workspace.saveFailed')
      return false
    } finally {
      syncing.value = false
    }
  }
  async function saveBrand(nextBrand: Workspace['brand']) {
    if (syncing.value || conflict.value || !context.value || !canonicalBrand.value) return false
    const parsed = workspaceSchema.shape.brand.safeParse(nextBrand)
    if (!parsed.success) {
      toast?.add({
        title: t('workspace.formInvalidTitle'),
        description: t('workspace.formInvalidDescription'),
        color: 'error',
      })
      return false
    }
    const { name, status, ...profile } = parsed.data
    syncing.value = true
    try {
      const brand = await $fetch<Brand>(
        `/api/organizations/${context.value.id}/brands/${canonicalBrand.value.id}`,
        {
          method: 'PUT',
          body: {
            revision: canonicalBrand.value.revision,
            name,
            category: profile.industry.trim() || 'general',
            status,
            profile,
          },
          retry: 0,
          timeout: 30000,
        },
      )
      applyCanonicalBrand(brand)
      storageError.value = ''
      return true
    } catch (error) {
      const problem = error as { statusCode?: number; data?: { message?: string } }
      if (problem.statusCode === 409) conflict.value = true
      storageError.value =
        problem.statusCode === 401
          ? t('workspace.sessionExpired')
          : problem.data?.message || t('workspace.saveFailed')
      return false
    } finally {
      syncing.value = false
    }
  }
  async function saveOnboarding(input: Omit<WorkspaceOnboardingUpdate, 'workspaceRevision' | 'brandRevision'> & Partial<Pick<WorkspaceOnboardingUpdate, 'workspaceRevision' | 'brandRevision'>>) {
    if (syncing.value || conflict.value || !context.value || !canonicalBrand.value) return false
    const body: WorkspaceOnboardingUpdate = {
      ...input,
      workspaceRevision: input.workspaceRevision ?? data.value.revision,
      brandRevision: input.brandRevision ?? data.value.brandRevision,
    }
    syncing.value = true
    try {
      const result = await $fetch<{
        brand: Brand
        preferences: Workspace['preferences']
        metadata: Partial<Workspace>
        workspaceRevision: number
        brandRevision: number
      }>(`/api/workspaces/${context.value.id}/onboarding`, {
        method: 'PUT',
        body,
        retry: 0,
        timeout: 30000,
      })
      applyCanonicalBrand(result.brand)
      data.value.preferences = result.preferences
      Object.assign(data.value, result.metadata)
      data.value.revision = result.workspaceRevision
      data.value.brandRevision = result.brandRevision
      conflict.value = false
      storageError.value = ''
      return true
    } catch (error) {
      resourceError(error)
      return false
    } finally {
      syncing.value = false
    }
  }
  function reload() {
    try {
      const prefix = `rrit:draft:${base.value}:`
      const keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i))
      for (const key of keys) if (key?.startsWith(prefix)) sessionStorage.removeItem(key)
    } catch {
      /* Committed data still reloads. */
    }
    window.location.reload()
  }
  async function transition(
    id: string,
    status: Post['status'],
    scheduledAt?: string,
    publicationMode: 'manual' | 'automatic' = 'manual',
  ) {
    const post = data.value.posts.find((p) => p.id === id)
    if (!post) return false
    const error = validateTransition(post, status)
    if (error) {
      toast?.add({
        title: t('workspace.reviewRequired'),
        description: error.startsWith('transition.') ? t(error) : error,
        color: 'error',
      })
      return false
    }
    if (status === 'scheduled' && (!scheduledAt || Date.parse(scheduledAt) <= Date.now())) {
      toast?.add({ title: t('workspace.futureScheduleRequired'), color: 'error' })
      return false
    }
    return !!(await updatePost(id, {
      status: status as 'draft' | 'review' | 'approved' | 'scheduled',
      scheduledAt: status === 'scheduled' ? scheduledAt! : null,
      publicationMode: status === 'scheduled' ? publicationMode : 'manual',
      workspaceRevision: data.value.revision,
      postVersion: post.version,
    }))
  }
  function notify(title?: string) {
    toast?.add({
      title: title || 'Ndryshimet u ruajtën',
      icon: 'i-lucide-circle-check',
      color: 'success',
    })
  }
  function unavailable() {
    toast?.add({
      title: t('workspace.serviceInactive'),
      description: t('workspace.serviceInactiveDescription'),
      color: 'warning',
    })
  }
  async function exportData() {
    const drafts: Record<string, unknown> = {}
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i)!
        if (key.startsWith(`rrit:draft:${base.value}:`))
          drafts[key] = JSON.parse(sessionStorage.getItem(key)!)
      }
    } catch {
      /* Committed data remains exportable. */
    }
    let workspace = data.value
    if (context.value) {
      const posts: Post[] = []
      const assets: Asset[] = []
      for (let page = 1, hasNext = true; hasNext; page++) {
        const result = await $fetch<PaginatedResponse<Post>>(`/api/workspaces/${context.value.id}/posts`, {
          query: { page, pageSize: 50 }, retry: 0, timeout: 30000,
        })
        posts.push(...result.items)
        hasNext = result.hasNext
      }
      for (let page = 1, hasNext = true; hasNext; page++) {
        const result = await $fetch<PaginatedResponse<Asset>>(`/api/workspaces/${context.value.id}/assets`, {
          query: { page, pageSize: 50 }, retry: 0, timeout: 30000,
        })
        assets.push(...result.items)
        hasNext = result.hasNext
      }
      workspace = { ...data.value, posts, assets }
    }
    const blob = new Blob(
      [JSON.stringify({ workspace, unsentDrafts: drafts }, null, 2)],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'rrit-biznesi.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  return {
    data,
    ready,
    context,
    canonicalBrand,
    syncing,
    storageError,
    conflict,
    base,
    applyBusiness,
    commit,
    saveBrand,
    saveOnboarding,
    reload,
    transition,
    notify,
    unavailable,
    exportData,
    bootstrap,
    brandState,
    preferencesState,
    postsCache,
    assetsCache,
    initBootstrap,
    loadPosts,
    createPost,
    updatePost,
    applyPostResource,
    loadAssets,
    uploadAsset,
    updateAsset,
    deleteAsset,
    updatePreferences,
    updateMetadata,
  }
}
