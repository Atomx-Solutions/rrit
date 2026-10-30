import { randomUUID } from 'node:crypto'
import { uploadAsset, removeAsset } from '../utils/asset-storage'
import { withOrganizationTransaction } from '../utils/brands'
import {
  FEEDBACK_MAX_BODY_BYTES,
  clientFeedbackSchema,
  feedbackPhotoBytes,
  feedbackPhotoPath,
  throwClientFeedbackFailure,
} from '../utils/client-feedback'

// A client's note to the team. The author comes from the session and the
// organization must be one they belong to; nothing is returned but the id.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const values = clientFeedbackSchema.safeParse(await boundedBody(event, FEEDBACK_MAX_BODY_BYTES))
  if (!values.success)
    throw createError({
      statusCode: 400,
      message: 'server.FEEDBACK_INVALID',
      data: { code: 'FEEDBACK_INVALID' },
    })
  const { organizationId, category, pageUrl, message, photos } = values.data
  const photoBytes = photos.map(feedbackPhotoBytes)
  setHeader(event, 'Cache-Control', 'private, no-store')

  return withOrganizationTransaction(user.id, organizationId, async (client) => {
    const key = randomUUID()
    const paths = photoBytes.map((_, index) => feedbackPhotoPath(organizationId, key, index))
    await Promise.all(paths.map((path, index) => uploadAsset(path, photoBytes[index]!)))
    try {
      const result = await client.query<{ submit_client_feedback: string }>(
        'SELECT submit_client_feedback($1,$2,$3,$4,$5,$6)',
        [organizationId, user.id, category, pageUrl, message, paths],
      )
      return { id: result.rows[0]!.submit_client_feedback }
    } catch (error) {
      // Photos without a row would linger in storage forever.
      await Promise.all(paths.map((path) => removeAsset(path).catch(() => undefined)))
      throwClientFeedbackFailure(error instanceof Error ? error.message : String(error ?? ''))
      throw error
    }
  })
})
