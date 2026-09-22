import { describe, expect, it } from 'vitest'
import {
  adminPlansFailure,
  creditPricingChangesSchema,
  invoiceSettingsChangesSchema,
  planChangesSchema,
} from '../../server/utils/admin-plans'

describe('admin plan changes', () => {
  it('accepts a partial change', () => {
    expect(planChangesSchema.safeParse({ monthly_cents: 2999, annual_discount_percent: 15, active: false }).success).toBe(true)
  })

  it.each([
    [{ monthly_cents: -1 }],
    [{ monthly_credits: -5 }],
    [{ posts_per_month: 1.5 }],
    [{ style_fetch_post_count: 0 }],
    [{ annual_discount_percent: -1 }],
    [{ annual_discount_percent: 101 }],
    [{}],
    [{ code: 'pako-9' }],
  ])('rejects %o', (body) => {
    expect(planChangesSchema.safeParse(body).success).toBe(false)
  })

  it('maps an unknown plan to 404', () => {
    expect(adminPlansFailure('PLAN_NOT_FOUND')).toMatchObject({ statusCode: 404 })
  })
})

describe('admin credit pricing and invoice settings', () => {
  it.each([[{ credit_price_cents: -2 }], [{ credit_price_cents: 0 }], [{ provider_cost_per_credit_micro_eur: -7000 }], [{ low_credit_threshold: -1 }]])(
    'rejects credit pricing %o',
    (body) => {
      expect(creditPricingChangesSchema.safeParse(body).success).toBe(false)
    },
  )

  it('accepts a VAT rate of 18%', () => {
    expect(invoiceSettingsChangesSchema.safeParse({ vat_rate_basis_points: 1800 }).success).toBe(true)
  })

  it.each([[{ vat_rate_basis_points: -1 }], [{ vat_rate_basis_points: 10001 }], [{ number_prefix: 'rr it' }]])(
    'rejects invoice settings %o',
    (body) => {
      expect(invoiceSettingsChangesSchema.safeParse(body).success).toBe(false)
    },
  )
})
