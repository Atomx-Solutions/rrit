import { afterEach, describe, expect, it, vi } from 'vitest'
import { authCapabilities, authConfiguration } from '../../server/utils/auth-configuration'

afterEach(() => vi.unstubAllEnvs())

function stubSupabase() {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_KEY', 'sb_publishable_test-key')
  vi.stubEnv('DATABASE_URL', 'postgresql://example.test/rrit')
}

describe('Supabase authentication configuration', () => {
  it('accepts exact loopback aliases on the configured port', () => {
    vi.stubEnv('APP_URL', 'http://127.0.0.1:3000')
    vi.stubEnv('AUTH_REQUIRE_EMAIL_VERIFICATION', 'false')
    const config = authConfiguration()
    expect(config.trustedOrigins).toEqual(
      expect.arrayContaining(['http://localhost:3000', 'http://127.0.0.1:3000']),
    )
    expect(config.trustedOrigins).not.toContain('http://localhost:3001')
    expect(config.trustedOrigins).not.toContain('https://localhost.attacker.test:3000')
    expect(config.requireEmailVerification).toBe(false)
  })

  it('supports opting back in to local verification', () => {
    vi.stubEnv('APP_URL', 'http://localhost:3000')
    vi.stubEnv('AUTH_REQUIRE_EMAIL_VERIFICATION', 'true')
    expect(authConfiguration().requireEmailVerification).toBe(true)
  })

  it('keeps email verification and exact origin checks on a public deployment', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('APP_URL', 'https://business.example.test')
    vi.stubEnv('AUTH_REQUIRE_EMAIL_VERIFICATION', 'false')
    expect(authConfiguration()).toMatchObject({
      trustedOrigins: ['https://business.example.test'],
      requireEmailVerification: true,
    })
  })

  it('requires Supabase and database configuration for authentication', () => {
    vi.stubEnv('APP_URL', 'https://business.example.test')
    expect(authCapabilities(true, true).authentication).toBe(false)
    stubSupabase()
    expect(authCapabilities(true, true)).toMatchObject({
      authentication: true,
      registration: true,
      passwordRecovery: true,
      emailDelivery: true,
    })
  })

  it('separates local signup readiness from the email verification policy', () => {
    vi.stubEnv('APP_URL', 'http://localhost:3000')
    vi.stubEnv('AUTH_REQUIRE_EMAIL_VERIFICATION', 'false')
    stubSupabase()
    expect(authCapabilities(true, true)).toMatchObject({
      authentication: true,
      registration: true,
      passwordRecovery: true,
      emailVerificationRequired: false,
    })
  })
})
