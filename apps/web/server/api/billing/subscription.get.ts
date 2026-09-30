import { packageUsageSummary } from '../../utils/custom-packages'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { subscription, customPackage, packageProposal } = await withBusinessTransaction(user.id, async (client, business) => {
    const result = await client.query<{
      plan_code: string
      billing_interval: 'monthly' | 'annual'
      status: string
      current_period_start: Date
      current_period_end: Date
      price_cents: number | null
      pending_plan_code: string | null
    }>(
      `SELECT plan_code,billing_interval,status,current_period_start,current_period_end,
              price_cents,pending_plan_code
         FROM subscriptions
        WHERE organization_id=$1 AND status IN ('trialing','active','past_due')`,
      [business.id],
    )
    // A custom package is a negotiated agreement that replaces plan purchase
    // while it runs. Row level security scopes this read to the caller's own
    // organization, so the query does not filter by id itself.
    const custom = await client.query<{
      name: string
      posts_included: number
      price_cents: number
      starts_at: Date
      ends_at: Date
      used_posts: number
    }>(
      `SELECT package.name,package.posts_included,package.price_cents,package.starts_at,package.ends_at,
              (
                SELECT count(*)::integer
                FROM posts
                WHERE business_id=$1
                  AND created_at >= package.starts_at
                  AND created_at < package.ends_at
              ) AS used_posts
         FROM custom_packages AS package
        WHERE status='active' AND starts_at<=now() AND ends_at>now()
        ORDER BY ends_at DESC
        LIMIT 1`,
      [business.id],
    )
    const proposal = await client.query<{
      name: string
      posts_included: number
      price_cents: number
      starts_at: Date
      ends_at: Date
    }>(
      `SELECT name,posts_included,price_cents,starts_at,ends_at
         FROM custom_packages WHERE status='draft'
         ORDER BY created_at DESC,id DESC LIMIT 1`,
    )
    return {
      subscription: result.rows[0] || null,
      customPackage: custom.rows[0] || null,
      packageProposal: proposal.rows[0] || null,
    }
  })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    packageProposal: packageProposal && {
      name: packageProposal.name,
      postsIncluded: packageProposal.posts_included,
      price: packageProposal.price_cents / 100,
      startsAt: new Date(packageProposal.starts_at).toISOString(),
      endsAt: new Date(packageProposal.ends_at).toISOString(),
    },
    customPackage: customPackage && (() => {
      const startsAt = new Date(customPackage.starts_at).toISOString()
      const endsAt = new Date(customPackage.ends_at).toISOString()
      const usage = packageUsageSummary({
        status: 'active',
        startsAt,
        endsAt,
        postsIncluded: customPackage.posts_included,
      }, customPackage.used_posts, new Date())
      return {
        name: customPackage.name,
        postsIncluded: customPackage.posts_included,
        price: customPackage.price_cents / 100,
        startsAt,
        endsAt,
        ...usage,
      }
    })(),
    subscription: subscription && {
      planCode: subscription.plan_code,
      interval: subscription.billing_interval,
      status: subscription.status,
      periodStart: new Date(subscription.current_period_start).toISOString(),
      periodEnd: new Date(subscription.current_period_end).toISOString(),
      price: subscription.price_cents === null ? null : subscription.price_cents / 100,
      pendingPlanCode: subscription.pending_plan_code,
    },
  }
})
