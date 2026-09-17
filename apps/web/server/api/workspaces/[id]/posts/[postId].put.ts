import { z } from 'zod'
import { postUpdateSchema } from '../../../../../shared/schemas/workspace-resources'
import { updateWorkspacePost } from '../../../../utils/workspace-posts'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  const postId = z.uuid().safeParse(getRouterParam(event, 'postId'))
  if (!id.success || !postId.success)
    throw createError({ statusCode: 404, message: 'Biznesi ose postimi nuk u gjet.' })
  const input = postUpdateSchema.safeParse(await boundedBody(event))
  if (!input.success)
    throw createError({ statusCode: 422, message: 'Kontrollo fushat e postimit.' })

  return withBusinessTransaction(user.id, (client, business) => {
    if (business.id !== id.data)
      throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
    return updateWorkspacePost(client, {
      businessId: id.data,
      userId: user.id,
      postId: postId.data,
      input: input.data,
    })
  })
})
