import { describe, expect, it, vi } from 'vitest'

vi.mock('../../server/utils/admin-supabase', () => ({ adminServiceClient: vi.fn() }))
vi.mock('../../server/utils/exchange-rates', () => ({
  getExchangeRate: vi.fn(async (from: string, to: string) => ({ rate: from === to ? 1 : from === 'EUR' ? 0.9 : 1.1 })),
}))

const { sumInCurrency } = await import('../../server/utils/admin-currency')

describe('sumInCurrency', () => {
  it('converts each currency before adding, instead of summing francs and euros', async () => {
    const rows = [
      { currency: 'CHF', total_cents: 1000 },
      { currency: 'EUR', total_cents: 1000 },
    ]
    await expect(sumInCurrency(rows, ['total_cents'] as const, 'CHF')).resolves.toEqual({ total_cents: 1900 })
    await expect(sumInCurrency(rows, ['total_cents'] as const, 'EUR')).resolves.toEqual({ total_cents: 2100 })
  })
})
