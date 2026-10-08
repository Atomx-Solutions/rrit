import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  PlannerFailure,
  requestedPlannerPosts,
} from '../../server/utils/monthly-planner-domain'

describe('requestedPlannerPosts', () => {
  it('accepts an explicit 0 so the batch can consist of videos alone', () => {
    expect(requestedPlannerPosts(0, 5)).toBe(0)
  })
  it('still accepts the normal in-range values', () => {
    expect(requestedPlannerPosts(1, 5)).toBe(1)
    expect(requestedPlannerPosts(3, 5)).toBe(3)
    expect(requestedPlannerPosts(5, 5)).toBe(5)
  })
  it('rejects a request above the remaining allowance', () => {
    expect(() => requestedPlannerPosts(6, 5)).toThrowError(PlannerFailure)
  })
  it('rejects negative or non-integer quantities', () => {
    expect(() => requestedPlannerPosts(-1, 5)).toThrowError(PlannerFailure)
    expect(() => requestedPlannerPosts(1.5, 5)).toThrowError(PlannerFailure)
  })
  it('does not enforce the combined-minimum rule itself (that is the caller\'s job)', () => {
    // 0 is valid in isolation; whether the overall request is valid depends on
    // whether a video count also arrived at the same boundary.
    expect(requestedPlannerPosts(0, 0)).toBe(0)
  })
})

// A thin HTTP-shape fixture that mirrors the body the client sends to the
// prepare/generate endpoint, parsed through the same zod schema the handler
// uses. The schema file does not export the zod instance, so the shape is
// rebuilt here to lock down the explicit-0 behaviour at the request boundary.
const requestBodySchema = z.object({
  action: z.enum(['prepare', 'generate', 'restart', 'reset', 'pause', 'enable']),
  quantity: z.number().int().min(0).max(100).optional(),
  videoQuantity: z.number().int().min(0).max(100).optional(),
})
function isValidCombination(quantity: number | undefined, videoQuantity: number | undefined) {
  const q = quantity ?? 0
  const v = videoQuantity ?? 0
  return q + v >= 1
}

describe('generation quantity combinations', () => {
  it.each([
    ['image-only, 1 + 0', 1, 0, true],
    ['image-only, 3 + 0', 3, 0, true],
    ['video-only, 0 + 1', 0, 1, true],
    ['video-only, 0 + 2', 0, 2, true],
    ['mixed, 1 + 1', 1, 1, true],
    ['mixed, 2 + 1', 2, 1, true],
    ['mixed, 1 + 2', 1, 2, true],
    ['nothing requested, 0 + 0', 0, 0, false],
  ])('%s', (_label, images, videos, accepted) => {
    const parsed = requestBodySchema.safeParse({
      action: 'generate',
      quantity: images,
      videoQuantity: videos,
    })
    // Explicit 0 round-trips through zod without being coerced away.
    expect(parsed.success).toBe(true)
    expect(parsed.data!.quantity).toBe(images)
    expect(parsed.data!.videoQuantity).toBe(videos)
    expect(isValidCombination(parsed.data!.quantity, parsed.data!.videoQuantity)).toBe(accepted)
  })
  it('leaves undefined different from an explicit 0', () => {
    const parsed = requestBodySchema.safeParse({ action: 'generate', videoQuantity: 2 })
    expect(parsed.success).toBe(true)
    expect(parsed.data!.quantity).toBeUndefined()
    expect(parsed.data!.videoQuantity).toBe(2)
    expect(isValidCombination(parsed.data!.quantity, parsed.data!.videoQuantity)).toBe(true)
  })
  it('rejects a request where both fields are omitted', () => {
    const parsed = requestBodySchema.safeParse({ action: 'generate' })
    expect(parsed.success).toBe(true)
    expect(isValidCombination(parsed.data!.quantity, parsed.data!.videoQuantity)).toBe(false)
  })
})
