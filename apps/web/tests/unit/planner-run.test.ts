import { afterEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

const vercel = vi.hoisted(() => ({ deadline: undefined as Date | undefined, waitUntil: vi.fn() }))
vi.mock('@vercel/functions', () => ({
  getDeadline: () => vercel.deadline,
  waitUntil: vercel.waitUntil,
}))
const planner = vi.hoisted(() => ({ runMonthlyPlannerBatch: vi.fn(async () => undefined) }))
vi.mock('../../server/utils/monthly-planner', () => planner)

const { invocationDeadline, startMonthlyPlannerNow } = await import('../../server/utils/planner-run')
const event = {} as H3Event

afterEach(() => {
  vercel.deadline = undefined
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('planner runs started from a request', () => {
  it('stops at the deadline Vercel reports, and otherwise at the configured limit', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ functionMaxDurationSeconds: 800 }))
    expect(invocationDeadline(event, 1000)).toBe(801000)
    vercel.deadline = new Date(5000)
    expect(invocationDeadline(event, 1000)).toBe(5000)
  })

  it('keeps the run going after the reply on Vercel, without rediscovering businesses', () => {
    vi.stubEnv('VERCEL', '1')
    vi.stubGlobal('useRuntimeConfig', () => ({ functionMaxDurationSeconds: 800 }))
    startMonthlyPlannerNow(event, 1000)
    expect(planner.runMonthlyPlannerBatch).toHaveBeenCalledWith(undefined, { deadline: 801000, discover: false })
    expect(vercel.waitUntil).toHaveBeenCalledTimes(1)
  })

  it('leaves the run to the planner timer on a long-running host', () => {
    vi.stubEnv('VERCEL', '')
    startMonthlyPlannerNow(event, 1000)
    expect(planner.runMonthlyPlannerBatch).not.toHaveBeenCalled()
    expect(vercel.waitUntil).not.toHaveBeenCalled()
  })
})
