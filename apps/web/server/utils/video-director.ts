import { z } from 'zod'
import { channelCanvas, channelUiInsets, ratioLabel, type PublishingChannel } from '../../shared/schemas/channel-format'
import { contentLanguageForLocale, videoDurationSeconds, type AppLocaleValue } from '../../shared/schemas/workspace'
import type { VisualRoute } from '../../shared/schemas/monthly-plan'
import {
  maxSinglePhotoRotationDegrees,
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

// How many scenes a video is told in (VIDEO_MAX_SHOTS, at most
// maxStoryboardShots). One makes it a single continuous take; more tells it in
// separate scenes, each generated on its own from its own photograph and
// joined with a crossfade.
export function videoMaxShots(env: Record<string, string | undefined> = process.env) {
  const configured = configuredSeconds('VIDEO_MAX_SHOTS', env)
  return Math.min(maxStoryboardShots, Math.max(1, Math.floor(configured ?? maxStoryboardShots)))
}

// A video's duration is chosen for the idea from every length the configured
// model actually supports; the optional environment settings are safety caps,
// not a universal target. Told in scenes, the caps bound the whole video and
// each scene lasts one supported length.
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
  const maxShots = videoMaxShots(env)
  // The minimum bounds the whole video; a scene of a longer video may be
  // shorter than it.
  const allowed = supported.filter((value) => (maxShots > 1 || value >= minSeconds) && value <= maxSeconds)
  return {
    durations: supported.length && !allowed.length ? supported : allowed,
    minSeconds: supported.length && !allowed.length ? supported[0]! : Math.min(minSeconds, maxSeconds),
    maxSeconds: supported.length && !allowed.length ? supported.at(-1)! : Math.max(minSeconds, maxSeconds),
    maxShots,
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
  // The verified products the business lists in My business.
  products?: string[]
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
export function directorInstructions(input: Pick<DirectorInput, 'channel' | 'limits' | 'locale' | 'brand' | 'post' | 'previousAttempt' | 'userInstruction' | 'products'>) {
  const { limits } = input
  const durationRule = limits.durations.length
    ? `Choose exactly one duration from ${limits.durations.join(', ')} seconds. These are technical lengths the motion model supports, not creative targets. Choose the shortest duration that lets this exact idea breathe and complete its hook, development, payoff and close without rushing or padding it.`
    : `Choose a whole-number duration between ${limits.minSeconds} and ${limits.maxSeconds} seconds. Choose the shortest duration that completes this exact idea naturally without rushing or padding it.`
  const canvas = channelCanvas(input.channel)
  const covered = channelUiInsets(input.channel)
  const coveredSides = (['top', 'right', 'bottom', 'left'] as const)
    .filter((side) => covered[side] > 0)
    .map((side) => `the ${side} ${Math.round(covered[side] * 100)}%`)
  const coveredRule = coveredSides.length ? ` ${input.channel} covers ${coveredSides.join(', ')} of the frame with its interface, so nothing important happens there.` : ''
  const shape = limits.maxShots === 1 ? null : storyboardShape(limits)
  if (shape && shape.maxShots > 1) return scenesInstructions(input, shape, coveredRule)
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
    sceneDressingRule(input.products || []),
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
      ? ['previousAttempt holds your last continuous take and how the motion model changed the subject. Propose a safer version of the same post: keep the subject still in its photographed place and never let the camera reveal sides or details the photograph does not show. Only the subject is calmed, not the direction: keep one designed, expressive camera path (an arc, crane, reveal or parallax through the scene, not just a push in and out), never a locked, static or tripod frame, and never motion "subtle".']
      : []),
  ].join('\n')
}

/**
 * The director's brief for a video told in separate scenes. The audience,
 * platform, variety and subject rules are the continuous take's; only the
 * shape differs: each scene is generated on its own from its own photograph,
 * so several photographs give the video several real views, joined into one
 * cinematic edit with a crossfade.
 */
