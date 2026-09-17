import { z } from 'zod'
import { workspaceAssetListQuerySchema } from '../../../../../shared/schemas/workspace-resources'
import { listWorkspaceAssets } from '../../../../utils/workspace-assets'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
  const input = workspaceAssetListQuerySchema.safeParse(getQuery(event))
  if (!input.success) throw createError({ statusCode: 422, message: 'Filtër i pavlefshëm.' })

  const result = await withBusinessTransaction(user.id, (client, business) => {
    if (business.id !== id.data)
      throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
    return listWorkspaceAssets(client, id.data, input.data)
  })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return result
})
