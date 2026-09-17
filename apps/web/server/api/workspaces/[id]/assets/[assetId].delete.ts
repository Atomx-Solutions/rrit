import { z } from 'zod'
import { assetDeleteSchema } from '../../../../../shared/schemas/workspace-resources'
import { removeAsset } from '../../../../utils/asset-storage'
import { deleteWorkspaceAsset } from '../../../../utils/workspace-assets'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  const assetId = z.uuid().safeParse(getRouterParam(event, 'assetId'))
  if (!id.success || !assetId.success)
    throw createError({ statusCode: 404, message: 'Biznesi ose fotografia nuk u gjet.' })
  const input = assetDeleteSchema.safeParse(await boundedBody(event, 1024))
  if (!input.success) throw createError({ statusCode: 422, message: 'Kontrollo revision-in.' })

  const result = await withBusinessTransaction(user.id, (client, business) => {
    if (business.id !== id.data)
      throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
    return deleteWorkspaceAsset(client, {
      businessId: id.data,
      userId: user.id,
      assetId: assetId.data,
      workspaceRevision: input.data.workspaceRevision,
    })
  })
  if (result.storagePath) {
    try {
      await removeAsset(result.storagePath)
    } catch (error) {
      console.error('Failed to remove deleted asset from storage', {
        storagePath: result.storagePath,
        error,
      })
    }
  }
  const { storagePath: _storagePath, ...response } = result
  return response
})
