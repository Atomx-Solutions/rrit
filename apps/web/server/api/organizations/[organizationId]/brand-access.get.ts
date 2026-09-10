import { z } from 'zod'
import { requireOrganizationManager, withOrganizationTransaction } from '../../../utils/brands'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  if (!organizationId.success) throw createError({ statusCode: 404, message: 'Organizata nuk u gjet.' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return withOrganizationTransaction(user.id, organizationId.data, async (client) => {
    await requireOrganizationManager(client, user.id, organizationId.data)
    const result = await client.query(
      'SELECT organization_id AS "organizationId", brand_id AS "brandId", user_id AS "userId" FROM brand_access WHERE organization_id=$1 ORDER BY brand_id, user_id',
      [organizationId.data],
    )
    return result.rows
  })
})
