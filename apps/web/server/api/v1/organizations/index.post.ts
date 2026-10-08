import { organizationCreateSchema } from '../../../../shared/schemas/organization'
import { createOrganizationForUser } from '../../../utils/organizations'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const parsed = organizationCreateSchema.safeParse(await boundedBody(event, 4096))
  if (!parsed.success)
    throw createError({ statusCode: 422, message: 'server.ORGANIZATION_NAME_SLUG_REQUIRED' })
  const organization = await createOrganizationForUser(user.id, parsed.data)
  setResponseStatus(event, 201)
  return organization
})
