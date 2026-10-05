import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import {
  businessSlugFromName,
  createInvitationToken,
  invitationCreateSchema,
  invitationFailure,
  invitationResendSchema,
  invitationTokenBodySchema,
  invitationTokenHash,
  invitationUrl,
} from '../../server/utils/organization-invitations'

beforeEach(() => {
  vi.stubGlobal('createError', createError)
  vi.stubEnv('APP_URL', 'https://app.example.com')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('invitation tokens', () => {
  it('issues a url-safe token of the documented length', () => {
    const token = createInvitationToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(invitationTokenBodySchema.safeParse({ token }).success).toBe(true)
  })

  it('never repeats a token', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createInvitationToken()))
    expect(tokens.size).toBe(50)
  })

  it('stores only the hash of the token', () => {
    const token = createInvitationToken()
    const hash = invitationTokenHash(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(hash).not.toContain(token)
  })

  it('builds the join link on the configured public origin', () => {
    const token = createInvitationToken()
    expect(invitationUrl(token)).toBe(`https://app.example.com/join?token=${token}`)
  })

  it('refuses to build a link when the public origin is unknown', () => {
    vi.stubEnv('APP_URL', '')
    expect(() => invitationUrl(createInvitationToken())).toThrowError()
  })

  it('rejects a token that is not the shape the issuer produces', () => {
    for (const token of ['', 'short', `${'a'.repeat(42)}+`, 'a'.repeat(44)])
      expect(invitationTokenBodySchema.safeParse({ token }).success).toBe(false)
  })
})

describe('invitation input', () => {
  const valid = {
    name: 'Lumma Café',
    slug: 'lumma-cafe',
    email: 'owner@example.com',
  }

  it('accepts the fields the superadmin fills and defaults the rest', () => {
    const parsed = invitationCreateSchema.safeParse(valid)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.role).toBe('owner')
    expect(parsed.success && parsed.data.expires_days).toBe(7)
    expect(parsed.success && parsed.data.profile).toEqual({})
  })

  it.each([
    [{ ...valid, email: 'not-an-email' }],
    [{ ...valid, slug: 'Not A Slug' }],
    [{ ...valid, name: 'x' }],
    [{ ...valid, expires_days: 0 }],
    [{ ...valid, expires_days: 31 }],
    [{ ...valid, role: 'superadmin' }],
    [{ ...valid, package_request_id: 'not-a-uuid' }],
    // A token hash supplied by the caller would let a client choose its own link.
    [{ ...valid, token_hash: 'a'.repeat(64) }],
  ])('rejects %o', (body) => {
    expect(invitationCreateSchema.safeParse(body).success).toBe(false)
  })

  it('keeps the resend window inside the same bounds', () => {
    expect(invitationResendSchema.safeParse({}).success).toBe(true)
    expect(invitationResendSchema.safeParse({ expires_days: 30 }).success).toBe(true)
    expect(invitationResendSchema.safeParse({ expires_days: 31 }).success).toBe(false)
  })
})

describe('invitation failures', () => {
  it.each([
    ['INVITATION_NOT_FOUND', 404],
    ['INVITATION_CLOSED', 409],
    ['INVITATION_EXPIRED', 410],
    ['INVITATION_EMAIL_MISMATCH', 403],
    ['BUSINESS_EXISTS', 409],
    ['ORGANIZATION_SLUG_TAKEN', 409],
  ])('maps %s to %i', (code, statusCode) => {
    expect(invitationFailure(code)).toMatchObject({ statusCode, code })
  })

  it('leaves an unknown database error to the generic failure', () => {
    expect(invitationFailure('connection reset')).toBeNull()
    expect(invitationFailure(undefined)).toBeNull()
  })
})

describe('business slug', () => {
  it('strips diacritics and punctuation the way onboarding does', () => {
    expect(businessSlugFromName('Lumma Café')).toBe('lumma-cafe')
    expect(businessSlugFromName('Çelësi & Co.')).toBe('celesi-co')
  })

  it('always satisfies the database slug constraint', () => {
    for (const name of ['A', '???', 'a'.repeat(200), 'Ë'])
      expect(businessSlugFromName(name)).toMatch(/^[a-z0-9][a-z0-9-]{1,79}$/)
  })
})
