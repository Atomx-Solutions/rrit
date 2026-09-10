import { z } from 'zod'
import { getBrand, withOrganizationTransaction } from '../../../../utils/brands'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  const brandId = z.uuid().safeParse(getRouterParam(event, 'brandId'))
  if (!organizationId.success || !brandId.success)
    throw createError({ statusCode: 404, message: 'Brandi nuk u gjet.' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return withOrganizationTransaction(user.id, organizationId.data, (client) =>
    getBrand(client, organizationId.data, brandId.data),
  )
})
