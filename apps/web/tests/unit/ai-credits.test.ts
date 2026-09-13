import { describe, expect, it } from 'vitest'
import { aiCreditBalance } from '../../server/utils/ai-credits'

describe('AI credit balance', () => {
  it('starts with the complete client-facing allowance', () => {
    expect(aiCreditBalance(0, 1000, 3_500_000)).toEqual({
      available: 1000,
      used: 0,
      limit: 1000,
      percentage: 100,
      state: 'available',
    })
  })

  it('converts provider spend without exposing the conversion to the client', () => {
    expect(aiCreditBalance(1_750_000, 1000, 3_500_000)).toMatchObject({
      available: 500,
      used: 500,
      percentage: 50,
      state: 'available',
    })
  })

  it('reports low and exhausted balances without going negative', () => {
    expect(aiCreditBalance(2_800_000, 1000, 3_500_000).state).toBe('low')
    expect(aiCreditBalance(4_000_000, 1000, 3_500_000)).toMatchObject({
      available: 0,
      used: 1000,
      percentage: 0,
      state: 'exhausted',
    })
  })
})
