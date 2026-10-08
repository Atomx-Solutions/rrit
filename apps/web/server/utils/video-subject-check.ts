import { z } from 'zod'
import {
  aiProviderConfiguration,
  aiProviderJsonSchema,
  aiProviderModel,
  aiProviderStructuredRouting,
} from './ai-provider'
import { parseMonthlyProviderResponse, responseText } from './monthly-ai'

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
