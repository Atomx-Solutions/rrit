import { describe, expect, it } from 'vitest'
import { paddlePackageLines } from '../../server/utils/paddle-package-lines'

const base = { posts_included: 0, videos_included: 0, credits_included: 0, price_cents: 0, post_price_cents: 535, video_price_cents: 200 }
const total = (lines: { quantity: number; unitAmountCents: number }[]) =>
  lines.reduce((sum, line) => sum + line.quantity * line.unitAmountCents, 0)

describe('Paddle package lines', () => {
  it('charges posts per post and lets the checkout change the count', () => {
    const result = paddlePackageLines({ ...base, posts_included: 14, price_cents: 14 * 535 }, 'x')
    expect(result.lines).toEqual([{ quantity: 14, unitAmountCents: 535, name: 'Framic — Post', description: 'Framic posts' }])
    expect(result.adjustable).toBe(true)
  })

  it('charges the credits of a mixed package and keeps the quantity fixed', () => {
    const row = { ...base, posts_included: 10, credits_included: 50, price_cents: 10 * 535 + 100 }
    const result = paddlePackageLines(row, 'x')
    expect(total(result.lines)).toBe(row.price_cents)
    expect(result.lines.at(-1)).toMatchObject({ quantity: 50, unitAmountCents: 2 })
    expect(result.adjustable).toBe(false)
  })

  it('charges posts, videos and credits together', () => {
    const row = { ...base, posts_included: 3, videos_included: 2, credits_included: 7, price_cents: 3 * 535 + 2 * 200 + 10 }
    const result = paddlePackageLines(row, 'x')
    expect(result.lines).toHaveLength(3)
    expect(total(result.lines)).toBe(row.price_cents)
    expect(result.adjustable).toBe(false)
  })

  it('does not let the count change when credits do not split evenly', () => {
    const result = paddlePackageLines({ ...base, credits_included: 7, price_cents: 1000 }, 'x')
    expect(result.lines).toEqual([{ quantity: 1, unitAmountCents: 1000, name: 'Framic — 7 credits', description: 'Framic credits' }])
    expect(result.adjustable).toBe(false)
  })

  it('charges a negotiated total as one fixed line', () => {
    const result = paddlePackageLines({ ...base, posts_included: 10, price_cents: 4000 }, 'Framic — 10 posts')
    expect(result.lines).toEqual([{ quantity: 1, unitAmountCents: 4000, name: 'Framic — 10 posts', description: 'Framic — 10 posts' }])
    expect(result.adjustable).toBe(false)
  })
})
