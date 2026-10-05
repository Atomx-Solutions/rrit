import { packageUsageSummary } from '../../utils/custom-packages'
import { creditPricing } from '../../utils/credits'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { customPackage, packageProposal, creditPriceCents } = await withBusinessTransaction(user.id, async (client, business) => {
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
      credits_included: number
      price_cents: number
      starts_at: Date
      ends_at: Date
    }>(
      `SELECT name,posts_included,credits_included,price_cents,starts_at,ends_at
         FROM custom_packages
        WHERE organization_id=$1 AND status='draft'
        ORDER BY created_at DESC,id DESC LIMIT 1`,
      [business.id],
    )
    return {
      customPackage: custom.rows[0] || null,
      packageProposal: proposal.rows[0] || null,
      // What a credit costs the customer, so the page can price a top-up
      // before asking for one instead of leaving the amount a mystery.
      creditPriceCents: (await creditPricing(client)).creditPriceCents,
    }
  })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    creditPrice: creditPriceCents / 100,
    packageProposal: packageProposal && {
      name: packageProposal.name,
      postsIncluded: packageProposal.posts_included,
      // A proposal with no posts is a credit top-up for the running package,
      // so the page can say what is actually being offered.
      creditsIncluded: packageProposal.credits_included,
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
    subscription: null,
  }
})
