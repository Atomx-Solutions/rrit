import { z } from 'zod'
import { contentLanguageForLocale, type AppLocaleValue } from '../../shared/schemas/workspace'
import { channelCanvas, ratioLabel } from '../../shared/schemas/channel-format'
import {
  aiProviderConfiguration,
  aiProviderJsonSchema,
  aiProviderModel,
  aiProviderStructuredRouting,
} from './ai-provider'
import { channelFrame, parseMonthlyProviderResponse, REVIEW_MAX_OUTPUT_TOKENS, responseText } from './monthly-ai'
import { qualitySchema } from '../../shared/schemas/monthly-plan'
import type { Storyboard } from '../../shared/schemas/storyboard'
import { normalizeQualityReview } from './post-quality-domain'
import { sceneDressingReview } from './scene-dressing'

const subjectCheckSchema = z.object({
  sameSubject: z.boolean(),
  reason: z.string().max(400),
})

/**
 * Whether a generated clip still shows the photographed subject.
 *
 * A clip in which the subject moves is pinned to the photograph at its start
 * only, so the motion model could have redrawn the subject on the way; frames
 * from the clip are compared with the photograph by the planner's own model.
 * A check that cannot run reports a mismatch: an unverified clip is not
 * delivered as if it had passed.
 */
export async function verifyVideoSubject(input: { photograph: Buffer; frames: Buffer[] }) {
  try {
    const provider = aiProviderConfiguration()
    const image = (bytes: Buffer) => ({
      type: 'input_image',
      image_url: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      detail: 'high',
    })
    const response = await fetch(provider.responsesUrl, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
      headers: provider.headers,
      body: JSON.stringify({
        model: aiProviderModel('AI_PLANNER_MODEL'),
        store: false,
        instructions:
          'The first image is a real photograph. The other images are frames from a video generated from it. Decide whether every frame shows the very same primary subject as the photograph: for a vehicle the same make, model, generation, body style, colour and wheel design; for a product the same product. Camera angle, distance, lighting and position may differ. Answer sameSubject=false if any frame shows a different or altered subject, or if the subject has been replaced. Give a short reason in English. ' + sceneDressingReview,
        max_output_tokens: REVIEW_MAX_OUTPUT_TOKENS,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Photograph, then video frames in order.' },
            image(input.photograph),
            ...input.frames.map(image),
          ],
        }],
        ...aiProviderStructuredRouting(provider.name),
        text: {
          format: {
            type: 'json_schema',
            name: 'video_subject_check',
            strict: true,
            schema: aiProviderJsonSchema(z.toJSONSchema(subjectCheckSchema)),
          },
        },
      }),
    })
    if (!response.ok) return { sameSubject: false, reason: `check_unavailable:${response.status}`, costUsd: 0 }
    const raw = parseMonthlyProviderResponse(await response.json())
    // What the check itself cost, charged with the video.
    return { ...subjectCheckSchema.parse(JSON.parse(responseText(raw))), costUsd: raw.usage.cost ?? 0 }
  } catch (error) {
    return { sameSubject: false, reason: `check_unavailable:${error instanceof Error ? error.message : 'unknown'}`, costUsd: 0 }
  }
}

/**
 * Whether a further photograph the business grouped with a video's main one
 * shows the very same subject from another angle. Checked before any shot is
 * paid for; a check that cannot run reports a mismatch, so an unverified
 * photograph is left out rather than trusted.
 */
export async function verifySamePhotographedSubject(input: { main: Buffer; other: Buffer }) {
  try {
    const provider = aiProviderConfiguration()
    const image = (bytes: Buffer) => ({
      type: 'input_image',
      image_url: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      detail: 'high',
    })
    const response = await fetch(provider.responsesUrl, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
      headers: provider.headers,
      body: JSON.stringify({
        model: aiProviderModel('AI_PLANNER_MODEL'),
        store: false,
        instructions:
          'Both images are real photographs. Decide whether the second shows the very same primary subject as the first, photographed from another angle, distance or side: for a vehicle the same make, model, generation, body style, colour and wheel design; for a product the same product; for a place the same place. A different item of the same kind is not the same subject. Give a short reason in English.',
        max_output_tokens: REVIEW_MAX_OUTPUT_TOKENS,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Main photograph, then the other photograph.' },
            image(input.main),
            image(input.other),
          ],
        }],
        ...aiProviderStructuredRouting(provider.name),
        text: {
          format: {
            type: 'json_schema',
            name: 'photograph_subject_check',
            strict: true,
            schema: aiProviderJsonSchema(z.toJSONSchema(subjectCheckSchema)),
          },
        },
      }),
    })
    if (!response.ok) return { sameSubject: false, reason: `check_unavailable:${response.status}`, costUsd: 0 }
    const raw = parseMonthlyProviderResponse(await response.json())
    return { ...subjectCheckSchema.parse(JSON.parse(responseText(raw))), costUsd: raw.usage.cost ?? 0 }
  } catch (error) {
    return { sameSubject: false, reason: `check_unavailable:${error instanceof Error ? error.message : 'unknown'}`, costUsd: 0 }
  }
}

