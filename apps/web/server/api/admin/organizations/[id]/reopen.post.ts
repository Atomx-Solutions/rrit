import { z } from 'zod'
import { reopenOrganization } from '../../../../utils/admin-organization-closure'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  // The superadmin server middleware has already verified the role.
  const actor = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!organizationId.success)
    throw createError({ statusCode: 400, message: 'server.ACTION_INVALID', data: { code: 'INVALID_ACTION' } })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return reopenOrganization({ organizationId: organizationId.data, actor: { id: actor.id, email: actor.email } })
})
