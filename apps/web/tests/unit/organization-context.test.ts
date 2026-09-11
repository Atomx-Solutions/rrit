import { describe, expect, it } from 'vitest'
import { createOrganizationContext } from '../../app/composables/useOrganizationContext'

const orgA = { id: 'org-a', name: 'Organization A', slug: 'organization-a', revision: 0, role: 'owner' as const }
const orgB = { id: 'org-b', name: 'Organization B', slug: 'organization-b', revision: 0, role: 'owner' as const }

function setup(initialPreference: string | null, initialOrganizations = [orgA, orgB]) {
  let preference = initialPreference
  let organizations = initialOrganizations
  const calls: string[] = []
  const context = createOrganizationContext(
    {
      list: async () => {
        calls.push('list')
        return organizations
      },
      create: async () => {
        calls.push('create')
        organizations = [...organizations, { ...orgB, id: 'org-c', name: 'Organization C', slug: 'organization-c' }]
        return organizations.at(-1)!
      },
    },
    {
      get: () => preference,
      set: (value) => {
        calls.push(`set:${value}`)
        preference = value
      },
      clear: () => {
        calls.push('clear')
        preference = null
      },
    },
  )
  return { context, calls, getPreference: () => preference }
}

describe('organization context', () => {
  it('restores a valid preference from the API-visible list', async () => {
    const { context } = setup('org-b')
    await context.loadOrganizations()
    expect(context.activeOrganizationId).toBe('org-b')
  })

  it('clears an invalid preference before selecting a safe API-visible fallback', async () => {
    const { context, calls, getPreference } = setup('org-forged')
    await context.loadOrganizations()
    expect(calls).toEqual(['list', 'clear'])
    expect(getPreference()).toBeNull()
    expect(context.activeOrganizationId).toBe('org-a')
  })

  it('does not activate an organization that the API did not return', async () => {
    const { context, calls } = setup(null, [orgA])
    await context.loadOrganizations()
    expect(await context.selectOrganization('org-forged')).toBe(false)
    expect(calls).toEqual(['list'])
    expect(context.activeOrganizationId).toBe('org-a')
  })

  it('creates and activates an organization without creating a business', async () => {
    const { context, calls } = setup(null, [orgA])
    await context.loadOrganizations()
    const created = await context.createOrganization({ name: 'Organization C', slug: 'organization-c' })
    expect(created.id).toBe('org-c')
    expect(context.activeOrganizationId).toBe('org-c')
    expect(calls).toEqual(['list', 'create', 'list', 'set:org-c'])
  })
})
