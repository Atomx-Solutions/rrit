import { z } from 'zod'
import { updateBrainSchema } from '../../../../../../shared/schemas/business-brain'
import { recordAuditEvent } from '../../../../../utils/audit'
import { updateBusinessBrainSettings } from '../../../../../utils/business-brain'
import { withOrganizationTransaction } from '../../../../../utils/brands'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  const brandId = z.uuid().safeParse(getRouterParam(event, 'brandId'))
  if (!organizationId.success || !brandId.success) throw createError({ statusCode: 404, message: 'server.BRAND_NOT_FOUND' })
  const parsed = updateBrainSchema.safeParse(await boundedBody(event, 32768))
  if (!parsed.success) throw createError({ statusCode: 422, message: 'server.BUSINESS_BRAIN_DATA_INVALID' })
  return withOrganizationTransaction(user.id, organizationId.data, async (client) => {
    const brain = await updateBusinessBrainSettings(client, organizationId.data, brandId.data, parsed.data)
    await recordAuditEvent(client, {
      actorId: user.id,
      organizationId: organizationId.data,
      resourceType: 'business_brain',
      resourceId: brandId.data,
      action: 'business_brain.updated',
      revision: brain.revision,
      metadata: { sections: ['voice', 'audiences', 'guardrails'] },
    })
    return brain
  })
})
