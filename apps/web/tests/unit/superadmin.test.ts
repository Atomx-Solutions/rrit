import { describe, expect, it, vi } from 'vitest'
import { hasSuperadminRole, isAdminApiPath } from '../../server/utils/superadmin'

describe('superadmin API guard', () => {
  it.each(['/api/admin', '/api/admin/organizations', '/api/admin/organizations/123'])(
    'recognizes admin API path %s',
    (path) => {
      expect(isAdminApiPath(path)).toBe(true)
    },
  )

  it.each(['/api/administer', '/api/billing', '/admin/organizations'])(
    'does not affect non-admin API path %s',
    (path) => {
      expect(isAdminApiPath(path)).toBe(false)
    },
  )

  it('accepts a user with a superadmin role', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] })
    await expect(hasSuperadminRole({ query } as never, 'user-id')).resolves.toBe(true)
    expect(query).toHaveBeenCalledWith(expect.stringContaining("role='superadmin'"), ['user-id'])
  })

  it('rejects a user without a superadmin role', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    await expect(hasSuperadminRole({ query } as never, 'user-id')).resolves.toBe(false)
  })
})
