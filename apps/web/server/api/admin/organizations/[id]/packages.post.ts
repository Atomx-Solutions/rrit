import { z } from 'zod'
import { createCustomPackage, customPackageCreateSchema } from '../../../../utils/admin-custom-packages'
import { updatePackageRequest } from '../../../../utils/admin-package-requests'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const actor = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'id'))
  const values = customPackageCreateSchema.safeParse(await boundedBody(event, 4096))
  if (!organizationId.success || !values.success)
    throw createError({
      statusCode: 400,
      message: 'server.PACKAGE_VALUES_INVALID',
      data: { code: 'PACKAGE_INVALID' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  const result = await createCustomPackage(organizationId.data, { id: actor.id, email: actor.email }, values.data)
  // Proposal conversion used to require a second browser round-trip just to
  // update the request status. Complete that follow-up on the server while we
  // already have the authenticated admin context.
  if (values.data.package_request_id) {
    await updatePackageRequest(
      values.data.package_request_id,
      { id: actor.id, email: actor.email },
      { status: 'proposal_sent', organizationId: organizationId.data },
    )
  }
  return result
})