/** Review frames from the composed MP4, including its overlays. */
export async function reviewVideoQuality(input: {
  photograph: Buffer
  // Further photographs of the same subject the video's other scenes were
  // made from, so their angles are judged against a real photograph too.
  extraPhotographs?: Buffer[]
  frames: Buffer[]
  caption: string
  brandName: string
  locale: AppLocaleValue
  verifiedFacts: string[]
  targetChannel: 'Instagram' | 'Facebook' | 'TikTok'
  // The same commitments a post's still image is reviewed against, plus the
  // concept the video was shot from.
  context?: {
    businessBrain?: string
    guardrails?: string[]
    approvedCopy?: { eyebrow?: string; headline?: string; cta?: string }
    storyboard?: Storyboard
  }
}) {
  const provider = aiProviderConfiguration()
  const context = input.context || {}
  const image = (bytes: Buffer) => ({
    type: 'input_image',
    image_url: `data:image/jpeg;base64,${bytes.toString('base64')}`,
    detail: 'high',
  })
  const response = await fetch(provider.responsesUrl, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(60000),
    headers: provider.headers,
    body: JSON.stringify({
      model: aiProviderModel('AI_PLANNER_MODEL'),
      store: false,
    instructions: `Review the finished ${ratioLabel(channelCanvas(input.targetChannel))} social video for ${input.targetChannel} shown as chronological frames against the original business photograph and the supplied verified facts. The target platform is ${input.targetChannel}; treat Instagram, Facebook and TikTok as equally supported video targets. Evaluate the caption, visible subjects, motion continuity, overlays, legibility, brand fit, source fidelity and platform fit for ${input.targetChannel}. For TikTok, check full-screen composition, first-frame clarity, text kept clear of the interface zones and native short-form presentation. For Instagram and Facebook, check the feed video presentation, first-frame clarity, safe text placement and legibility. Platform fit and subjective visual weaknesses must produce WARN only. Do not assume motion between sampled frames is proven. Set factuality=false only for invented products, people, venue features, offers, unsupported claims or a source photograph mismatch. ${sceneDressingReview} Give specific, actionable reasons in ${contentLanguageForLocale(input.locale)}. Use WARN for subjective weaknesses and BLOCK only for factual or source-evidence failures.${videoReviewAddenda(context)} Return the required structured quality result.`,
      max_output_tokens: REVIEW_MAX_OUTPUT_TOKENS,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: JSON.stringify({ brandName: input.brandName, targetChannel: input.targetChannel, channelFrame: channelFrame(input.targetChannel), caption: input.caption, verifiedFacts: input.verifiedFacts, ...(context.businessBrain ? { businessBrain: context.businessBrain } : {}), ...(context.guardrails?.length ? { restrictions: context.guardrails } : {}), ...(context.approvedCopy ? { approvedCopy: context.approvedCopy } : {}), ...(context.storyboard ? { storyboard: context.storyboard } : {}), imageOrder: [input.extraPhotographs?.length ? `Original owned photographs of the subject (${1 + input.extraPhotographs.length}, the main one first)` : 'Original owned photograph', 'Finished video frames in chronological order'] }) },
          image(input.photograph),
          ...(input.extraPhotographs || []).map(image),
          ...input.frames.map(image),
        ],
      }],
      ...aiProviderStructuredRouting(provider.name),
      text: {
        format: {
          type: 'json_schema',
          name: 'video_quality_review',
          strict: true,
          schema: aiProviderJsonSchema(z.toJSONSchema(qualitySchema)),
        },
      },
    }),
  })
  if (!response.ok)
    throw createError({ statusCode: 503, message: 'server.VIDEO_QA_UNAVAILABLE', data: { providerStatus: response.status } })
  const raw = parseMonthlyProviderResponse(await response.json())
  return {
    quality: normalizeQualityReview(qualitySchema.parse(JSON.parse(responseText(raw)))),
    // What the review itself cost, charged with the video.
    costUsd: raw.usage.cost ?? 0,
  }
}

/**
 * The parts of the review that depend on what is known about this video, in
 * the same terms the image review uses for a post's still.
 */
export function videoReviewAddenda(context: NonNullable<Parameters<typeof reviewVideoQuality>[0]['context']>) {
  return [
    ' channelFrame gives the canvas of the channel and, in coveredByInterface, the share of each side its interface covers; set visualQuality=false with a concise reason when the logo, the headline or the call to action sits inside a covered zone.',
    context.businessBrain
      ? ' businessBrain carries the brand voice, the guardrails and this slot\'s assigned audience and offer; BLOCK when the video or its copy breaks a guardrail or promotes an offer it was not assigned, and WARN when it misses the voice or audience.'
      : '',
    context.guardrails?.length
      ? ' restrictions are absolute prohibitions set by this business; BLOCK when the video breaks any of them.'
      : '',
    context.approvedCopy
      ? ' approvedCopy is the only text the application sets over the motion; set visualQuality=false when any of it is misspelled, clipped, illegible on a phone or laid over the subject, and factuality=false when the video shows any other words that read as a claim.'
      : '',
    context.storyboard
      ? ' storyboard is the concept the video was shot from; WARN with a concrete reason when the result clearly misses its concept or a shot\'s purpose, but never BLOCK for that alone.'
      : '',
  ].join('')
}
