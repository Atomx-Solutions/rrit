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
  const email = values.data.email.trim().toLowerCase()
  const existing = await adminServiceClient().auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (existing.error) {
    console.error('Admin invitation account lookup failed.', { code: existing.error.code, message: existing.error.message })
    throw createError({ statusCode: 502, message: 'server.INVITATION_ACCOUNT_LOOKUP_FAILED' })
  }
  if (existing.data.users.some(user => user.email?.toLowerCase() === email)) {
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
