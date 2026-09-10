import { z } from 'zod'
import { listBrands, withOrganizationTransaction } from '../../../../utils/brands'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  if (!organizationId.success) throw createError({ statusCode: 404, message: 'Organizata nuk u gjet.' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return withOrganizationTransaction(user.id, organizationId.data, (client) =>
    listBrands(client, organizationId.data),
  )
})
