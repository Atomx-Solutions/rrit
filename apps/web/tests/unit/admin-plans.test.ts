import { describe, expect, it } from 'vitest'
import {
  creditPricingChangesSchema,
  invoiceSettingsChangesSchema,
} from '../../server/utils/admin-plans'

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
