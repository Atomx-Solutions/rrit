import { adminChangeBody, planChangesSchema, planCodeSchema, updatePlan } from '../../../utils/admin-plans'

// Existing subscriptions keep the price_cents fixed at purchase; only new
// purchases and plan changes use the new package values.
export default defineEventHandler(async (event) => {
  const code = planCodeSchema.safeParse(getRouterParam(event, 'code'))
  if (!code.success)
    throw createError({ statusCode: 404, message: 'Pakoja nuk u gjet.', data: { code: 'PLAN_NOT_FOUND' } })
  const changes = await adminChangeBody(event, planChangesSchema)
  const actor = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return updatePlan(code.data, { id: actor.id, email: actor.email }, changes)
})
