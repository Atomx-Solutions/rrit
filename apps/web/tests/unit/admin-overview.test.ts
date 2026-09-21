import { describe, expect, it } from 'vitest'
import { normalizeAdminOverview } from '../../server/utils/admin-overview'

describe('admin overview response', () => {
  it('keeps the documented KPI structure numeric when Supabase has no data', () => {
    expect(normalizeAdminOverview({
      organizations: { total: null, active: '2' },
      subscriptions: { mrr_cents: null },
      revenue: {},
      ai: { cost_micro_eur_total: '30' },
      users: { total: null },
      signups: {},
    })).toEqual({
      organizations: { total: 0, active: 2, trialing: 0, paused: 0, cancelled: 0 },
      subscriptions: { mrr_cents: 0, active: 0, trialing: 0 },
      revenue: { total_cents: 0, this_month_cents: 0 },
      ai: { cost_micro_eur_this_month: 0, cost_micro_eur_total: 30 },
      users: { total: 0 },
      signups: { this_week: 0, this_month: 0 },
    })
  })

  it('does not allow malformed values to become null or NaN', () => {
    const overview = normalizeAdminOverview({ organizations: { total: 'not-a-number' } })
    expect(overview.organizations.total).toBe(0)
    expect(Object.values(overview.organizations).every(Number.isFinite)).toBe(true)
  })
})
