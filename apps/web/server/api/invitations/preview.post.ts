import {
  invitationTokenBodySchema,
  previewInvitation,
} from '../../utils/organization-invitations'

// The join page asks what an invitation is for before the visitor has an
// account. The token travels in the body so it never reaches an access log.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const body = invitationTokenBodySchema.safeParse(await boundedBody(event, 1024))
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (!body.success) return { valid: false as const }
  return previewInvitation(body.data.token)
})
