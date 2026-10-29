import { z } from 'zod'
import { checkPublishedPost } from '../../../utils/published-post-presence'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404 })
  return { removed: await checkPublishedPost(user.id, id.data) }
})
