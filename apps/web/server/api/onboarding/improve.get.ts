import { remainingBriefImprovements } from '../../utils/onboarding-brief'

// How many free brief improvements the person has left.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return {
    remaining: await withUserTransaction(user.id, (client) => remainingBriefImprovements(client, user.id)),
  }
})
