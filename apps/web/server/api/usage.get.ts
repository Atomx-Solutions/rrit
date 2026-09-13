export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { access, usage, credits } = await withBusinessTransaction(
    user.id,
    async (client, business) => ({
      access: await trialStatus(business.id, client),
      usage: await usageSnapshot(business.id, client),
      credits: await aiCreditSnapshot(business.id, client),
    }),
  )
  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    plan: access.plan,
    state: access.state,
    credits,
    usage: Object.entries(usage)
      .filter(([key]) => key !== 'ai_requests_per_day')
      .map(([key, value]) => ({
        key,
        ...value,
        percentage: value.limit
          ? Math.min(100, Math.round((value.current / value.limit) * 100))
          : 100,
        state:
          value.current >= value.limit
            ? ('exhausted' as const)
            : value.current >= value.limit * 0.8
              ? ('warning' as const)
              : ('available' as const),
      })),
  }
})
