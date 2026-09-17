import { z } from 'zod'
import { setHeader } from 'h3'
export default defineEventHandler(async (event) => {
  // Temporary compatibility endpoint. Resource endpoints are preferred.
  if (event.node?.res) {
    setHeader(event, 'Deprecation', 'true')
    setHeader(event, 'X-Rrit-Deprecated', 'Use /bootstrap, /posts and /assets resource endpoints.')
  }
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return withBusinessTransaction(user.id, (client, business) => {
    if (business.id !== id.data) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
    return loadWorkspace(client, id.data, user.id)
  })
})
