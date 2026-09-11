import { z } from 'zod'
import { updateFactSchema } from '../../../../../../../shared/schemas/business-brain'
import { recordAuditEvent } from '../../../../../../utils/audit'
import { updateExplicitFact } from '../../../../../../utils/business-brain'
import { withOrganizationTransaction } from '../../../../../../utils/brands'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  const brandId = z.uuid().safeParse(getRouterParam(event, 'brandId'))
  const factId = z.uuid().safeParse(getRouterParam(event, 'factId'))
  if (!organizationId.success || !brandId.success || !factId.success) throw createError({ statusCode: 404, message: 'Fakti nuk u gjet.' })
  const parsed = updateFactSchema.safeParse(await boundedBody(event, 8192))
  if (!parsed.success) throw createError({ statusCode: 422, message: 'Fakti nuk eshte valid.' })
  return withOrganizationTransaction(user.id, organizationId.data, async (client) => {
    const fact = await updateExplicitFact(client, organizationId.data, brandId.data, factId.data, parsed.data)
    await recordAuditEvent(client, {
      actorId: user.id,
      organizationId: organizationId.data,
      resourceType: 'business_brain_fact',
      resourceId: fact.id,
      action: 'business_brain_fact.updated',
      metadata: { version: fact.version },
    })
    return fact
  })
})
