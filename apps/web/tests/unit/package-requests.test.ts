import { describe, expect, it } from 'vitest'
import {
  appPackageRequestSchema,
  packageRequestFailure,
  packageRequestSchema,
} from '../../server/utils/package-requests'
import {
  packageRequestChangeSchema,
  packageRequestStatusSchema,
} from '../../server/utils/admin-package-requests'

function request(overrides: Record<string, unknown> = {}) {
  return {
    contactName: 'Altin Hamza',
    contactEmail: 'altin@example.test',
    postsRequested: 20,
    ...overrides,
  }
}

describe('package request input', () => {
  it('accepts a request with only the volume and a contact', () => {
    expect(packageRequestSchema.parse(request())).toMatchObject({
      contactName: 'Altin Hamza',
      postsRequested: 20,
    })
  })

  it('carries no price, because the team answers with the offer', () => {
    const parsed = packageRequestSchema.parse(request({ priceCents: 3000 }))

    expect(parsed).not.toHaveProperty('priceCents')
  })

  it('refuses an unusable contact or volume', () => {
    expect(() => packageRequestSchema.parse(request({ contactEmail: 'not-an-email' }))).toThrow()
    expect(() => packageRequestSchema.parse(request({ contactName: 'A' }))).toThrow()
    expect(() => packageRequestSchema.parse(request({ postsRequested: 0 }))).toThrow()
    expect(() => packageRequestSchema.parse(request({ postsRequested: 1001 }))).toThrow()
  })

  it('never takes identity from the body inside the app', () => {
    const parsed = appPackageRequestSchema.parse(request())

    // The signed-in session supplies the contact, so a body claiming one is
    // simply ignored rather than trusted.
    expect(parsed).not.toHaveProperty('contactName')
    expect(parsed).not.toHaveProperty('contactEmail')
    expect(parsed.postsRequested).toBe(20)
  })
})

describe('package request failures', () => {
  it('reports a rate limited submitter as too many requests', () => {
    // The database raises the code inside a longer postgres message.
    expect(packageRequestFailure('error: REQUEST_RATE_LIMITED')).toMatchObject({
      statusCode: 429,
      code: 'REQUEST_RATE_LIMITED',
    })
    expect(packageRequestFailure('REQUEST_INVALID')?.statusCode).toBe(400)
  })

  it('lets an unexpected database error stay a server error', () => {
    expect(packageRequestFailure('connection terminated')).toBeNull()
  })
})

describe('admin package request changes', () => {
  it('accepts only the known statuses', () => {
    expect(packageRequestStatusSchema.parse('converted')).toBe('converted')
    expect(() => packageRequestChangeSchema.parse({ status: 'archived' })).toThrow()
    expect(() => packageRequestChangeSchema.parse({})).toThrow()
  })

  it('rejects fields the superadmin is not allowed to rewrite', () => {
    expect(() =>
      packageRequestChangeSchema.parse({ status: 'contacted', contactEmail: 'other@example.test' }),
    ).toThrow()
    expect(packageRequestChangeSchema.parse({ status: 'contacted', note: 'U kontaktua' })).toEqual({
      status: 'contacted',
      note: 'U kontaktua',
    })
  })
})
