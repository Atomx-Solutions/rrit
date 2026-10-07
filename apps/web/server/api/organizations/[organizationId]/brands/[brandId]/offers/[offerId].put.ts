import { z } from 'zod'
import { updateOfferSchema } from '../../../../../../../shared/schemas/business-brain'
import { recordAuditEvent } from '../../../../../../utils/audit'
import { updateBusinessBrainOffer } from '../../../../../../utils/business-brain'
import { withOrganizationTransaction } from '../../../../../../utils/brands'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  const brandId = z.uuid().safeParse(getRouterParam(event, 'brandId'))
  const offerId = z.uuid().safeParse(getRouterParam(event, 'offerId'))
  if (!organizationId.success || !brandId.success || !offerId.success)
    throw createError({ statusCode: 404, message: 'server.OFFER_NOT_FOUND' })
  const parsed = updateOfferSchema.safeParse(await boundedBody(event, 8192))
  if (!parsed.success) throw createError({ statusCode: 422, message: 'server.OFFER_INVALID' })
  return withOrganizationTransaction(user.id, organizationId.data, async (client) => {
    const offer = await updateBusinessBrainOffer(
      client,
      organizationId.data,
      brandId.data,
      offerId.data,
      parsed.data,
    )
    await recordAuditEvent(client, {
      actorId: user.id,
      organizationId: organizationId.data,
      resourceType: 'business_brain_offer',
      resourceId: offer.id,
      action: 'business_brain_offer.updated',
      metadata: { status: offer.status, currency: offer.currency },
    })
    return offer
  })
})
