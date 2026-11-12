import { z } from 'zod'
import { channelCanvas, channelUiInsets, ratioLabel, type PublishingChannel } from '../../shared/schemas/channel-format'
import { contentLanguageForLocale, videoDurationSeconds, type AppLocaleValue } from '../../shared/schemas/workspace'
import type { VisualRoute } from '../../shared/schemas/monthly-plan'
import {
  maxSinglePhotoRotationDegrees,
  storyboardProblems,
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
import { sceneDressingRule } from './scene-dressing'
import { sendWithRateLimitRetry } from './provider-rate-limit'

function seconds(variable: string, fallback: number) {
  const value = Number(process.env[variable])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function configuredSeconds(variable: string, env: Record<string, string | undefined>) {
  const value = Number(env[variable])
  return Number.isFinite(value) && value > 0 ? value : undefined
}

// A delivered video is one continuous generated take. Its duration is chosen
// for the idea from every length the configured model actually supports; the
// optional environment settings are safety caps, not a universal target.
export function videoLengthLimits(durations: number[], env: Record<string, string | undefined> = process.env): StoryboardLimits {
  // When the provider catalogue is temporarily unavailable, retain the proven
  // legacy length rather than asking the provider for an invented duration.
  const supported = [...new Set(durations.length ? durations : [videoDurationSeconds])]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b)
  const configuredMin = configuredSeconds('VIDEO_MIN_SECONDS', env)
  const configuredMax = configuredSeconds('VIDEO_MAX_SECONDS', env)
  const minSeconds = configuredMin ?? supported[0] ?? 1
  const maxSeconds = configuredMax ?? supported.at(-1) ?? 30
  const allowed = supported.filter((value) => value >= minSeconds && value <= maxSeconds)
  return {
    durations: supported.length && !allowed.length ? supported : allowed,
    minSeconds: supported.length && !allowed.length ? supported[0]! : Math.min(minSeconds, maxSeconds),
    maxSeconds: supported.length && !allowed.length ? supported.at(-1)! : Math.max(minSeconds, maxSeconds),
    maxShots: 1,
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
    // The strategy's photograph-specific still direction. It is context for
    // the concept, never a prescribed camera move.
    assetDirection?: string
    visualLayout?: string
    visualRoute?: VisualRoute
  }
  // Set when the last concept changed the subject once it was generated: the
  // director is asked for a calmer one.
  previousAttempt?: { storyboard: Storyboard | null; problem: string }
  // What the business asked for in Edit video with AI, in its own words.
  userInstruction?: string
}

const videoVarietyChallenges = [
  'Build depth with a motivated foreground reveal: begin with a real near-frame layer when the photograph contains one, then clear it with lateral parallax so the subject earns the reveal. If no honest foreground layer exists, create depth with light and a restrained lateral move instead of inventing an object.',
  'Use a low-to-eye-level progression: let the hook gain presence from a safe low position, then resolve at a natural viewing height. Keep verticals credible and never use a low angle that hides or fabricates defining subject details.',
  'Use lateral visual tension rather than a central push-in: begin off-axis, travel across the frame on one motivated vector, and settle into balanced negative space for the close. Preserve the photographed side of the subject throughout.',
  'Use scale contrast through framing and lens character: compress the hook into a clean close or medium reading, open the build into environmental context, and return to the true photograph for the close. Do not manufacture macro detail the source cannot support.',
  'Let light lead the motion: use a visible but measured camera path while changing reflections, shadow or atmosphere across depth planes. The light change must reveal the real subject, not become a generic glow, flare or transition effect.',
  'Use a diagonal depth path: stage foreground, subject and background on a clear diagonal and move along or across that line, then settle the eye on the subject. Avoid a dutch angle unless the photograph and brand genuinely support that energy.',
] as const

// Stable for one post (so retries remain coherent), but varied across different
// posts and businesses. It is a creative constraint, not a reusable shot list.
export function videoVarietyDirection(input: Pick<DirectorInput, 'channel' | 'brand' | 'post'>) {
  const seed = [
    input.channel,
    input.brand.name,
    input.post.title,
    input.post.hook,
    input.post.intent,
    input.post.visualLayout,
  ].filter(Boolean).join('|')
  let hash = 2166136261
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return videoVarietyChallenges[(hash >>> 0) % videoVarietyChallenges.length]!
}

function platformVideoDirection(channel: PublishingChannel) {
  if (channel === 'TikTok')
    return 'TikTok direction: make the first 0.5 second visually legible without sound, use an immediate native-feeling hook and continuous forward momentum, keep the result human and observational rather than like a polished television commercial, and keep all important detail clear of TikTok interface zones.'
  if (channel === 'Instagram')
    return 'Instagram direction: make the opening frame work as a refined feed cover, reward close mobile viewing with controlled depth and premium detail, build one elegant visual progression worth saving or sharing, and keep the composition clean enough to remain recognizable when seen small in the feed.'
  return 'Facebook direction: establish the real business context immediately, use a calmer and highly legible progression that works without sound, keep the subject and message understandable at a glance in the feed, and favour trustworthy naturalism over trend-heavy effects.'
}

/**
 * The creative director's brief. It states who the video is for and the rules
 * a single photograph imposes, and nothing about what the video should be:
 * the concept, continuous take and every camera choice are the model's to invent for
 * this post.
 */
export function directorInstructions(input: Pick<DirectorInput, 'channel' | 'limits' | 'locale' | 'brand' | 'post' | 'previousAttempt' | 'userInstruction'>) {
  const { limits } = input
  const durationRule = limits.durations.length
    ? `Choose exactly one duration from ${limits.durations.join(', ')} seconds. These are technical lengths the motion model supports, not creative targets. Choose the shortest duration that lets this exact idea breathe and complete its hook, development, payoff and close without rushing or padding it.`
    : `Choose a whole-number duration between ${limits.minSeconds} and ${limits.maxSeconds} seconds. Choose the shortest duration that completes this exact idea naturally without rushing or padding it.`
  const canvas = channelCanvas(input.channel)
  const covered = channelUiInsets(input.channel)
  const coveredSides = (['top', 'right', 'bottom', 'left'] as const)
    .filter((side) => covered[side] > 0)
    .map((side) => `the ${side} ${Math.round(covered[side] * 100)}%`)
  return [
    'Act as a senior creative director and cinematographer for realistic short commercial social video. Invent one original concept for this exact business, audience, post and photograph.',
    `The deliverable is one continuous generated take for ${input.channel}, on a ${ratioLabel(canvas)} canvas: exactly one shot, no cuts, no stitched scenes, no montage, no end card and no transition to another location. One coherent camera path carries the hook, development, payoff and close inside the same real moment. ${durationRule}${coveredSides.length ? ` ${input.channel} covers ${coveredSides.join(', ')} of the frame with its interface, so nothing important happens there.` : ''}`,
    platformVideoDirection(input.channel),
    `Audience direction: the declared audience is ${input.brand.audience}. Use the post intent (${input.post.intent || 'the supplied intent'}), purpose and hook to judge whether this audience is discovering, considering or ready to act. Adapt the pace, duration, visual energy, clarity and call-to-action timing to that state without inferring sensitive personal traits. A discovery idea earns a faster visual hook; a consideration or trust idea earns more observation and context; an action idea earns a concise path to the close.`,
    'Use photograph 1 as the sole motion source and set photoIndex=0. Any further supplied photographs are reference evidence for identity only; do not cut to them or turn them into separate scenes. The continuous shot starts on the supplied real photograph (opensOnPhotograph=true) and ends on that same real photograph (endsOnPhotograph=true).',
    'The photograph is the only truthful view of the subject. You may animate plausible light, atmosphere, reflections and natural environmental motion, and move the camera only within what that view supports: a restrained push or pull, lateral slide, parallax, gentle rise or drop, or a very small turn. The subject is already in its photographed place; it never arrives, lands, drives in or transforms. No drone flight, fly-over, impossible reveal or invented reverse angle.',
    `The subject must stay exactly the photographed subject: the same model, colour, shape, logo, wheels and details. Show only the photographed side. The camera may turn around it by at most ${maxSinglePhotoRotationDegrees} degrees, never orbit, never 360 degrees, and never reveal its back, underside or interior. Set rotationDegrees honestly and showsOnlyPhotographedSides=true only when this holds.`,
    'Return exactly one shot with role=continuous. Write it as a precise cinematographer brief: one motivated camera path, lens, startPosition, endPosition, angle, composition, speed and ease; the evolving light and atmosphere; and physically plausible subject motion. Use a wide, medium or close shotSize, never a synthetic macro detail. No text, letters, logos or captions appear in the generated motion; the application places approved copy afterward.',
    'Set subjectFrame to where the subject spans vertically in the supplied photograph, as shares of its height from the top (0 is the top edge, 1 the bottom). The application places its headline and call to action in the free space above or below that band, so judge it honestly from the photograph.',
    `Write cta (a short call to action, at most ${ctaMaxLength} characters) and caption in ${contentLanguageForLocale(input.locale)}, in the brand voice, from the supplied post. Do not invent prices, offers, facts or claims.`,
    `${sceneDressingRule} Plan such props where they make the scene feel alive and in use.`,
    ...(input.post.visualLayout
      ? [`The strategy chose this photograph-specific visual direction for the post: ${input.post.visualLayout}${input.post.visualRoute ? ` Its semantic visual fingerprint is ${JSON.stringify(input.post.visualRoute)}.` : ''} Translate its focal hierarchy, depth, energy and negative-space logic into a natural continuous take, but invent the camera blocking yourself and never turn the video into an animated static template.`]
      : []),
    'Make this concept your own for this post: do not fall back on a generic slow push-in, a generic product orbit or a generic particle-and-glow treatment unless the actual photograph, audience and platform earn it.',
    `Creative-variety challenge for this specific post: ${videoVarietyDirection(input)} Treat it as a compositional challenge, never as permission to break subject fidelity or show an unseen side.`,
    'Shape the single take like a senior short-form editor without cuts: an arresting but credible first movement, a readable middle that reveals useful context, a payoff, then a gentle settle back onto the truthful frame for the call to action. Motion strength may evolve inside the shot; avoid arbitrary whip pans, crash zooms, speed ramps, glitches, fake handheld shake and effect-heavy spectacle.',
    'Block the camera precisely. startPosition and endPosition are concrete places relative to the photographed subject and depth planes; angle and composition are honest. Use foreground, midground and background only when they exist or can be extended without inventing facts. Keep the subject away from interface-covered edges and preserve deliberate negative space for overlays.',
    ...(input.userInstruction
      ? ['businessRequest is what the business itself asked for in this video. Follow it ahead of your own ideas, as far as the rules above about the subject and the photograph allow; where it would break them, keep to the rules and come as close to the request as they permit.']
      : []),
    ...(input.previousAttempt
      ? ['previousAttempt holds your last continuous take and how the motion model changed the subject. Propose a calmer version of the same post: keep the subject still in its photographed place, reduce camera travel and rotation, and let truthful light and atmosphere carry more of the energy.']
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
      const response = await sendWithRateLimitRetry(() => fetch(provider.responsesUrl, {
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
      }))
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
