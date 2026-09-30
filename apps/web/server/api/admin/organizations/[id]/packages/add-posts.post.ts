import { z } from 'zod'
import {
  addPostsToActiveCustomPackage,
  customPackagePostAdditionSchema,
} from '../../../../../utils/admin-custom-packages'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const actor = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'id'))
  const body = customPackagePostAdditionSchema.safeParse(await boundedBody(event, 256))
  if (!organizationId.success || !body.success)
    throw createError({ statusCode: 400, message: 'Vlerat e paketÃ«s nuk janÃ« tÃ« vlefshme.' })

  setHeader(event, 'Cache-Control', 'private, no-store')
  return addPostsToActiveCustomPackage(
    organizationId.data,
    { id: actor.id, email: actor.email },
    body.data.posts_to_add,
  )
})
