import { describe, expect, it } from 'vitest'
import { adminSubscriptionActionSchema, adminSubscriptionFailure } from '../../server/utils/admin-subscriptions'

describe('admin subscription actions', () => {
  it.each([
    [{ action: 'pause', reason: 'Pagesa e vonuar' }],
    [{ action: 'pause' }],
    [{ action: 'resume' }],
    [{ action: 'change_plan', plan_code: 'pako-2', billing_interval: 'annual' }],
    [{ action: 'extend', days: 30 }],
    [{ action: 'cancel' }],
  ])('accepts %o', (body) => {
    expect(adminSubscriptionActionSchema.safeParse(body).success).toBe(true)
  })

  it.each([
    [{ action: 'delete' }],
    [{}],
    [{ action: 'extend', days: 0 }],
    [{ action: 'extend', days: 366 }],
    [{ action: 'change_plan', plan_code: 'pako-2' }],
    [{ action: 'pause', reason: 'x'.repeat(301) }],
  ])('rejects %o', (body) => {
    expect(adminSubscriptionActionSchema.safeParse(body).success).toBe(false)
  })

  it('maps a missing active subscription to 422', () => {
    expect(adminSubscriptionFailure('NO_ACTIVE_SUBSCRIPTION')).toMatchObject({ statusCode: 422, code: 'NO_ACTIVE_SUBSCRIPTION' })
  })

  it('leaves unknown database errors to the generic failure', () => {
    expect(adminSubscriptionFailure('connection reset')).toBeNull()
  })
})
