import { adminChangeBody, creditPricingChangesSchema, updateCreditPricing } from '../../../utils/admin-plans'

export default defineEventHandler(async (event) => {
  const changes = await adminChangeBody(event, creditPricingChangesSchema)
  const actor = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return updateCreditPricing({ id: actor.id, email: actor.email }, changes)
})
