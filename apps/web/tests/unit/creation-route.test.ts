import { describe, expect, it } from 'vitest'
import { monthlyPlannerPath } from '../../app/utils/creation-route'

describe('content creation destination', () => {
  it('uses Monthly Planner instead of the removed legacy editor', () => {
    expect(monthlyPlannerPath('/app/org/brand')).toBe('/app/org/brand/monthly-planner')
  })
})
