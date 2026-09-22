import { describe, expect, it } from 'vitest'
import { adminPlatformInvoicesQuerySchema, normalizeAdminPlatformInvoices } from '../../server/utils/admin-platform-invoices'

describe('admin platform invoices query', () => {
  it('defaults to the first page of 25', () => {
    expect(adminPlatformInvoicesQuerySchema.parse({})).toEqual({ page: 1, per_page: 25 })
  })

  it('accepts all filters together', () => {
    expect(adminPlatformInvoicesQuerySchema.parse({
      page: '2', per_page: '200', org_id: 'ee545607-d45d-45d2-b60f-e9db1db546e3', kind: 'invoice',
      source_type: 'credit_top_up', from: '2026-09-01', to: '2026-09-30',
    })).toEqual({
      page: 2, per_page: 200, org_id: 'ee545607-d45d-45d2-b60f-e9db1db546e3', kind: 'invoice',
      source_type: 'credit_top_up', from: '2026-09-01', to: '2026-09-30',
    })
  })

  it.each([
    { page: '0' }, { per_page: '201' }, { org_id: 'not-a-uuid' }, { kind: 'receipt' },
    { source_type: 'other' }, { from: '2026-02-30' }, { from: '2026-10-01', to: '2026-09-30' },
  ])('rejects invalid filters: %o', (query) => {
    expect(adminPlatformInvoicesQuerySchema.safeParse(query).success).toBe(false)
  })
})

describe('admin platform invoices response', () => {
  it('uses zeros and empty arrays for missing data', () => {
    expect(normalizeAdminPlatformInvoices(null, { page: 1, per_page: 25 })).toEqual({
      invoices: [],
      summary: { total_revenue_cents: 0, total_credit_notes_cents: 0, net_revenue_cents: 0, this_month_cents: 0 },
      total: 0,
      page: 1,
      per_page: 25,
    })
  })

  it('normalizes numeric invoice and summary values', () => {
    const result = normalizeAdminPlatformInvoices({
      invoices: [{ id: 'invoice', total_cents: '2000', subtotal_cents: '2000', vat_cents: null, lines: null }],
      summary: { total_revenue_cents: '2000', total_credit_notes_cents: '-500', net_revenue_cents: '1500', this_month_cents: null },
      total: '1', page: '2', per_page: '50',
    }, { page: 1, per_page: 25 })
    expect(result.summary).toEqual({ total_revenue_cents: 2000, total_credit_notes_cents: -500, net_revenue_cents: 1500, this_month_cents: 0 })
    expect(result.invoices[0]).toMatchObject({ total_cents: 2000, subtotal_cents: 2000, vat_cents: 0, lines: [] })
    expect(result).toMatchObject({ total: 1, page: 2, per_page: 50 })
  })
})
