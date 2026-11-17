import { z } from 'zod'
import { adminCloseOrganizationSchema, closeOrganization } from '../../../../utils/admin-organization-closure'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  // The superadmin server middleware has already verified the role.
  const actor = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'id'))
  const body = adminCloseOrganizationSchema.safeParse(await boundedBody(event, 2048))
  if (!organizationId.success || !body.success)
    throw createError({ statusCode: 400, message: 'server.CLOSE_REASON_REQUIRED', data: { code: 'CLOSE_REASON_REQUIRED' } })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return closeOrganization({
    organizationId: organizationId.data,
    actor: { id: actor.id, email: actor.email },
    reason: body.data.reason,
  })
})
