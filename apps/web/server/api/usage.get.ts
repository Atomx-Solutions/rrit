export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { access, usage, credits, lowCredit, pendingProposals } = await withBusinessTransaction(
    user.id,
    async (client, business) => ({
      access: await trialStatus(business.id, client),
      usage: await usageSnapshot(business.id, client),
      credits: await creditBalanceSnapshot(client, business.id),
      lowCredit: await lowCreditStatus(client, business.id),
      // Offers waiting for the customer to accept or decline. Every page
      // already asks for this snapshot, so the navigation can flag Billing
      // without a request of its own.
      pendingProposals: Number(
        (
          await client.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM custom_packages WHERE status='draft'",
          )
        ).rows[0]?.count ?? 0,
      ),
    }),
  )
  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    plan: access.plan,
    state: access.state,
    credits,
    lowCredit,
    pendingProposals,
    usage: Object.entries(usage)
      .filter(([key]) => key !== 'ai_requests_per_day')
      .map(([key, value]) => ({
        key,
        ...value,
        remaining: Math.max(0, value.limit - value.current),
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
