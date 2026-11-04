import type { Canvas } from '../../shared/schemas/channel-format'
import type { Storyboard } from '../../shared/schemas/storyboard'
import { generateAiVideo } from './ai-video-provider'
import { padFrameToCanvas } from './image-processing'
import { extractVideoFrames } from './video-compose'
import { buildShotExecutionBrief } from './video-execution-brief'
import { verifyVideoSubject } from './video-subject-check'

export class ShotSubjectChanged extends Error {
  constructor(public readonly shot: number, public readonly reason: string) {
    super('subject_changed')
  }
}

export type ShotDependencies = {
  // Told what every generated shot cost as soon as it is paid for, so a take
  // stopped by a changed subject is still charged for what it made.
  onCost: (costUsd: number | null) => void
  // Told how long each step of a shot took, so slow renders can be traced.
  onTiming: (step: string, ms: number) => void
  // Holds the cost of shooting a shot once more after it changed the subject,
  // and says whether that can be paid for. A shot shot again costs one shot,
  // where a new take costs a new direction and every shot of it.
  reserveRetry: (seconds: number, shot: number) => Promise<boolean>
  generate: typeof generateAiVideo
  verify: typeof verifyVideoSubject
  framesOf: typeof extractVideoFrames
}

const defaults: ShotDependencies = {
  onCost: () => undefined,
  onTiming: () => undefined,
  reserveRetry: async () => false,
  generate: generateAiVideo,
  verify: verifyVideoSubject,
  framesOf: extractVideoFrames,
}

/**
 * Generates every shot of a storyboard with the configured motion model, all
 * at once. Each shot is a scene of its own: it opens on its photograph, with
 * its own framing and move, instead of carrying on from the frame another
 * shot ended on, so the video changes view from scene to scene and no shot
 * waits for another. The first shot may open away from its photograph when
 * the director wrote an arrival and the model can still be pinned to it at
 * the end. A shot that ends on its photograph is pinned to it as its last
 * frame; the final shot always is. Every shot is held against its own
 * photograph.
 */
export async function generateStoryboardShots(input: {
  storyboard: Storyboard
  // The photograph on the channel canvas.
  fitted: Buffer
  // Further photographs of the same subject on the canvas; a shot's
  // photoIndex 1 is the first of them.
  extraFitted?: Buffer[]
  // The canvas the model paints and whether it accepts a closing frame.
  provider: { canvas: Canvas; aspectRatio: string }
  lastFrameSupported: boolean
  guardrails?: string[]
  maxLength?: number
  // 'stop' gives the take up when a shot changed the subject so a calmer take
  // can be tried; 'record' keeps every shot and reports it, so the last take
  // is always delivered for the business to judge and edit.
  onSubjectChange?: 'stop' | 'record'
}, dependencies: Partial<ShotDependencies> = {}) {
  const deps = { ...defaults, ...dependencies }
  const photographs = await Promise.all(
    [input.fitted, ...(input.extraFitted || [])].map((image) => padFrameToCanvas(image, input.provider.canvas)),
  )
  const shots = input.storyboard.shots
  const shoot = async (shot: Storyboard['shots'][number], index: number) => {
    const final = index === shots.length - 1
    const photograph = photographs[shot.photoIndex ?? 0] || photographs[0]!
    const endsOnPhotograph = (shot.endsOnPhotograph || final) && input.lastFrameSupported
    // An arrival may open away from the photograph only when the model can
    // still be pinned to it at the end; every other shot opens on it.
    const start: 'photograph' | 'free' =
      index === 0 && !shot.opensOnPhotograph && endsOnPhotograph ? 'free' : 'photograph'
    const request = (opening: typeof start) => deps.generate({
      image: opening === 'photograph' ? photograph : undefined,
      lastFrame: endsOnPhotograph ? photograph : undefined,
      prompt: buildShotExecutionBrief({
        storyboard: input.storyboard,
        index,
        start: opening,
        endsOnPhotograph,
        guardrails: input.guardrails,
        maxLength: input.maxLength,
      }),
      durationSeconds: shot.durationSeconds,
      canvas: input.provider.canvas,
      aspectRatio: input.provider.aspectRatio,
    })
    const attempt = async () => {
      let generated
      const generationStarted = Date.now()
      try {
        generated = await request(start)
      } catch (error) {
        // A model that will not take a closing frame alone gets the photograph
        // as its opening frame too, rather than losing the shot.
        if (start !== 'free') throw error
        generated = await request('photograph')
      }
      if (!generated) throw createError({ statusCode: 503, message: 'server.AI_VIDEO_NOT_CONFIGURED' })
      deps.onTiming(`shot_${index + 1}_generate`, Date.now() - generationStarted)
      deps.onCost(generated.costUsd)
      const checkStarted = Date.now()
      const check = await deps.verify({ photograph, frames: await deps.framesOf(generated.bytes, [0.3, 0.6, 0.95]) })
      deps.onTiming(`shot_${index + 1}_check`, Date.now() - checkStarted)
      deps.onCost(check.costUsd ?? 0)
      return { bytes: generated.bytes, costUsd: generated.costUsd, check }
    }
    let taken = await attempt()
    let costUsd: number | null = taken.costUsd
    // A shot that changed the subject is shot once more on its own before the
    // whole take is given up, when that one shot can still be paid for.
    if (!taken.check.sameSubject && await deps.reserveRetry(shot.durationSeconds, index + 1)) {
      taken = await attempt()
      costUsd = costUsd === null || taken.costUsd === null ? null : costUsd + taken.costUsd
    }
    return { bytes: taken.bytes, costUsd, check: taken.check }
  }
  // Every shot is waited for, even when one fails, so what each of them cost
  // is reported before the take is given up.
  const results = await Promise.allSettled(shots.map(shoot))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
  const taken = results.map((result) => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof shoot>>>).value)
  const subjectChanges = taken.flatMap((shot, index) =>
    shot.check.sameSubject ? [] : [{ shot: index + 1, reason: shot.check.reason }])
  if (subjectChanges.length && input.onSubjectChange !== 'record')
    throw new ShotSubjectChanged(subjectChanges[0]!.shot, subjectChanges[0]!.reason)
  const costUsd = taken.reduce<number | null>(
    (sum, shot) => (sum === null || shot.costUsd === null ? null : sum + shot.costUsd), 0)
  return { clips: taken.map((shot) => shot.bytes), costUsd, subjectChanges }
}

/** The shot length the model renders that is closest to the one asked for. */
export function closestDuration(requested: number, durations: number[]) {
  if (!durations.length) return requested
  return durations.reduce((best, value) => (Math.abs(value - requested) < Math.abs(best - requested) ? value : best))
}
