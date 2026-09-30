import { z } from 'zod'
import { deletePackageRequest } from '../../../utils/admin-package-requests'

// The request leaves the inbox, and the audit row written by the database keeps
// what it contained.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  // The superadmin server middleware has already verified the role.
  const actor = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success)
    throw createError({
      statusCode: 404,
      message: 'Kërkesa nuk u gjet.',
      data: { code: 'REQUEST_NOT_FOUND' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return deletePackageRequest(id.data, { id: actor.id, email: actor.email })
})
