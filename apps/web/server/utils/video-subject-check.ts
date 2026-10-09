import { z } from 'zod'
import {
  aiProviderConfiguration,
  aiProviderJsonSchema,
  aiProviderModel,
  aiProviderStructuredRouting,
} from './ai-provider'
import { parseMonthlyProviderResponse, responseText } from './monthly-ai'
import { qualitySchema } from '../../shared/schemas/monthly-plan'
import { normalizeQualityReview } from './post-quality-domain'

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
          'The first image is a real photograph. The other images are frames from a video generated from it. Decide whether every frame shows the very same primary subject as the photograph: for a vehicle the same make, model, generation, body style, colour and wheel design; for a product the same product. Camera angle, distance, lighting and position may differ. Answer sameSubject=false if any frame shows a different or altered subject, or if the subject has been replaced. Give a short reason in English.',
        max_output_tokens: 300,
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
    if (!response.ok) return { sameSubject: false, reason: `check_unavailable:${response.status}` }
    return subjectCheckSchema.parse(JSON.parse(responseText(parseMonthlyProviderResponse(await response.json()))))
  } catch (error) {
    return { sameSubject: false, reason: `check_unavailable:${error instanceof Error ? error.message : 'unknown'}` }
  }
}

/** Review frames from the composed MP4, including its overlays and end card. */
export async function reviewVideoQuality(input: {
  photograph: Buffer
  frames: Buffer[]
  caption: string
  brandName: string
  locale: 'sq-XK' | 'en-US' | 'de-DE'
  verifiedFacts: string[]
  targetChannel: 'Instagram' | 'Facebook' | 'TikTok'
}) {
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
    instructions: `Review the finished vertical social video shown as chronological frames against the original business photograph and the supplied verified facts. The target platform is ${input.targetChannel}; treat Instagram, Facebook and TikTok as equally supported video targets. Evaluate the caption, visible subjects, motion continuity, overlays, legibility, brand fit, source fidelity, end card, and platform fit for ${input.targetChannel}. For TikTok, check vertical full-screen composition, first-frame clarity, safe text placement and native short-form presentation. For Instagram and Facebook, check the vertical Reel/video presentation, first-frame clarity, safe text placement and legibility. Platform fit and subjective visual weaknesses must produce WARN only. Do not assume motion between sampled frames is proven. Set factuality=false only for invented products, people, venue features, offers, unsupported claims or a source photograph mismatch. Give specific, actionable reasons in ${input.locale === 'de-DE' ? 'German' : input.locale === 'en-US' ? 'English' : 'Albanian'}. Use WARN for subjective weaknesses and BLOCK only for factual or source-evidence failures. Return the required structured quality result.`,
      max_output_tokens: 1200,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: JSON.stringify({ brandName: input.brandName, targetChannel: input.targetChannel, caption: input.caption, verifiedFacts: input.verifiedFacts, imageOrder: ['Original owned photograph', 'Finished video frames in chronological order'] }) },
          image(input.photograph),
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
  return normalizeQualityReview(qualitySchema.parse(JSON.parse(responseText(parseMonthlyProviderResponse(await response.json())))))
}
