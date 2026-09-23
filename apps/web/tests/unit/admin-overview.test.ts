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
      sales: { plans_total_cents: 0, plans_this_month_cents: 0, credits_total_cents: 0, credits_this_month_cents: 0, vat_total_cents: 0, vat_this_month_cents: 0 },
      ai: { cost_micro_eur_this_month: 0, cost_micro_eur_total: 30, margin_cents_this_month: 0 },
      users: { total: 0 },
      signups: { this_week: 0, this_month: 0 },
      new_organizations: [],
    })
  })

  it('does not allow malformed values to become null or NaN', () => {
    const overview = normalizeAdminOverview({ organizations: { total: 'not-a-number' } })
    expect(overview.organizations.total).toBe(0)
    expect(Object.values(overview.organizations).every(Number.isFinite)).toBe(true)
  })

  it('keeps every well-formed new organization', () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({ id: `org-${index}`, name: `Org ${index}`, plan_name: null, created_at: '2026-09-21T10:00:00Z' }))
    const overview = normalizeAdminOverview({ new_organizations: [{ name: 'no id' }, ...rows] })
    expect(overview.new_organizations).toHaveLength(7)
    expect(overview.new_organizations[0]).toEqual({ id: 'org-0', name: 'Org 0', plan_name: null, created_at: '2026-09-21T10:00:00Z' })
  })
})
