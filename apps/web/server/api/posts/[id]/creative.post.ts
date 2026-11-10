import { z } from 'zod'
import { queueImageEdit } from '../../../utils/image-edit-queue'
import { startImageEditNow } from '../../../utils/planner-run'

// Edit the photo with AI: the edit is queued and made by a planner run, so only
// as many run at once as the queue allows; the editor follows its status.
export default defineEventHandler(async (event) => {
  const started = Date.now()
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  const input = z.object({
    action: z.literal('ai-edit'),
    contentVersion: z.number().int().positive(),
    instruction: z.string().trim().min(5).max(1200),
  }).safeParse(await boundedBody(event, 4096))
  if (!id.success || !input.success)
    throw createError({ statusCode: 422, message: 'server.DESIGN_DESCRIPTION_REQUIRED' })
  const queued = await queueImageEdit(user.id, id.data, input.data)
  startImageEditNow(event, started)
  setResponseStatus(event, 202)
  return queued
})
