import { z } from 'zod'
import { adminSubscriptionActionSchema, changeAdminSubscription } from '../../../../utils/admin-subscriptions'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  // The superadmin server middleware has already verified the role.
  const actor = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'id'))
  const change = adminSubscriptionActionSchema.safeParse(await boundedBody(event, 2048))
  if (!organizationId.success || !change.success)
    throw createError({
      statusCode: 400,
      message: 'server.ACTION_INVALID',
      data: { code: 'INVALID_ACTION' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return changeAdminSubscription({
    organizationId: organizationId.data,
    actor: { id: actor.id, email: actor.email },
    change: change.data,
  })
})
