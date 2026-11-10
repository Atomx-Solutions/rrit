import { afterEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

const vercel = vi.hoisted(() => ({ deadline: undefined as Date | undefined, waitUntil: vi.fn() }))
vi.mock('@vercel/functions', () => ({
  getDeadline: () => vercel.deadline,
  waitUntil: vercel.waitUntil,
}))
// Both mocks are typed as they are called, so a test can read the options
// each was given.
type PlannerBatchOptions = { deadline?: number; discover?: boolean; once?: boolean }
type VideoQueueOptions = { deadline?: number; waitWhile?: () => boolean }
const planner = vi.hoisted(() => ({
  runMonthlyPlannerBatch: vi.fn(async (_db?: unknown, _options?: PlannerBatchOptions) => undefined),
}))
vi.mock('../../server/utils/monthly-planner', () => planner)
const videos = vi.hoisted(() => ({
  runVideoRenderQueue: vi.fn(async (_db?: unknown, _options?: VideoQueueOptions) => undefined),
}))
vi.mock('../../server/utils/video-queue', () => videos)
const imageEdits = vi.hoisted(() => ({
  runImageEditQueue: vi.fn(async (_db?: unknown, _options?: VideoQueueOptions) => undefined),
}))
vi.mock('../../server/utils/image-edit-queue', () => imageEdits)

const { invocationDeadline, runPlannerAndVideos, startMonthlyPlannerNow, startVideoRenderNow } = await import('../../server/utils/planner-run')
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

  it('starts a queued video straight away on Vercel', () => {
    vi.stubEnv('VERCEL', '1')
    vi.stubGlobal('useRuntimeConfig', () => ({ functionMaxDurationSeconds: 800 }))
    startVideoRenderNow(event, 1000)
    expect(videos.runVideoRenderQueue).toHaveBeenCalledWith(undefined, { deadline: 801000 })
    expect(vercel.waitUntil).toHaveBeenCalledTimes(1)
  })

  it('keeps the video lanes looking for queued videos only while plans are still advancing', async () => {
    let finishPlanning = () => {}
    planner.runMonthlyPlannerBatch.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      finishPlanning = () => resolve(undefined)
    }))
    let waitWhile: (() => boolean) | undefined
    videos.runVideoRenderQueue.mockImplementationOnce(async (_db?: unknown, options?: VideoQueueOptions) => {
      waitWhile = options?.waitWhile
      return undefined
    })
    const run = runPlannerAndVideos({ deadline: 5000 })
    await Promise.resolve()
    expect(waitWhile?.()).toBe(true)
    finishPlanning()
    await run
    expect(waitWhile?.()).toBe(false)
  })

  it('waits for the plans to finish when the videos fail, and only then reports it', async () => {
    let plansDone = false
    planner.runMonthlyPlannerBatch.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      plansDone = true
      return undefined
    })
    videos.runVideoRenderQueue.mockImplementationOnce(async () => {
      throw new Error('timeout exceeded when trying to connect')
    })
    await expect(runPlannerAndVideos({ deadline: 5000 })).rejects.toThrow('timeout exceeded')
    expect(plansDone).toBe(true)
  })

  it('leaves the run to the planner timer on a long-running host', () => {
    vi.stubEnv('VERCEL', '')
    // Built for a long-running server, not for Vercel.
    vi.stubGlobal('useRuntimeConfig', () => ({ functionMaxDurationSeconds: 800, onVercel: false }))
    startMonthlyPlannerNow(event, 1000)
    startVideoRenderNow(event, 1000)
    expect(planner.runMonthlyPlannerBatch).not.toHaveBeenCalled()
    expect(videos.runVideoRenderQueue).not.toHaveBeenCalled()
    expect(vercel.waitUntil).not.toHaveBeenCalled()
  })

  it('starts the run right after a request on Vercel even when the function does not see VERCEL', () => {
    // As in production: built for Vercel, VERCEL absent while it runs.
    vi.stubEnv('VERCEL', '')
    vi.stubGlobal('useRuntimeConfig', () => ({ functionMaxDurationSeconds: 800, onVercel: true }))
    startMonthlyPlannerNow(event, 1000)
    expect(planner.runMonthlyPlannerBatch).toHaveBeenCalledWith(undefined, { deadline: 801000, discover: false })
    expect(vercel.waitUntil).toHaveBeenCalled()
  })
})
