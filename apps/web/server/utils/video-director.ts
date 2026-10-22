import { z } from 'zod'
import { channelCanvas, channelUiInsets, ratioLabel, type PublishingChannel } from '../../shared/schemas/channel-format'
import { contentLanguageForLocale, type AppLocaleValue } from '../../shared/schemas/workspace'
import {
  maxStoryboardRotationDegrees,
  maxStoryboardShots,
  storyboardProblems,
  storyboardShape,
  ctaMaxLength,
  directorStoryboardSchema,
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
  // Further photographs of the same subject from other angles, fitted the same
  // way. They are photographs 2 and on; limits.photos counts them all.
  extraPhotographs?: Buffer[]
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
    // The post's goal only. The planner's own motion direction is not passed:
    // the concept and every camera choice are the director's.
    purpose?: string
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
  const shape = storyboardShape(limits)
  const shapeRule = shape
    ? `Its shots last ${shape.totalSeconds} seconds together, the full length of the video, told in ${shape.minShots === shape.maxShots ? shape.minShots : `${shape.minShots} to ${shape.maxShots}`} separate shots. Each shot is its own scene with its own camera idea, framing, light or moment, generated separately and joined to the next, so the video moves through the concept instead of holding one move.`
    : `It lasts between ${limits.minSeconds} and ${limits.maxSeconds} seconds in total, in 1 to ${maxStoryboardShots} shots.`
  const canvas = channelCanvas(input.channel)
  const covered = channelUiInsets(input.channel)
  const coveredSides = (['top', 'right', 'bottom', 'left'] as const)
    .filter((side) => covered[side] > 0)
    .map((side) => `the ${side} ${Math.round(covered[side] * 100)}%`)
  return [
    'Act as a senior creative director and cinematographer for short commercial social videos. Invent one original video concept for this exact business, post and photograph, as a storyboard the motion model will shoot.',
    `The video is for ${input.channel}, on a ${ratioLabel(canvas)} canvas. ${shapeRule} ${lengths}${coveredSides.length ? ` ${input.channel} covers ${coveredSides.join(', ')} of the frame with its interface, so nothing important happens there.` : ''}`,
    'Everything is made from the supplied photographs of one subject, and each shot from one of them. You are free with everything around the subject: the environment, light, time of day, weather, sky, atmosphere, particles, reflections and effects; how the subject arrives in its photographed place (for example descending from the sky and landing, rolling in out of light or fog); and the camera, including drone flights, push-ins, rises, reveals, tracking and small turns.',
    `You are not free with the subject itself. It must stay exactly the subject in the photograph: the same model, colour, shape, logo, wheels and details. Show only the side of it the photograph shows: the camera may turn around it by at most ${maxStoryboardRotationDegrees} degrees in a shot, never orbit it, never 360 degrees, never show its back, underside or interior. Set rotationDegrees honestly and showsOnlyPhotographedSides to true only when that holds.`,
    'The final shot must end on the real photograph (endsOnPhotograph=true), so the video closes on the true subject. Mark each shot that opens on the photograph\'s own view with opensOnPhotograph=true.',
    'Write every shot as a cinematographer\'s brief: the camera move, the lens (focal length or look), the speed, the ease in and out, the light and atmosphere, the effects, and what the subject does. Be concrete and visual. No text, letters, logos or captions appear in the motion; the application sets the call to action over it.',
    'Give every shot a shotSize (wide, medium, close or detail) and never give two consecutive shots the same one, so each scene has its own framing: for example a wide establishing scene, then a close one on a detail of the subject. Changing only the direction of the same move is not a new scene.',
    'Set subjectFrame to where the subject spans vertically in the supplied photograph, as shares of its height from the top (0 is the top edge, 1 the bottom). The application places its headline and call to action in the free space above or below that band, so judge it honestly from the photograph.',
    `Write cta (a short call to action, at most ${ctaMaxLength} characters) and caption in ${contentLanguageForLocale(input.locale)}, in the brand voice, from the supplied post. Do not invent prices, offers, facts or claims.`,
    'Make this concept your own for this post: do not fall back on a generic slow push-in unless it is truly the best idea for this photograph.',
    'Edit it like a senior short-form ad editor. Give every shot a role: shot 1 is the hook, the most arresting moment of the video, with a strong camera move that stops the scroll inside its first second; then build shots that show the product from their own angle and detail; then a payoff that lands the idea; the final shot is the close, settling on the main photograph so the call to action can land. Energy rises towards the payoff and settles in the close.',
    'Every shot except the close moves the camera visibly and with intent: a dolly in or out, a lateral slide or tracking move, a crane rise or drop, a push through foreground elements, a parallax move that separates the subject from its background, or a small turn within the allowed degrees. A locked, tripod, static or fixed camera, or a barely perceptible digital zoom, is not a move. Set motion to strong for the hook, medium or strong for build and payoff, and subtle only for the close. Vary the kind of move from shot to shot, and let each move carry into the next shot the way a match cut or a motivated transition would.',
    'Set endCard to true when a closing branded beat helps this video (an offer, a booking ask, a first introduction of the brand) and false when the video should end on the scene.',
    ...((limits.photos || 1) > 1
      ? [`You are given ${limits.photos} photographs of the same subject from different angles, in order: photograph 1 is the main one, the others follow. Give every shot a photoIndex (0 for photograph 1, 1 for photograph 2, and so on): the shot starts on that photograph and shows only what it shows. Use as many different photographs as there are shots, so each scene has its own angle, and make the final shot from photograph 1 so the video closes on the main one. The one-photograph rules above apply to each shot and its own photograph. When the photographs differ in light or time of day (day, dusk, night), order the shots so the light changes in one direction towards photograph 1, and let the atmosphere of each shot carry that change, so it reads as time passing rather than as a jump.`]
      : ['Set photoIndex to 0 in every shot: there is one photograph.']),
    ...(input.userInstruction
      ? ['businessRequest is what the business itself asked for in this video. Follow it ahead of your own ideas, as far as the rules above about the subject and the photograph allow; where it would break them, keep to the rules and come as close to the request as they permit.']
      : []),
    ...(input.previousAttempt
      ? ['previousAttempt holds your last storyboard and how the motion model changed the subject when it shot it. Propose a calmer concept for the same post: keep the subject still in its photographed place and turn the camera little or not at all; keep a visible camera move in every shot but the close, gentler and slower than before, and let the atmosphere and light carry more of the energy.']
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
              ...[input.photograph, ...(input.extraPhotographs || [])].map((image) => (
                { type: 'input_image', image_url: `data:image/jpeg;base64,${image.toString('base64')}`, detail: 'high' }
              )),
            ],
          }],
          ...aiProviderStructuredRouting(provider.name),
          text: {
            format: {
              type: 'json_schema',
              name: 'video_storyboard',
              strict: true,
              schema: aiProviderJsonSchema(z.toJSONSchema(directorStoryboardSchema)),
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
      const parsed = directorStoryboardSchema.safeParse(JSON.parse(responseText(parseMonthlyProviderResponse(raw))))
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
