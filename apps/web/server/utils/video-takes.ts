import { creditsForProviderCost } from './credits'
import type { Storyboard } from '../../shared/schemas/storyboard'
import { ShotSubjectChanged } from './video-shots'

type Direction = { storyboard: Storyboard | null; costUsd: number }
type PreviousAttempt = { storyboard: Storyboard | null; problem: string }

/**
 * Directs and shoots a video in at most two takes. The first take stops at a
 * shot that changed the subject; the director is then told how, and its
 * calmer concept is shot as the last take, which is always delivered with
 * whatever the subject check saw. The first take is already the last when a
 * second could not be paid for. A take the business cannot pay for is never
 * started: `reserve` holds its cost first and throws when it cannot.
 */
export async function directedTakes<Take>(steps: {
  direct: (previousAttempt?: PreviousAttempt) => Promise<Direction>
  // The seconds a take of this storyboard (or of the strategy shot) lasts.
  seconds: (storyboard: Storyboard | null) => number
  reserve: (seconds: number, attempt: number) => Promise<void>
  // Whether a second take could still be paid for after this many seconds.
  retryAffordable: (plannedSeconds: number, nextSeconds: number) => boolean
  take: (storyboard: Storyboard | null, calmer: boolean, mode: 'stop' | 'record') => Promise<Take>
}) {
  let directionCostUsd = 0
  let plannedSeconds = 0
  let previousAttempt: PreviousAttempt | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    const direction = await steps.direct(previousAttempt)
    directionCostUsd += direction.costUsd
    const seconds = steps.seconds(direction.storyboard)
    await steps.reserve(seconds, attempt)
    plannedSeconds += seconds
    const last = attempt > 0 || !steps.retryAffordable(plannedSeconds, seconds)
    try {
      const result = await steps.take(direction.storyboard, attempt > 0, last ? 'record' : 'stop')
      return { result, storyboard: direction.storyboard, directionCostUsd, attempts: attempt + 1 }
    } catch (error) {
      if (!(error instanceof ShotSubjectChanged)) throw error
      previousAttempt = { storyboard: direction.storyboard, problem: `Shot ${error.shot}: ${error.reason}` }
    }
  }
  // The second take records rather than stops, so it always returns.
  throw new Error('No take was made')
}

/**
 * The credits a finished video is charged: its real provider cost converted
 * at the credit rate, or the reservation itself when the provider reported no
 * cost or no USD rate is configured, since guessing lower would give the work
 * away and guessing higher would overcharge.
 */
export function videoChargeCredits(input: {
  costUsd: number | null
  reservedCredits: number
  usdMicroEur: number | null
  providerCostPerCreditMicroEur: number
}) {
  if (input.costUsd === null || input.costUsd <= 0 || !input.usdMicroEur) return input.reservedCredits
  // To the nearest micro-EUR: a dollar price times the rate carries binary
  // rounding error (1.2 x 900 000 is 1 080 000.0000000002), and rounding that
  // up would charge a credit for nothing.
  return creditsForProviderCost(Math.max(1, Math.round(input.costUsd * input.usdMicroEur)), input.providerCostPerCreditMicroEur)
}
