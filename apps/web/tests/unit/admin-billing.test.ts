import { describe, expect, it } from 'vitest'
import { adminBillingInvoicesQuerySchema } from '../../server/utils/admin-billing'

describe('admin billing invoices query schema', () => {
  it('accepts all optional params absent', () => {
    expect(adminBillingInvoicesQuerySchema.safeParse({}).success).toBe(true)
  })

  it('accepts valid full query', () => {
    const result = adminBillingInvoicesQuerySchema.safeParse({
      page: '2',
      per_page: '100',
      org_id: '00000000-0000-4000-8000-000000000001',
      kind: 'invoice',
      source_type: 'credit_top_up',
      from: '2026-09-01',
      to: '2026-09-22',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.page).toBe(2)
    expect(result.data.per_page).toBe(100)
    expect(result.data.kind).toBe('invoice')
  })

  it('rejects invalid kind', () => {
    expect(adminBillingInvoicesQuerySchema.safeParse({ kind: 'receipt' }).success).toBe(false)
  })

  it('rejects invalid source_type', () => {
    expect(adminBillingInvoicesQuerySchema.safeParse({ source_type: 'unknown_source' }).success).toBe(false)
  })

  it('rejects non-ISO date formats', () => {
    expect(adminBillingInvoicesQuerySchema.safeParse({ from: '01/09/2026' }).success).toBe(false)
    expect(adminBillingInvoicesQuerySchema.safeParse({ from: '2026-09-01' }).success).toBe(true)
  })

  it('rejects invalid org_id', () => {
    expect(adminBillingInvoicesQuerySchema.safeParse({ org_id: 'not-a-uuid' }).success).toBe(false)
  })

  it('clamps per_page to max 200', () => {
    expect(adminBillingInvoicesQuerySchema.safeParse({ per_page: '500' }).success).toBe(false)
    expect(adminBillingInvoicesQuerySchema.safeParse({ per_page: '200' }).success).toBe(true)
  })

  it('accepts both credit_note values independently for kind and source_type', () => {
    expect(adminBillingInvoicesQuerySchema.safeParse({ kind: 'credit_note' }).success).toBe(true)
    expect(adminBillingInvoicesQuerySchema.safeParse({ source_type: 'credit_note' }).success).toBe(true)
  })
})
