import { describe, expect, it } from 'vitest'
import { allocatePlanCredits, creditsForAiUsage, creditsForProviderCost, splitCredits } from '../../server/utils/credits'

describe('credit wallet allocation', () => {
  it.each([
    [1000, { research: 500, generation: 500 }],
    [2250, { research: 1125, generation: 1125 }],
    [4000, { research: 2000, generation: 2000 }],
  ])('splits %i monthly credits equally', (credits, expected) => {
    expect(splitCredits(credits)).toEqual(expected)
  })
})

describe('plan credit allocation', () => {
  it.each([
    [250, 3],
    [1000, 14],
    [2250, 30],
    [4000, 60],
  ])('covers every advertised post for %i credits and %i posts', (credits, posts) => {
    const allocation = allocatePlanCredits(credits, posts)
    expect(allocation).toHaveLength(posts)
    expect(allocation.reduce((sum, item) => sum + item.credits, 0)).toBe(credits)
    expect(Math.max(...allocation.map((item) => item.credits)) - Math.min(...allocation.map((item) => item.credits))).toBeLessThanOrEqual(1)
  })

  it('rejects an allowance that cannot fund every advertised post', () => {
    expect(() => allocatePlanCredits(10, 14)).toThrow('at least one credit')
  })
})

describe('AI token charging', () => {
  it('charges both input and output tokens from the common credit balance', () => {
    expect(creditsForAiUsage(120, 80)).toBe(200)
  })

  it('rounds an image provider cost up to the purchased token unit', () => {
    expect(creditsForProviderCost(7001, 7000)).toBe(2)
  })
})
