import { z } from 'zod'
import { recordAuditEvent, transitionMetadata } from '../../../utils/audit'
import { requireOrganizationManager, withOrganizationTransaction } from '../../../utils/brands'

const schema = z.object({
  userId: z.uuid(),
  brandId: z.uuid(),
  enabled: z.boolean(),
})

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  if (!organizationId.success) throw createError({ statusCode: 404, message: 'Organizata nuk u gjet.' })
  const parsed = schema.safeParse(await boundedBody(event, 4096))
  if (!parsed.success) throw createError({ statusCode: 422, message: 'Qasja e brandit nuk është valide.' })
  try {
    return await withOrganizationTransaction(user.id, organizationId.data, async (client) => {
      await requireOrganizationManager(client, user.id, organizationId.data)
      const changed = parsed.data.enabled
        ? Boolean((await client.query(
          'INSERT INTO brand_access (organization_id,brand_id,user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [organizationId.data, parsed.data.brandId, parsed.data.userId],
        )).rowCount)
        : Boolean((await client.query(
          'DELETE FROM brand_access WHERE organization_id=$1 AND brand_id=$2 AND user_id=$3',
          [organizationId.data, parsed.data.brandId, parsed.data.userId],
        )).rowCount)
      if (changed)
        await recordAuditEvent(client, {
          actorId: user.id,
          organizationId: organizationId.data,
          resourceType: 'brand_access',
          resourceId: `${parsed.data.brandId}:${parsed.data.userId}`,
          action: parsed.data.enabled ? 'brand_access.granted' : 'brand_access.revoked',
          metadata: transitionMetadata({ enabled: [!parsed.data.enabled, parsed.data.enabled] }),
        })
      return { organizationId: organizationId.data, ...parsed.data }
    })
  } catch (error) {
    if ((error as { code?: string }).code === '23503')
      throw createError({ statusCode: 404, message: 'Brandi ose anëtari nuk u gjet.' })
    throw error
  }
})
