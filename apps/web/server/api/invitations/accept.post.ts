import {
  acceptInvitation,
  invitationTokenBodySchema,
} from '../../utils/organization-invitations'

// Binds the signed-in user to the organization the superadmin opened for them.
// The business row is created with that organization's id, so the package and
// invoice already attached to it are visible on the first dashboard load.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const body = invitationTokenBodySchema.safeParse(await boundedBody(event, 1024))
  if (!body.success)
    throw createError({
      statusCode: 400,
      message: 'Ftesa nuk është e vlefshme.',
      data: { code: 'INVITATION_INVALID' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return acceptInvitation(user, body.data.token, event)
})
