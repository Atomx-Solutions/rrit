import { z } from 'zod'
import { revokeOrganizationInvitation } from '../../../../utils/organization-invitations'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const actor = await requireUser(event)
  const invitationId = z.uuid().safeParse(getRouterParam(event, 'invitationId'))
  if (!invitationId.success)
    throw createError({
      statusCode: 400,
      message: 'server.INVITATION_INVALID',
      data: { code: 'INVITATION_INVALID' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return revokeOrganizationInvitation(invitationId.data, { id: actor.id, email: actor.email })
})
