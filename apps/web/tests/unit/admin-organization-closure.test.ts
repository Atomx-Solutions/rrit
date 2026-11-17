import { describe, expect, it } from 'vitest'
import {
  adminCloseOrganizationSchema,
  organizationClosureFailure,
  organizationClosureGraceDays,
} from '../../server/utils/admin-organization-closure'

describe('closing an organization', () => {
  it('keeps the 30-day policy unless the environment sets a valid other one', () => {
    expect(organizationClosureGraceDays({})).toBe(30)
    expect(organizationClosureGraceDays({ ORGANIZATION_CLOSURE_GRACE_DAYS: '14' })).toBe(14)
    expect(organizationClosureGraceDays({ ORGANIZATION_CLOSURE_GRACE_DAYS: '0' })).toBe(30)
    expect(organizationClosureGraceDays({ ORGANIZATION_CLOSURE_GRACE_DAYS: 'soon' })).toBe(30)
  })

  it('requires a reason', () => {
    expect(adminCloseOrganizationSchema.safeParse({ reason: '  ' }).success).toBe(false)
    expect(adminCloseOrganizationSchema.safeParse({ reason: 'Client asked to leave' }).success).toBe(true)
  })

  it('turns database refusals into clear answers', () => {
    expect(organizationClosureFailure('ORGANIZATION_WORK_IN_FLIGHT')).toMatchObject({ statusCode: 409, message: 'server.ORGANIZATION_WORK_IN_FLIGHT' })
    expect(organizationClosureFailure('ORGANIZATION_REOPEN_EXPIRED')).toMatchObject({ statusCode: 409 })
    expect(organizationClosureFailure('something else')).toBeNull()
  })
})
