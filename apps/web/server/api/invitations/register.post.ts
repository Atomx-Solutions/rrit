import {
  invitationRegisterSchema,
  registerInvitedClient,
} from '../../utils/organization-invitations'

// Creates the invited client's account with the address already confirmed, so
// the invitation finishes in one step. Only an address that holds a valid
// pending invitation can be registered this way; everyone else goes through the
// normal sign-up, which still verifies by email.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const body = invitationRegisterSchema.safeParse(await boundedBody(event, 2048))
  if (!body.success)
    throw createError({
      statusCode: 422,
      message: 'server.NAME_OR_PASSWORD_INVALID',
      data: { code: 'PASSWORD_WEAK' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  const { email } = await registerInvitedClient(body.data)
  setResponseStatus(event, 201)
  return { email }
})
