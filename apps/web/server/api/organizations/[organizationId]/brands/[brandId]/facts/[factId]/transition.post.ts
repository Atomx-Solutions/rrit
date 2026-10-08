import { z } from 'zod'
import { recordAuditEvent } from '../../../../../../../utils/audit'
import { transitionBusinessBrainFact } from '../../../../../../../utils/business-brain'
import { withOrganizationTransaction } from '../../../../../../../utils/brands'

const transitionSchema = z.object({ status: z.enum(['verified', 'rejected']) })

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  const brandId = z.uuid().safeParse(getRouterParam(event, 'brandId'))
  const factId = z.uuid().safeParse(getRouterParam(event, 'factId'))
  if (!organizationId.success || !brandId.success || !factId.success) throw createError({ statusCode: 404, message: 'server.FACT_NOT_FOUND' })
  const parsed = transitionSchema.safeParse(await boundedBody(event, 2048))
  if (!parsed.success) throw createError({ statusCode: 422, message: 'server.TRANSITION_INVALID' })
  return withOrganizationTransaction(user.id, organizationId.data, async (client) => {
    const fact = await transitionBusinessBrainFact(client, organizationId.data, brandId.data, factId.data, parsed.data.status, user.id)
    await recordAuditEvent(client, {
      actorId: user.id,
      organizationId: organizationId.data,
      resourceType: 'business_brain_fact',
      resourceId: fact.id,
      action: `business_brain_fact.${parsed.data.status}`,
      metadata: { kind: fact.kind, version: fact.version },
    })
    return fact
  })
})
