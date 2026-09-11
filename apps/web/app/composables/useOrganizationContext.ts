import {
  organizationCreateSchema,
  organizationViewSchema,
  type OrganizationCreateInput,
  type OrganizationView,
} from '../../shared/schemas/organization'
import { isAllowedOrganizationId, selectValidOrganization } from '../utils/organization-selection'

type OrganizationApi<T extends { id: string }> = {
  list: () => Promise<readonly T[]>
  create: (input: OrganizationCreateInput) => Promise<T>
}

type Preference = {
  get: () => string | null
  set: (value: string) => void
  clear: () => void
}

export function createOrganizationContext<T extends { id: string }>(
  api: OrganizationApi<T>,
  preference: Preference,
) {
  let organizations: T[] = []
  let activeOrganizationId: string | null = null

  return {
    get organizations() {
      return organizations
    },
    get activeOrganizationId() {
      return activeOrganizationId
    },
    get activeOrganization() {
      return organizations.find((organization) => organization.id === activeOrganizationId) ?? null
    },
    async loadOrganizations() {
      const visible = [...(await api.list())]
      const preferred = preference.get()
      const selected = selectValidOrganization(visible, preferred)
      if (preferred && selected?.id !== preferred) preference.clear()
      organizations = visible
      activeOrganizationId = selected?.id ?? null
      return organizations
    },
    async selectOrganization(id: string) {
      if (!isAllowedOrganizationId(organizations, id)) return false
      activeOrganizationId = id
      preference.set(id)
      return true
    },
    clearActiveOrganization() {
      activeOrganizationId = null
      preference.clear()
    },
    async createOrganization(input: OrganizationCreateInput) {
      const created = await api.create(input)
      await this.loadOrganizations()
      await this.selectOrganization(created.id)
      return created
    },
  }
}

export function useOrganizationContext() {
  const organizations = useState<OrganizationView[]>('organizations', () => [])
  const activeOrganizationId = useState<string | null>('active-organization-id', () => null)
  const ready = useState('organizations-ready', () => false)
  const loading = useState('organizations-loading', () => false)
  const error = useState<string | null>('organizations-error', () => null)
  const preference = useCookie<string | null>('rrit-active-organization', { default: () => null })
  const activeOrganization = computed(
    () => organizations.value.find((organization) => organization.id === activeOrganizationId.value) ?? null,
  )

  async function loadOrganizations() {
    loading.value = true
    error.value = null
    try {
      const visible = organizationViewSchema.array().parse(await $fetch('/api/v1/organizations'))
      const selected = selectValidOrganization(visible, preference.value)
      if (preference.value && selected?.id !== preference.value) preference.value = null
      organizations.value = visible
      activeOrganizationId.value = selected?.id ?? null
      ready.value = true
      return visible
    } catch (problem) {
      error.value = problem instanceof Error ? problem.message : 'Organizatat nuk u ngarkuan.'
      throw problem
    } finally {
      loading.value = false
    }
  }

  async function selectOrganization(id: string) {
    if (!isAllowedOrganizationId(organizations.value, id)) return false
    activeOrganizationId.value = id
    preference.value = id
    return true
  }

  function clearActiveOrganization() {
    activeOrganizationId.value = null
    preference.value = null
  }

  async function createOrganization(input: OrganizationCreateInput) {
    const parsed = organizationCreateSchema.parse(input)
    const created = organizationViewSchema.parse(
      await $fetch('/api/v1/organizations', { method: 'POST', body: parsed }),
    )
    await loadOrganizations()
    await selectOrganization(created.id)
    return created
  }

  return {
    organizations,
    activeOrganizationId,
    activeOrganization,
    ready,
    loading,
    error,
    loadOrganizations,
    selectOrganization,
    clearActiveOrganization,
    createOrganization,
  }
}
