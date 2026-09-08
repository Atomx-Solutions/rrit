import { afterEach, describe, expect, it, vi } from 'vitest'
import { authCapabilities, authConfiguration } from '../../server/utils/auth-configuration'
afterEach(() => vi.unstubAllEnvs())
describe('local registration configuration', () => {
  it('accepts exact loopback aliases on the configured port', () => {
    vi.stubEnv('BETTER_AUTH_URL', 'http://127.0.0.1:3000')
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
    vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
    vi.stubEnv('AUTH_REQUIRE_EMAIL_VERIFICATION', 'true')
    expect(authConfiguration().requireEmailVerification).toBe(true)
  })
  it('keeps email verification and exact origin checks on a public deployment', () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://business.example.test')
    vi.stubEnv('AUTH_REQUIRE_EMAIL_VERIFICATION', 'false')
    expect(authConfiguration()).toMatchObject({
      trustedOrigins: ['https://business.example.test'],
      requireEmailVerification: true,
    })
  })
  it('keeps existing-account login available when public email delivery is unavailable', () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://business.example.test')
    vi.stubEnv('DATABASE_URL', 'postgresql://example.test/rrit')
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-at-least-thirty-two-characters')
    expect(authCapabilities(true, true)).toEqual({
      authentication: true,
      registration: false,
      passwordRecovery: false,
      emailDelivery: false,
      emailVerificationRequired: true,
    })
  })
  it('separates local signup from password recovery readiness', () => {
    vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
    vi.stubEnv('AUTH_REQUIRE_EMAIL_VERIFICATION', 'false')
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost/rrit')
    vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-at-least-thirty-two-characters')
    expect(authCapabilities(true, true)).toMatchObject({
      authentication: true,
      registration: true,
      passwordRecovery: false,
    })
    vi.stubEnv('SMTP_HOST', 'smtp.example.test')
    vi.stubEnv('SMTP_FROM', 'Rrit <no-reply@example.test>')
    expect(authCapabilities(true, true).passwordRecovery).toBe(true)
  })
})
