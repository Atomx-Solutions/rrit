import { z } from 'zod'
import { createOfferSchema } from '../../../../../../../shared/schemas/business-brain'
import { recordAuditEvent } from '../../../../../../utils/audit'
import { createBusinessBrainOffer } from '../../../../../../utils/business-brain'
import { withOrganizationTransaction } from '../../../../../../utils/brands'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  const brandId = z.uuid().safeParse(getRouterParam(event, 'brandId'))
  if (!organizationId.success || !brandId.success) throw createError({ statusCode: 404, message: 'server.BRAND_NOT_FOUND' })
  const parsed = createOfferSchema.safeParse(await boundedBody(event, 8192))
  if (!parsed.success) throw createError({ statusCode: 422, message: 'server.OFFER_INVALID' })
  return withOrganizationTransaction(user.id, organizationId.data, async (client) => {
    const offer = await createBusinessBrainOffer(client, organizationId.data, brandId.data, parsed.data)
    await recordAuditEvent(client, {
      actorId: user.id,
      organizationId: organizationId.data,
      resourceType: 'business_brain_offer',
      resourceId: offer.id,
      action: 'business_brain_offer.created',
      metadata: { status: offer.status, currency: offer.currency },
    })
    return offer
  })
})
