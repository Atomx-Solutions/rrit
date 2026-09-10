import { z } from 'zod'
import { organizationUpdateSchema } from '../../../../shared/schemas/organization'
import { updateOrganizationForUser } from '../../../utils/organizations'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'Organizata nuk u gjet.' })
  const parsed = organizationUpdateSchema.safeParse(await boundedBody(event, 4096))
  if (!parsed.success)
    throw createError({ statusCode: 422, message: 'Kontrollo fushat e organizatës.' })
  return await updateOrganizationForUser(user.id, id.data, parsed.data)
})
