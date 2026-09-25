import { describe, expect, it } from 'vitest'
import { authScopeForPath } from '../../shared/utils/auth-scope'

describe('auth scope', () => {
  it.each(['/admin', '/admin/', '/admin/organizations', '/api/admin', '/api/admin/me'])(
    'puts %s in the admin session',
    (path) => {
      expect(authScopeForPath(path)).toBe('admin')
    },
  )

  it.each([
    '/',
    '/login',
    '/api/business',
    '/administer',
    '/api/administer',
    '/app/acme/brand/content',
  ])('puts %s in the customer session', (path) => {
    expect(authScopeForPath(path)).toBe('customer')
  })
})
