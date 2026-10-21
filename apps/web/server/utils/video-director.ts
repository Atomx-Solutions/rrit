import { z } from 'zod'
import { channelCanvas, channelUiInsets, ratioLabel, type PublishingChannel } from '../../shared/schemas/channel-format'
import { contentLanguageForLocale, type AppLocaleValue } from '../../shared/schemas/workspace'
import {
  maxStoryboardRotationDegrees,
  maxStoryboardShots,
  storyboardProblems,
  storyboardSchema,
  type Storyboard,
  type StoryboardLimits,
} from '../../shared/schemas/storyboard'
import {
  aiProviderConfiguration,
  aiProviderJsonSchema,
  aiProviderModel,
  aiProviderStructuredRouting,
} from './ai-provider'
import { parseMonthlyProviderResponse, responseText } from './monthly-ai'

function seconds(variable: string, fallback: number) {
  const value = Number(process.env[variable])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

// How long a video may be (VIDEO_MIN_SECONDS / VIDEO_MAX_SECONDS) and the
// shot lengths the configured motion model renders.
export function videoLengthLimits(durations: number[]): StoryboardLimits {
  return {
    durations,
    minSeconds: seconds('VIDEO_MIN_SECONDS', 6),
    maxSeconds: seconds('VIDEO_MAX_SECONDS', 12),
  }
}

// How long one shot blends into the next (VIDEO_CROSSFADE_SECONDS).
export function videoCrossfadeSeconds() {
  return seconds('VIDEO_CROSSFADE_SECONDS', 0.5)
}

export type DirectorInput = {
  // The photograph already fitted to the channel canvas; the video starts here.
  photograph: Buffer
  channel: PublishingChannel
  limits: StoryboardLimits
  locale: AppLocaleValue
  brand: { name: string; industry: string; audience: string; voice?: string }
  guardrails?: string[]
  post: {
    title: string
    caption: string
    hook: string
    cta: string
    intent?: string
    purpose?: string
    assetDirection?: string
  }
  // Set when the last concept changed the subject once it was generated: the
  // director is asked for a calmer one.
  previousAttempt?: { storyboard: Storyboard | null; problem: string }
  // What the business asked for in Edit video with AI, in its own words.
  userInstruction?: string
}

/**
 * The creative director's brief. It states who the video is for and the rules
 * a single photograph imposes, and nothing about what the video should be:
 * the concept, the shots and every camera choice are the model's to invent for
 * this post.
 */
export function directorInstructions(input: Pick<DirectorInput, 'channel' | 'limits' | 'locale' | 'previousAttempt' | 'userInstruction'>) {
  const { limits } = input
  const lengths = limits.durations.length
    ? `Each shot lasts exactly one of ${limits.durations.join(', ')} seconds, the lengths the motion model renders.`
    : 'Give each shot a whole number of seconds.'
  const canvas = channelCanvas(input.channel)
  const covered = channelUiInsets(input.channel)
  const coveredSides = (['top', 'right', 'bottom', 'left'] as const)
    .filter((side) => covered[side] > 0)
    .map((side) => `the ${side} ${Math.round(covered[side] * 100)}%`)
  return [
    'Act as a senior creative director and cinematographer for short commercial social videos. Invent one original video concept for this exact business, post and photograph, as a storyboard the motion model will shoot.',
    `The video is for ${input.channel}, on a ${ratioLabel(canvas)} canvas, between ${limits.minSeconds} and ${limits.maxSeconds} seconds long in total, in 1 to ${maxStoryboardShots} shots. ${lengths} Two shots usually serve best; use one when a single move says everything, and three only when the concept truly needs three beats, because every shot is generated and joined separately.${coveredSides.length ? ` ${input.channel} covers ${coveredSides.join(', ')} of the frame with its interface, so nothing important happens there.` : ''}`,
    'Everything is made from the single supplied photograph. You are free with everything around the subject: the environment, light, time of day, weather, sky, atmosphere, particles, reflections and effects; how the subject arrives in its photographed place (for example descending from the sky and landing, rolling in out of light or fog); and the camera, including drone flights, push-ins, rises, reveals, tracking and small turns.',
    `You are not free with the subject itself. It must stay exactly the subject in the photograph: the same model, colour, shape, logo, wheels and details. Show only the side of it the photograph shows: the camera may turn around it by at most ${maxStoryboardRotationDegrees} degrees in a shot, never orbit it, never 360 degrees, never show its back, underside or interior. Set rotationDegrees honestly and showsOnlyPhotographedSides to true only when that holds.`,
    'The final shot must end on the real photograph (endsOnPhotograph=true), so the video closes on the true subject. Mark each shot that opens on the photograph\'s own view with opensOnPhotograph=true.',
    'Write every shot as a cinematographer\'s brief: the camera move, the lens (focal length or look), the speed, the ease in and out, the light and atmosphere, the effects, and what the subject does. Be concrete and visual. No text, letters, logos or captions appear in the motion; the application sets the call to action over it.',
    `Write cta (a short call to action, at most 32 characters) and caption in ${contentLanguageForLocale(input.locale)}, in the brand voice, from the supplied post. Do not invent prices, offers, facts or claims.`,
    'Make this concept your own for this post: do not fall back on a generic slow push-in unless it is truly the best idea for this photograph.',
    ...(input.userInstruction
      ? ['businessRequest is what the business itself asked for in this video. Follow it ahead of your own ideas, as far as the rules above about the subject and the photograph allow; where it would break them, keep to the rules and come as close to the request as they permit.']
      : []),
    ...(input.previousAttempt
      ? ['previousAttempt holds your last storyboard and how the motion model changed the subject when it shot it. Propose a calmer concept for the same post: keep the subject still in its photographed place, move the camera less and more slowly, turn it little or not at all, and let the atmosphere and light carry the energy instead.']
      : []),
  ].join('\n')
}

function payload(input: DirectorInput, corrections: string[]) {
  return {
    business: input.brand,
    restrictions: input.guardrails || [],
    post: input.post,
    channel: input.channel,
    videoLength: input.limits,
    ...(input.previousAttempt ? { previousAttempt: input.previousAttempt } : {}),
    ...(input.userInstruction ? { businessRequest: input.userInstruction } : {}),
    ...(corrections.length ? { correctionsFromYourLastStoryboard: corrections } : {}),
  }
}

// The storyboard is null when the director could not give a valid one; what
// its attempts cost is charged either way.
export type DirectorResult = { storyboard: Storyboard | null; costUsd: number }

/**
 * The storyboard for one video. Without a valid one the caller falls back on
 * the strategy's own shot direction. An invalid answer is sent back once with
 * what was wrong with it.
 */
export async function directVideo(input: DirectorInput, attempts = 2): Promise<DirectorResult> {
  let costUsd = 0
  let corrections: string[] = []
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const provider = aiProviderConfiguration()
      const response = await fetch(provider.responsesUrl, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(90000),
        headers: provider.headers,
        body: JSON.stringify({
          model: aiProviderModel('AI_PLANNER_MODEL'),
          store: false,
          instructions: directorInstructions(input),
          max_output_tokens: 3000,
          input: [{
            role: 'user',
            content: [
              { type: 'input_text', text: JSON.stringify(payload(input, corrections)) },
              { type: 'input_image', image_url: `data:image/jpeg;base64,${input.photograph.toString('base64')}`, detail: 'high' },
            ],
          }],
          ...aiProviderStructuredRouting(provider.name),
          text: {
            format: {
              type: 'json_schema',
              name: 'video_storyboard',
              strict: true,
              schema: aiProviderJsonSchema(z.toJSONSchema(storyboardSchema)),
            },
          },
        }),
      })
      if (!response.ok) {
        corrections = []
        continue
      }
      const raw = await response.json() as { usage?: { cost?: unknown } }
      if (typeof raw.usage?.cost === 'number' && raw.usage.cost > 0) costUsd += raw.usage.cost
      const parsed = storyboardSchema.safeParse(JSON.parse(responseText(parseMonthlyProviderResponse(raw))))
      if (!parsed.success) {
        corrections = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        continue
      }
      corrections = storyboardProblems(parsed.data, input.limits)
      if (!corrections.length) return { storyboard: parsed.data, costUsd }
    } catch (error) {
      console.warn('The video director could not answer', { error: error instanceof Error ? error.message : 'unknown' })
    }
  }
  return { storyboard: null, costUsd }
}
