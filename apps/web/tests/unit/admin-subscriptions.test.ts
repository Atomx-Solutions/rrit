import { describe, expect, it } from 'vitest'
import {
  adminSubscriptionActionSchema,
  adminSubscriptionFailure,
  adminSubscriptionsQuerySchema,
  normalizeAdminSubscriptions,
} from '../../server/utils/admin-subscriptions'

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

describe('admin subscriptions query schema', () => {
  it('accepts empty query (all defaults)', () => {
    expect(adminSubscriptionsQuerySchema.safeParse({}).success).toBe(true)
  })

  it('accepts all valid params', () => {
    const result = adminSubscriptionsQuerySchema.safeParse({
      page: '2',
      per_page: '100',
      status: 'active',
      plan: 'pako-1',
      expiring_days: '7',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.page).toBe(2)
    expect(result.data.per_page).toBe(100)
    expect(result.data.expiring_days).toBe(7)
  })

  it('rejects removed subscription statuses and unknown statuses', () => {
    expect(adminSubscriptionsQuerySchema.safeParse({ status: 'past_due' }).success).toBe(false)
    expect(adminSubscriptionsQuerySchema.safeParse({ status: 'unknown' }).success).toBe(false)
  })

  it('clamps per_page to max 100', () => {
    expect(adminSubscriptionsQuerySchema.safeParse({ per_page: '101' }).success).toBe(false)
    expect(adminSubscriptionsQuerySchema.safeParse({ per_page: '100' }).success).toBe(true)
  })

  it('rejects expiring_days outside 1–365', () => {
    expect(adminSubscriptionsQuerySchema.safeParse({ expiring_days: '0' }).success).toBe(false)
    expect(adminSubscriptionsQuerySchema.safeParse({ expiring_days: '366' }).success).toBe(false)
    expect(adminSubscriptionsQuerySchema.safeParse({ expiring_days: '365' }).success).toBe(true)
  })

  it('accepts all valid statuses', () => {
    for (const status of ['active', 'draft', 'cancelled', 'expired']) {
      expect(adminSubscriptionsQuerySchema.safeParse({ status }).success).toBe(true)
    }
  })
})

describe('admin subscriptions list response', () => {
  it('returns an empty list, not an error, when nothing matches', () => {
    expect(normalizeAdminSubscriptions({ items: [], total: 0, page: 1, per_page: 50 }, {}))
      .toEqual({ items: [], total: 0, page: 1, per_page: 50, total_pages: 0 })
    expect(normalizeAdminSubscriptions(null, {}).items).toEqual([])
  })

  it('counts pages from the returned page size', () => {
    expect(normalizeAdminSubscriptions({ items: [], total: 51, page: 2, per_page: 25 }, { page: 2, per_page: 25 }).total_pages).toBe(3)
  })
})
