import { z } from 'zod'
import { assetMetadataUpdateSchema } from '../../../../../shared/schemas/workspace-resources'
import { updateWorkspaceAsset } from '../../../../utils/workspace-assets'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  const assetId = z.uuid().safeParse(getRouterParam(event, 'assetId'))
  if (!id.success || !assetId.success)
    throw createError({ statusCode: 404, message: 'Biznesi ose fotografia nuk u gjet.' })
  const input = assetMetadataUpdateSchema.safeParse(await boundedBody(event))
  if (!input.success) throw createError({ statusCode: 422, message: 'Kontrollo metadata-n.' })

  return withBusinessTransaction(user.id, (client, business) => {
    if (business.id !== id.data)
      throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
    return updateWorkspaceAsset(client, {
      businessId: id.data,
      userId: user.id,
      assetId: assetId.data,
      input: input.data,
    })
  })
})
