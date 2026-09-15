import {
  workspaceSchema,
  validateTransition,
  type Workspace,
  type Post,
} from '~~/shared/schemas/workspace'
import { emptyWorkspace } from '~~/shared/utils/empty-workspace'
import type { Brand } from '~~/shared/schemas/brand'

export function useWorkspace() {
  const { t } = useI18n()
  const data = useState<Workspace>('workspace', () => emptyWorkspace())
  const ready = useState('workspace-ready', () => false)
  const context = useState<{ id: string; slug: string } | null>('workspace-context', () => null)
  const canonicalBrand = useState<Brand | null>('canonical-brand', () => null)
  const storageError = useState('storage-error', () => '')
  const conflict = useState('workspace-conflict', () => false)
  const syncing = useState('workspace-syncing', () => false)
  const toast = getCurrentInstance() ? useToast() : null
  const base = computed(() =>
    context.value ? `/app/${context.value.id}/${context.value.slug}` : '/app',
  )
  function applyBusiness(business: { id: string; slug: string; workspace: Workspace; brand?: Brand | null }) {
    data.value = workspaceSchema.parse(business.workspace)
    context.value = { id: business.id, slug: business.slug }
    canonicalBrand.value = business.brand || null
    ready.value = true
    storageError.value = ''
    conflict.value = false
  }
  async function initLive() {
    const result = await $fetch<{
      user: { name: string; email: string }
      business: { id: string; slug: string; workspace: Workspace; brand?: Brand | null } | null
    }>('/api/business')
    if (result.business) applyBusiness(result.business)
    else {
      data.value = emptyWorkspace(result.user.name, result.user.email)
      context.value = null
      canonicalBrand.value = null
      ready.value = true
    }
    return result.business
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
    return commit((d) => {
      const p = d.posts.find((p) => p.id === id)!
      p.status = status
      p.scheduledAt = status === 'scheduled' ? scheduledAt! : null
      p.publicationMode = status === 'scheduled' ? publicationMode : 'manual'
      p.version++
    })
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
  function exportData() {
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
    const blob = new Blob(
      [JSON.stringify({ workspace: data.value, unsentDrafts: drafts }, null, 2)],
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
    initLive,
    applyBusiness,
    commit,
    reload,
    transition,
    notify,
    unavailable,
    exportData,
  }
}
