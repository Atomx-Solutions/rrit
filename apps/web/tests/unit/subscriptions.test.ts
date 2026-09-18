import { describe, expect, it } from 'vitest'
import {
  addMonths,
  annualPriceCents,
  creditWindow,
  planChange,
} from '../../server/utils/subscriptions'

const plan = (code: string, monthlyCents: number, monthlyCredits: number) => ({
  code,
  name: code,
  monthly_cents: monthlyCents,
  monthly_credits: monthlyCredits,
  annual_discount_percent: 15,
})

describe('annual subscription price', () => {
  it.each([
    [2499, 25490],
    [4499, 45890],
    [7999, 81590],
  ])('charges monthly %i cents x 12 x 0.85 = %i cents', (monthly, annual) => {
    expect(annualPriceCents(monthly, 15)).toBe(annual)
  })

  it('rejects an invalid discount', () => {
    expect(() => annualPriceCents(2499, 101)).toThrow('discountPercent')
  })
})

describe('monthly credit windows', () => {
  it('clamps to the last day of shorter months without drifting', () => {
    const start = new Date('2026-01-31T10:00:00.000Z')
    expect(addMonths(start, 1).toISOString()).toBe('2026-02-28T10:00:00.000Z')
    expect(addMonths(start, 2).toISOString()).toBe('2026-03-31T10:00:00.000Z')
  })

  it('refreshes an annual subscription every month instead of once a year', () => {
    const start = new Date('2026-01-31T10:00:00.000Z')
    const end = addMonths(start, 12)
    const window = creditWindow(start, end, new Date('2026-03-05T00:00:00.000Z'))
    expect(window.start.toISOString()).toBe('2026-02-28T10:00:00.000Z')
    expect(window.end.toISOString()).toBe('2026-03-31T10:00:00.000Z')
  })

  it('never extends a window beyond the paid period', () => {
    const start = new Date('2026-01-15T00:00:00.000Z')
    const end = new Date('2026-02-01T00:00:00.000Z')
    expect(creditWindow(start, end, start).end.toISOString()).toBe(end.toISOString())
  })
})

describe('package changes', () => {
  it('classifies upgrades, downgrades and unchanged packages', () => {
    const pako1 = plan('pako-1', 2499, 1000)
    const pako2 = plan('pako-2', 4499, 2250)
    expect(planChange(pako1, pako2)).toBe('upgrade')
    expect(planChange(pako2, pako1)).toBe('downgrade')
    expect(planChange(pako1, pako1)).toBe('unchanged')
  })
})
