import {
  createOrganizationInvitation,
  invitationCreateSchema,
} from '../../../utils/organization-invitations'
import { adminServiceClient } from '../../../utils/admin-supabase'
import { updatePackageRequest } from '../../../utils/admin-package-requests'

// Invites a client who has no account yet. The organization, and any package
// proposed with the invitation, open only when the client signs up.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const actor = await requireUser(event)
  const values = invitationCreateSchema.safeParse(await boundedBody(event, 8192))
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
  const created = await createOrganizationInvitation({ id: actor.id, email: actor.email }, values.data)
  // A lead answered with a proposal moves on, as it does when the package is
  // attached to an existing organization.
  if (values.data.package && values.data.package_request_id)
    await updatePackageRequest(values.data.package_request_id, { id: actor.id, email: actor.email }, { status: 'proposal_sent' })
  return created
})
