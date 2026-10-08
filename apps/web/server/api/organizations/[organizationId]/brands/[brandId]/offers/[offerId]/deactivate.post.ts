import { z } from 'zod'
import { recordAuditEvent } from '../../../../../../../utils/audit'
import { deactivateBusinessBrainOffer } from '../../../../../../../utils/business-brain'
import { withOrganizationTransaction } from '../../../../../../../utils/brands'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  const brandId = z.uuid().safeParse(getRouterParam(event, 'brandId'))
  const offerId = z.uuid().safeParse(getRouterParam(event, 'offerId'))
  if (!organizationId.success || !brandId.success || !offerId.success)
    throw createError({ statusCode: 404, message: 'server.OFFER_NOT_FOUND' })
  return withOrganizationTransaction(user.id, organizationId.data, async (client) => {
    const offer = await deactivateBusinessBrainOffer(
      client,
      organizationId.data,
      brandId.data,
      offerId.data,
    )
    await recordAuditEvent(client, {
      actorId: user.id,
      organizationId: organizationId.data,
      resourceType: 'business_brain_offer',
      resourceId: offer.id,
      action: 'business_brain_offer.deactivated',
      metadata: { status: offer.status },
    })
    return offer
  })
})
