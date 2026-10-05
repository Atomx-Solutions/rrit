import { z } from 'zod'
import { listOrganizationInvitations } from '../../../utils/organization-invitations'

export default defineEventHandler(async (event) => {
  const query = z
    .object({ organization_id: z.uuid().optional() })
    .safeParse(getQuery(event))
  if (!query.success)
    throw createError({
      statusCode: 400,
      message: 'Filtri nuk është i vlefshëm.',
      data: { code: 'INVITATION_QUERY_INVALID' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return listOrganizationInvitations(query.data.organization_id)
})
