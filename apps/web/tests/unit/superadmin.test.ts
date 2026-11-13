import { describe, expect, it, vi } from 'vitest'
import {
  accessTokenMethods,
  hasSuperadminRole,
  isAdminApiPath,
  signedInWithMicrosoft,
} from '../../server/utils/superadmin'

function token(claims: Record<string, unknown>) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'ES256' })}.${part(claims)}.signature`
}

describe('admin sign-in through the company Microsoft account', () => {
  it('accepts a Microsoft session on an account with a password and Microsoft', () => {
    expect(signedInWithMicrosoft({ methods: ['oauth'], providers: ['email', 'azure'] })).toBe(true)
  })

  it.each([
    ['a password session', ['password'], ['email', 'azure']],
    ['a magic link session', ['otp'], ['email', 'azure']],
    ['a recovery session', ['recovery'], ['email', 'azure']],
    ['an account without the Microsoft identity', ['oauth'], ['email']],
    ['an account that also signs in with Google', ['oauth'], ['email', 'azure', 'google']],
    ['a Google-only account', ['oauth'], ['google']],
    ['a session without any recorded method', [], ['azure']],
  ])('refuses %s', (_case, methods, providers) => {
    expect(signedInWithMicrosoft({ methods, providers })).toBe(false)
  })

  it('reads the methods from Supabase access token entries', () => {
    expect(accessTokenMethods(token({ amr: [{ method: 'oauth', timestamp: 1 }] }))).toEqual(['oauth'])
    expect(accessTokenMethods(token({ amr: ['password'] }))).toEqual(['password'])
  })

  it.each([undefined, '', 'not-a-token', 'a.!!!.c', token({}), token({ amr: 'oauth' })])(
    'finds no method in %s',
    (value) => {
      expect(accessTokenMethods(value)).toEqual([])
    },
  )
})

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
