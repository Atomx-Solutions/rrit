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
    phone: '044111222',
    businessName: 'Lumma Café',
    industry: 'Kafene dhe ëmbëltore',
    platform: 'both',
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

  it('accepts videos without posts', () => {
    expect(
      packageRequestSchema.parse(request({ postsRequested: 0, videosRequested: 3 })),
    ).toMatchObject({ postsRequested: 0, videosRequested: 3 })
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
    expect(packageRequestStatusSchema.parse('proposal_sent')).toBe('proposal_sent')
    expect(packageRequestStatusSchema.parse('won')).toBe('won')
    expect(packageRequestStatusSchema.parse('lost')).toBe('lost')
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
    expect(packageRequestChangeSchema.parse({
      status: 'proposal_sent',
      organizationId: '00000000-0000-4000-8000-000000000001',
    }).organizationId).toBe('00000000-0000-4000-8000-000000000001')
    expect(() => packageRequestChangeSchema.parse({ status: 'won', organizationId: 'not-an-id' })).toThrow()
  })
})

describe('lead fields', () => {
  it('keeps what the team needs before it can answer with an offer', () => {
    const parsed = packageRequestSchema.parse(request({ message: 'Tre postime në javë' }))

    expect(parsed).toMatchObject({
      businessName: 'Lumma Café',
      industry: 'Kafene dhe ëmbëltore',
      platform: 'both',
      postsRequested: 20,
    })
  })

  it('requires the business, a reachable number and where it publishes', () => {
    // The team answers by calling, so the number is part of the request.
    expect(() => packageRequestSchema.parse(request({ phone: undefined }))).toThrow()
    expect(() => packageRequestSchema.parse(request({ phone: '12' }))).toThrow()
    expect(() => packageRequestSchema.parse(request({ businessName: '' }))).toThrow()
    expect(() => packageRequestSchema.parse(request({ industry: '' }))).toThrow()
    expect(() => packageRequestSchema.parse(request({ platform: 'tiktok' }))).toThrow()
  })

  it('accepts a typed amount as readily as a suggested one', () => {
    // A predefined choice and a custom number are the same answer here.
    expect(packageRequestSchema.parse(request({ postsRequested: 137 })).postsRequested).toBe(137)
    expect(packageRequestSchema.parse(request({ postsRequested: 10 })).postsRequested).toBe(10)
  })

  it('asks for none of it inside the app, where the organization is known', () => {
    const parsed = appPackageRequestSchema.parse(request())

    expect(parsed).not.toHaveProperty('businessName')
    expect(parsed).not.toHaveProperty('industry')
    expect(parsed).not.toHaveProperty('platform')
  })
})
