import { z } from 'zod'
import { loadWorkspaceBootstrap } from '../../../utils/workspaces'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return withBusinessTransaction(user.id, (client, business) => {
    if (business.id !== id.data)
      throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
    return loadWorkspaceBootstrap(client, id.data, user.id)
  })
})
