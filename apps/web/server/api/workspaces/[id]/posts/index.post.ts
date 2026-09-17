import { z } from 'zod'
import { postCreateSchema } from '../../../../../shared/schemas/workspace-resources'
import { createWorkspacePost } from '../../../../utils/workspace-posts'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
  const input = postCreateSchema.safeParse(await boundedBody(event))
  if (!input.success)
    throw createError({ statusCode: 422, message: 'Kontrollo fushat e postimit.' })

  return withBusinessTransaction(user.id, (client, business) => {
    if (business.id !== id.data)
      throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
    return createWorkspacePost(client, {
      businessId: id.data,
      userId: user.id,
      input: input.data,
    })
  })
})
