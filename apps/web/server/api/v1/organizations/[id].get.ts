import { z } from 'zod'
import { getOrganizationForUser } from '../../../utils/organizations'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'Organizata nuk u gjet.' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return await getOrganizationForUser(user.id, id.data)
})
