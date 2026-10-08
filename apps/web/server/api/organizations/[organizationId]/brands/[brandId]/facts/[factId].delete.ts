import { z } from 'zod'
import { recordAuditEvent } from '../../../../../../utils/audit'
import { archiveBusinessBrainFact } from '../../../../../../utils/business-brain'
import { withOrganizationTransaction } from '../../../../../../utils/brands'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  const brandId = z.uuid().safeParse(getRouterParam(event, 'brandId'))
  const factId = z.uuid().safeParse(getRouterParam(event, 'factId'))
  if (!organizationId.success || !brandId.success || !factId.success)
    throw createError({ statusCode: 404, message: 'server.FACT_NOT_FOUND' })
  return withOrganizationTransaction(user.id, organizationId.data, async (client) => {
    const fact = await archiveBusinessBrainFact(
      client,
      organizationId.data,
      brandId.data,
      factId.data,
    )
    await recordAuditEvent(client, {
      actorId: user.id,
      organizationId: organizationId.data,
      resourceType: 'business_brain_fact',
      resourceId: fact.id,
      action: 'business_brain_fact.archived',
      metadata: { status: fact.status },
    })
    return fact
  })
})
