import { describe, expect, it } from 'vitest'
import { adminUsersQuerySchema, normalizeAdminUsers } from '../../server/utils/admin-users'

describe('admin user list query', () => {
  it('defaults to the first page of 25', () => {
    expect(adminUsersQuerySchema.parse({})).toEqual({ page: 1, per_page: 25 })
  })

  it('accepts an email search from the query string', () => {
    expect(adminUsersQuerySchema.parse({ page: '3', per_page: '10', q: ' Altin@ ' })).toEqual({ page: 3, per_page: 10, q: 'Altin@' })
  })

  it.each([{ per_page: '101' }, { page: '0' }])('rejects %o', (query) => {
    expect(adminUsersQuerySchema.safeParse(query).success).toBe(false)
  })
})

describe('admin user list response', () => {
  it('gives a user without an organization an empty list', () => {
    const result = normalizeAdminUsers(
      { page: 1, per_page: 25, total: 1, items: [{ id: 'u', email: 'a@b.c', created_at: '2026-09-21', last_sign_in_at: null }] },
      { page: 1, per_page: 25 },
    )
    expect(result.items[0]).toMatchObject({ organizations: [], last_sign_in_at: null })
  })

  it('counts pages and returns an empty array when nothing matches', () => {
    expect(normalizeAdminUsers({ page: 1, per_page: 25, total: 0, items: [] }, { page: 1, per_page: 25 }))
      .toEqual({ items: [], page: 1, per_page: 25, total: 0, total_pages: 0 })
    expect(normalizeAdminUsers({ page: 2, per_page: 25, total: 51, items: [] }, { page: 2, per_page: 25 }).total_pages).toBe(3)
  })
})
