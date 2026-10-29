import { describe, expect, it } from 'vitest'
import { belowPaddleMinimum, paddleMinimumCents } from '../../shared/utils/paddle-minimum'

describe('Paddle minimum charge', () => {
  it('knows the CHF minimum Paddle reported', () => {
    expect(paddleMinimumCents('CHF')).toBe(60)
    expect(paddleMinimumCents('chf')).toBe(60)
  })

  it('rejects a paid CHF offer below the minimum', () => {
    expect(belowPaddleMinimum(5, 'CHF')).toBe(true)
    expect(belowPaddleMinimum(59, 'CHF')).toBe(true)
  })

  it('accepts the minimum and above', () => {
    expect(belowPaddleMinimum(60, 'CHF')).toBe(false)
    expect(belowPaddleMinimum(3000, 'CHF')).toBe(false)
  })

  it('leaves a goodwill package at zero alone', () => {
    expect(belowPaddleMinimum(0, 'CHF')).toBe(false)
  })

  it('does not limit a currency without a confirmed minimum', () => {
    expect(paddleMinimumCents('EUR')).toBeNull()
    expect(belowPaddleMinimum(5, 'EUR')).toBe(false)
  })
})
