import { describe, expect, it } from 'vitest'
import { addMonths, annualPriceCents } from '../../server/utils/subscriptions'

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

describe('adding months', () => {
  it('clamps to the last day of shorter months without drifting', () => {
    const start = new Date('2026-01-31T10:00:00.000Z')
    expect(addMonths(start, 1).toISOString()).toBe('2026-02-28T10:00:00.000Z')
    expect(addMonths(start, 2).toISOString()).toBe('2026-03-31T10:00:00.000Z')
  })
})
