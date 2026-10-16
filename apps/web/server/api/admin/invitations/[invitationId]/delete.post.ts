import { z } from 'zod'
import { deleteOrganizationInvitation } from '../../../../utils/organization-invitations'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const actor = await requireUser(event)
  const invitationId = z.uuid().safeParse(getRouterParam(event, 'invitationId'))
  if (!invitationId.success) throw createError({ statusCode: 400, message: 'server.INVITATION_INVALID' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return deleteOrganizationInvitation(invitationId.data, { id: actor.id, email: actor.email })
})
