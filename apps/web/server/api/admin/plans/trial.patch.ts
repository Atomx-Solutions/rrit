import { adminChangeBody, trialPlanChangesSchema, updateTrialPlan } from '../../../utils/admin-plans'

export default defineEventHandler(async (event) => {
  const changes = await adminChangeBody(event, trialPlanChangesSchema)
  const actor = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return updateTrialPlan({ id: actor.id, email: actor.email }, changes)
})
