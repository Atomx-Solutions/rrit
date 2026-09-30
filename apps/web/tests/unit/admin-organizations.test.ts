import { describe, expect, it } from 'vitest'
import { adminOrganizationsQuerySchema, normalizeAdminOrganizations } from '../../server/utils/admin-organizations'

describe('admin organization list query', () => {
  it('defaults to the first page of 25', () => {
    expect(adminOrganizationsQuerySchema.parse({})).toEqual({ page: 1, per_page: 25 })
  })

  it('accepts combined filters from the query string', () => {
    expect(adminOrganizationsQuerySchema.parse({ page: '2', per_page: '50', status: 'none', q: ' Hamza ' }))
      .toEqual({ page: 2, per_page: 50, status: 'none', q: 'Hamza' })
  })

  it.each([{ per_page: '101' }, { page: '0' }, { status: 'deleted' }, { status: 'pako-1' }])('rejects %o', (query) => {
    expect(adminOrganizationsQuerySchema.safeParse(query).success).toBe(false)
  })
})

describe('admin organization list response', () => {
  it('returns an empty array, not an error, when there are no organizations', () => {
    expect(normalizeAdminOrganizations({ page: 1, per_page: 25, total: 0, items: [] }, { page: 1, per_page: 25 }))
      .toEqual({ items: [], page: 1, per_page: 25, total: 0, total_pages: 0 })
    expect(normalizeAdminOrganizations(null, { page: 1, per_page: 25 }).items).toEqual([])
  })

  it('counts pages and keeps missing relations null', () => {
    const result = normalizeAdminOrganizations(
      { page: 2, per_page: 25, total: 51, items: [{ id: 'o', slug: 'o', name: 'O', status: 'active', created_at: '2026-09-21', brand_count: '1', member_count: 2 }] },
      { page: 2, per_page: 25 },
    )
    expect(result.total_pages).toBe(3)
    expect(result.items[0]).toMatchObject({ subscription: null, credit_balance: null, brand_count: 1, member_count: 2 })
  })
})
