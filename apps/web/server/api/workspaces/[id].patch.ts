import { z } from 'zod'
import { workspaceMetadataUpdateSchema } from '../../../shared/schemas/workspace-resources'
import { updateWorkspaceMetadata } from '../../utils/workspace-metadata'
import { withBusinessTransaction } from '../../utils/meta'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
  const parsed = workspaceMetadataUpdateSchema.safeParse(await boundedBody(event, 64 * 1024))
  if (!parsed.success) throw createError({ statusCode: 422, message: 'Metadata e pavlefshme.' })
  return withBusinessTransaction(user.id, async (client, business) => {
    if (business.id !== id.data) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
    return updateWorkspaceMetadata(client, { businessId: id.data, userId: user.id, input: parsed.data })
  })
})
