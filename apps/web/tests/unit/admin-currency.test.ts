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

describe('dated conversion and reporting days', async () => {
  const { getExchangeRate } = await import('../../server/utils/exchange-rates')
  const { startOfDayIn, nextDay } = await import('../../server/utils/admin-currency')

  it('converts a row at the rate of the day it was invoiced', async () => {
    await sumInCurrency([{ currency: 'EUR', total_cents: 1000, rate_date: '2026-10-15' }], ['total_cents'] as const, 'CHF')
    expect(getExchangeRate).toHaveBeenLastCalledWith('EUR', 'CHF', '2026-10-15')
  })

  it('starts a day at local midnight in the admin time zone', () => {
    expect(startOfDayIn('2026-11-01', 'Europe/Zurich')).toBe('2026-10-31T23:00:00.000Z')
    expect(startOfDayIn('2026-07-01', 'Europe/Zurich')).toBe('2026-06-30T22:00:00.000Z')
    expect(startOfDayIn('2026-11-01', 'UTC')).toBe('2026-11-01T00:00:00.000Z')
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
  })
})
