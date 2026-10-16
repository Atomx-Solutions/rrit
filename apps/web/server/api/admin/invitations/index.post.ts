import {
  createOrganizationInvitation,
  invitationCreateSchema,
} from '../../../utils/organization-invitations'
import { adminServiceClient } from '../../../utils/admin-supabase'

// Opens an organization for a client who has no account yet. The superadmin can
// attach the agreed package to it before the invitation is ever accepted.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const actor = await requireUser(event)
  const values = invitationCreateSchema.safeParse(await boundedBody(event, 4096))
  if (!values.success)
    throw createError({
      statusCode: 400,
      message: 'server.INVITATION_DATA_INVALID',
      data: { code: 'INVITATION_INVALID' },
    })
  const existing = await adminServiceClient().auth.admin.getUserByEmail(values.data.email.trim().toLowerCase())
  if (existing.data.user) {
    throw createError({
      statusCode: 409,
      message: 'server.INVITATION_ACCOUNT_EXISTS',
      data: { code: 'INVITATION_ACCOUNT_EXISTS' },
    })
  }
  setHeader(event, 'Cache-Control', 'private, no-store')
  setResponseStatus(event, 201)
  return createOrganizationInvitation({ id: actor.id, email: actor.email }, values.data)
})
