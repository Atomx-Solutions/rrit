import { packageExpiryNotification } from '../utils/package-expiry-notification'

export default defineEventHandler(async (event) => {
  const timings: string[] = []
  const measure = (name: string, startedAt: number) => {
    timings.push(`${name};dur=${(performance.now() - startedAt).toFixed(1)}`)
  }
  let startedAt = performance.now()
  const user = await requireUser(event)
  measure('auth', startedAt)
  startedAt = performance.now()
  const { access, usage, credits, lowCredit, pendingProposals, packageExpiry } = await withBusinessTransaction(
    user.id,
    async (client, business) => {
      let stepStartedAt = performance.now()
      const access = await trialStatus(business.id, client)
      measure('access', stepStartedAt)
      stepStartedAt = performance.now()
      const usage = await usageSnapshot(business.id, client, access)
      measure('usage', stepStartedAt)
      stepStartedAt = performance.now()
      const credits = await creditBalanceSnapshot(client, business.id)
      measure('credits', stepStartedAt)
      stepStartedAt = performance.now()
      const lowCredit = await lowCreditStatus(client, business.id)
      measure('lowCredit', stepStartedAt)
      stepStartedAt = performance.now()
      const packages = await client.query<{ name: string; ends_at: Date; active: boolean }>(
        `SELECT name,ends_at,(status='active' AND starts_at<=now() AND ends_at>now()) AS active
           FROM custom_packages
          WHERE (status='active' AND starts_at<=now() AND ends_at>now())
             OR status='expired'
          ORDER BY active DESC,ends_at DESC
          LIMIT 2`,
      )
      const activePackage = packages.rows.find(pkg => pkg.active) || null
      const endedPackage = packages.rows.find(pkg => !pkg.active) || null
      const packageExpiry = packageExpiryNotification(
        activePackage,
        endedPackage && { name: endedPackage.name, endsAt: endedPackage.ends_at },
      )
      measure('packageExpiry', stepStartedAt)
      stepStartedAt = performance.now()
      const proposals = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM custom_packages WHERE status='draft'",
      )
      measure('proposals', stepStartedAt)
      return {
        access,
        usage,
        credits,
        lowCredit,
        packageExpiry,
        // Offers waiting for the customer to accept or decline. Every page
        // already asks for this snapshot, so the navigation can flag Billing
        // without a request of its own.
        pendingProposals: Number(proposals.rows[0]?.count ?? 0),
      }
    },
  )
  measure('databaseTotal', startedAt)
  setHeader(event, 'Server-Timing', timings.join(', '))
  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    plan: access.plan,
    state: access.state,
    trial: access,
    credits,
    lowCredit,
    packageExpiry,
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
