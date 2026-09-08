export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const business = await businessForUser(user.id)
  const [access, usage] = await Promise.all([
    trialStatus(business.id),
    usageSnapshot(business.id),
  ])
  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    plan: access.plan,
    state: access.state,
    usage: Object.entries(usage).map(([key, value]) => ({
      key,
      ...value,
      percentage: value.limit ? Math.min(100, Math.round((value.current / value.limit) * 100)) : 100,
      state:
        value.current >= value.limit
          ? ('exhausted' as const)
          : value.current >= value.limit * 0.8
            ? ('warning' as const)
            : ('available' as const),
    })),
  }
})