function scenesInstructions(
  input: Pick<DirectorInput, 'channel' | 'limits' | 'locale' | 'brand' | 'post' | 'previousAttempt' | 'userInstruction' | 'products'>,
  shape: NonNullable<ReturnType<typeof storyboardShape>>,
  coveredRule: string,
) {
  const { limits } = input
  const canvas = channelCanvas(input.channel)
  const count = shape.minShots === shape.maxShots ? `${shape.minShots}` : `${shape.minShots} to ${shape.maxShots}`
  const lengths = limits.durations.length
    ? `Each scene lasts exactly one of ${limits.durations.join(', ')} seconds, the lengths the motion model renders.`
    : 'Give each scene a whole number of seconds.'
  const photos = limits.photos || 1
  // One photograph is the only view the motion model has of the subject, so
  // big moves away from it make the model invent the subject and change it.
  const singlePhoto = photos === 1
  const maxRotation = singlePhoto ? maxSinglePhotoRotationDegrees : maxStoryboardRotationDegrees
  return [
    'Act as a senior creative director and cinematographer for cinematic short commercial social video. Invent one original concept for this exact business, audience, post and photographs, told as a storyboard of separate scenes the motion model will shoot.',
    `The video is for ${input.channel}, on a ${ratioLabel(canvas)} canvas. Its scenes last ${shape.totalSeconds} seconds together, the full length of the video, told in ${count} separate scenes joined by short crossfades. ${lengths}${coveredRule}`,
    platformVideoDirection(input.channel),
    `Audience direction: the declared audience is ${input.brand.audience}. Use the post intent (${input.post.intent || 'the supplied intent'}), purpose and hook to judge whether this audience is discovering, considering or ready to act. Adapt the pace, visual energy, clarity and call-to-action timing to that state without inferring sensitive personal traits.`,
    'Each scene is generated separately: it opens on its own photograph as a scene of its own and never continues the frame another scene ended on. Give every scene its own camera idea, framing, light or moment, so the video moves through the concept like a cut commercial instead of holding one move.',
    singlePhoto
      ? 'Everything is made from one supplied photograph, the only truthful view of the subject. You may animate plausible light, atmosphere, reflections and natural environmental motion, and move the camera only within what that view supports: a push or pull, lateral slide, parallax, gentle rise or drop, or a very small turn. The subject is already in its photographed place; it never arrives, lands, drives in or transforms. No drone flight, fly-over, impossible reveal or invented reverse angle. Set photoIndex to 0 in every scene.'
      : `You are given ${photos} real photographs of this business, in order; photograph 1 is the main one. They may show the same subject from other angles or other parts of the business (a dish, the room, the product, the place). Give every scene a photoIndex (0 for photograph 1, and so on): the scene starts on that photograph and shows only what that photograph shows. Use every photograph in its own scene, order the scenes so they build one story, and make the final scene from photograph 1 so the video closes on the main one. Within each scene you may move boldly through what its photograph shows: a dolly, crane rise, push through foreground, lateral tracking or parallax reveal.`,
    `Each scene's subject must stay exactly as its own photograph shows it: the same model, colour, shape, logo and details. Show only the photographed side. The camera may turn around it by at most ${maxRotation} degrees in a scene, never orbit, never 360 degrees, and never reveal its back, underside or interior. Set rotationDegrees honestly and showsOnlyPhotographedSides=true only when this holds.`,
    'The final scene must end on the real photograph (endsOnPhotograph=true), so the video closes on the true subject. Mark each scene that opens on its photograph\'s own view with opensOnPhotograph=true.',
    'Edit it like a senior short-form commercial editor. Give every scene a role: scene 1 is the hook (role=hook), the most arresting moment, with a strong camera move that stops the scroll inside its first second; then build scenes (role=build) and a payoff (role=payoff) that reveal the business; the final scene is the close (role=close), settling on the main photograph so the call to action can land. Energy rises towards the payoff and settles in the close.',
    `Every scene except the close moves the camera visibly and with intent. A locked, tripod, static or fixed camera is not a move. ${singlePhoto ? 'Set motion to strong for the hook only, medium for build and payoff, and subtle for the close.' : 'Set motion to strong for the hook, medium or strong for build and payoff, and subtle only for the close.'} Vary the kind of move from scene to scene, and let each move carry into the next the way a motivated cut would.`,
    singlePhoto
      ? 'Give every scene a shotSize of wide, medium or close, never detail: a closer framing than the photograph is a crop the model has to fill with invented detail.'
      : 'Give every scene a shotSize (wide, medium, close or detail) and never give two consecutive scenes the same one, so each scene has its own framing.',
    'Write every scene as a precise cinematographer brief: camera move, lens, startPosition, endPosition, angle, composition, speed and ease; the light and atmosphere; the effects; and what the subject does. No text, letters, logos or captions appear in the generated motion; the application places approved copy afterward.',
    'Set subjectFrame to where the subject spans vertically in photograph 1, as shares of its height from the top (0 is the top edge, 1 the bottom). The application places its headline and call to action in the free space above or below that band, so judge it honestly from the photograph.',
    `Write cta (a short call to action, at most ${ctaMaxLength} characters) and caption in ${contentLanguageForLocale(input.locale)}, in the brand voice, from the supplied post. Do not invent prices, offers, facts or claims.`,
    sceneDressingRule(input.products || []),
    ...(input.post.visualLayout
      ? [`The strategy chose this photograph-specific visual direction for the post: ${input.post.visualLayout}${input.post.visualRoute ? ` Its semantic visual fingerprint is ${JSON.stringify(input.post.visualRoute)}.` : ''} Translate its focal hierarchy, depth, energy and negative-space logic into the scenes, but invent the camera blocking yourself.`]
      : []),
    'Make this concept your own for this post: do not fall back on a generic slow push-in, a generic product orbit or a generic particle-and-glow treatment unless the actual photographs, audience and platform earn it.',
    `Creative-variety challenge for this specific post: ${videoVarietyDirection(input)} Treat it as a compositional challenge, never as permission to break subject fidelity or show an unseen side.`,
    ...(input.userInstruction
      ? ['businessRequest is what the business itself asked for in this video. Follow it ahead of your own ideas, as far as the rules above about the subject and the photographs allow; where it would break them, keep to the rules and come as close to the request as they permit.']
      : []),
    ...(input.previousAttempt
      ? ['previousAttempt holds your last storyboard and how the motion model changed the subject in one of its scenes. Keep the concept and every other scene; make only the scene named in the problem calmer: keep its subject still in its photographed place, turn the camera little or not at all, and keep a visible but gentler camera move.']
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
 * The storyboard for one video, or null when the director gave no valid one.
 * An invalid answer is sent back once with what was wrong with it.
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
        console.warn('The video director could not answer', { attempt: attempt + 1, status: response.status })
        corrections = []
        continue
      }
      const raw = await response.json() as { usage?: { cost?: unknown } }
      if (typeof raw.usage?.cost === 'number' && raw.usage.cost > 0) costUsd += raw.usage.cost
      const parsed = directorStoryboardSchema.safeParse(JSON.parse(responseText(parseMonthlyProviderResponse(raw))))
      if (!parsed.success) {
        corrections = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        console.warn('The video director gave an invalid storyboard', { attempt: attempt + 1, corrections })
        continue
      }
      corrections = storyboardProblems(parsed.data, input.limits)
      if (!corrections.length) return { storyboard: parsed.data, costUsd }
      console.warn('The video director gave an invalid storyboard', { attempt: attempt + 1, corrections })
    } catch (error) {
      console.warn('The video director could not answer', { error: error instanceof Error ? error.message : 'unknown' })
    }
  }
  return { storyboard: null, costUsd }
}
