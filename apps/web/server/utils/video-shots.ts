import type { Canvas } from '../../shared/schemas/channel-format'
import type { Storyboard } from '../../shared/schemas/storyboard'
import { generateAiVideo } from './ai-video-provider'
import { padFrameToCanvas } from './image-processing'
import { extractLastFrame, extractVideoFrames } from './video-compose'
import { buildShotExecutionBrief } from './video-execution-brief'
import { verifyVideoSubject } from './video-subject-check'

export class ShotSubjectChanged extends Error {
  constructor(public readonly shot: number, public readonly reason: string) {
    super('subject_changed')
  }
}

export type ShotDependencies = {
  generate: typeof generateAiVideo
  verify: typeof verifyVideoSubject
  lastFrameOf: typeof extractLastFrame
  framesOf: typeof extractVideoFrames
}

const defaults: ShotDependencies = {
  generate: generateAiVideo,
  verify: verifyVideoSubject,
  lastFrameOf: extractLastFrame,
  framesOf: extractVideoFrames,
}

/**
 * Generates every shot of a storyboard with the configured motion model, one
 * after another. The first shot starts on the fitted photograph unless the
 * director wrote an arrival; each later shot starts on the last frame of the
 * one before, so the motion carries on without a jump; a shot that ends on the
 * photograph is pinned to it as its last frame, the final shot always is.
 * Every shot is held against the photograph before the next one is made.
 */
export async function generateStoryboardShots(input: {
  storyboard: Storyboard
  // The photograph on the channel canvas.
  fitted: Buffer
  // The canvas the model paints and whether it accepts a closing frame.
  provider: { canvas: Canvas; aspectRatio: string }
  lastFrameSupported: boolean
  guardrails?: string[]
  maxLength?: number
}, dependencies: Partial<ShotDependencies> = {}) {
  const deps = { ...defaults, ...dependencies }
  const photograph = await padFrameToCanvas(input.fitted, input.provider.canvas)
  const clips: Buffer[] = []
  let costUsd: number | null = 0
  for (const [index, shot] of input.storyboard.shots.entries()) {
    const final = index === input.storyboard.shots.length - 1
    const endsOnPhotograph = (shot.endsOnPhotograph || final) && input.lastFrameSupported
    // An arrival may open away from the photograph only when the model can
    // still be pinned to it at the end; otherwise it starts on it.
    const start: 'photograph' | 'previous_shot' | 'free' = index > 0
      ? 'previous_shot'
      : !shot.opensOnPhotograph && endsOnPhotograph ? 'free' : 'photograph'
    const firstFrame = start === 'previous_shot'
      ? await deps.lastFrameOf(clips[index - 1]!, input.provider.canvas)
      : start === 'photograph' ? photograph : undefined
    const request = (opening: typeof start, image: Buffer | undefined) => deps.generate({
      image,
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
    let generated
    try {
      generated = await request(start, firstFrame)
    } catch (error) {
      // A model that will not take a closing frame alone gets the photograph
      // as its opening frame too, rather than losing the shot.
      if (start !== 'free') throw error
      generated = await request('photograph', photograph)
    }
    if (!generated) throw createError({ statusCode: 503, message: 'server.AI_VIDEO_NOT_CONFIGURED' })
    costUsd = costUsd === null || generated.costUsd === null ? null : costUsd + generated.costUsd
    const check = await deps.verify({ photograph, frames: await deps.framesOf(generated.bytes, [0.3, 0.6, 0.95]) })
    if (!check.sameSubject) throw new ShotSubjectChanged(index + 1, check.reason)
    clips.push(generated.bytes)
  }
  return { clips, costUsd }
}

/** The shot length the model renders that is closest to the one asked for. */
export function closestDuration(requested: number, durations: number[]) {
  if (!durations.length) return requested
  return durations.reduce((best, value) => (Math.abs(value - requested) < Math.abs(best - requested) ? value : best))
}
