import { z } from 'zod'
import { createFactSchema } from '../../../../../../../shared/schemas/business-brain'
import { recordAuditEvent } from '../../../../../../utils/audit'
import { createBusinessBrainFact } from '../../../../../../utils/business-brain'
import { withOrganizationTransaction } from '../../../../../../utils/brands'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  const brandId = z.uuid().safeParse(getRouterParam(event, 'brandId'))
  if (!organizationId.success || !brandId.success) throw createError({ statusCode: 404, message: 'server.BRAND_NOT_FOUND' })
  const parsed = createFactSchema.safeParse(await boundedBody(event, 8192))
  if (!parsed.success) throw createError({ statusCode: 422, message: 'server.FACT_INVALID' })
  return withOrganizationTransaction(user.id, organizationId.data, async (client) => {
    const fact = await createBusinessBrainFact(client, organizationId.data, brandId.data, parsed.data)
    await recordAuditEvent(client, {
      actorId: user.id,
      organizationId: organizationId.data,
      resourceType: 'business_brain_fact',
      resourceId: fact.id,
      action: 'business_brain_fact.created',
      metadata: { kind: fact.kind, status: fact.status, source_type: fact.sourceType },
    })
    return fact
  })
})
