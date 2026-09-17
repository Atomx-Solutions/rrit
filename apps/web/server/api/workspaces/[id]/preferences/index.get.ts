import { z } from 'zod'
import { getWorkspacePreferences } from '../../../../utils/workspace-preferences'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })

  const result = await withBusinessTransaction(user.id, (client, business) => {
    if (business.id !== id.data)
      throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
    return getWorkspacePreferences(client, {
      businessId: id.data,
      userId: user.id,
      slug: business.slug,
    })
  })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return result
})
