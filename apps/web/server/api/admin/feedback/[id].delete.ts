import { z } from 'zod'
import { deleteClientFeedback } from '../../../utils/client-feedback'

// Deleting removes the row and its photos, so handled feedback leaves nothing
// behind but the audit entry.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  // The superadmin server middleware has already verified the role.
  const actor = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success)
    throw createError({
      statusCode: 404,
      message: 'server.FEEDBACK_NOT_FOUND',
      data: { code: 'FEEDBACK_NOT_FOUND' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return deleteClientFeedback(id.data, { id: actor.id, email: actor.email })
})
