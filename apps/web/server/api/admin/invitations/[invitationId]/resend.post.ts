import { z } from 'zod'
import {
  invitationResendSchema,
  resendOrganizationInvitation,
} from '../../../../utils/organization-invitations'

// A resend issues a new token and the previous link stops working.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const actor = await requireUser(event)
  const invitationId = z.uuid().safeParse(getRouterParam(event, 'invitationId'))
  const values = invitationResendSchema.safeParse(await boundedBody(event, 1024))
  if (!invitationId.success || !values.success)
    throw createError({
      statusCode: 400,
      message: 'server.INVITATION_DATA_INVALID',
      data: { code: 'INVITATION_INVALID' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return resendOrganizationInvitation(
    invitationId.data,
    { id: actor.id, email: actor.email },
    values.data,
  )
})
