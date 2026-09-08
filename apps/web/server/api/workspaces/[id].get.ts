import { z } from 'zod'
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return loadWorkspace(database(), id.data, user.id)
})
