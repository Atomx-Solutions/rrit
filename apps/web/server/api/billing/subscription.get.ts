import { packageUsageSummary } from '../../utils/custom-packages'
import { creditPricing } from '../../utils/credits'
import { convertCurrency, getExchangeRate } from '../../utils/exchange-rates'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { customPackage, packageProposal, creditPriceCents, currency, exchangeRate } = await withBusinessTransaction(user.id, async (client, business) => {
    const workspaceResult = await client.query<{ currency: string | null }>(
      `SELECT state->'preferences'->>'currency' AS currency FROM businesses WHERE id=$1`,
      [business.id],
    )
    const currency = workspaceResult.rows[0]?.currency === 'CHF' ? 'CHF' : 'EUR'
    const exchangeRate = await getExchangeRate('EUR', currency)
    // A custom package is a negotiated agreement that replaces plan purchase
    // while it runs. Row level security scopes this read to the caller's own
    // organization, so the query does not filter by id itself.
    const custom = await client.query<{
      name: string
      posts_included: number
      videos_included: number
      price_cents: number
      starts_at: Date
      ends_at: Date
      used_posts: number
      used_videos: number
    }>(
      `SELECT package.name,package.posts_included,package.videos_included,package.price_cents,package.starts_at,package.ends_at,
              (
                SELECT count(*)::integer
                FROM posts
                WHERE business_id=$1
                  AND created_at >= package.starts_at
                  AND created_at < package.ends_at
              ) AS used_posts,
              (
                SELECT count(*)::integer
                FROM tiktok_video_renders
                WHERE business_id=$1
                  AND created_at >= package.starts_at
                  AND created_at < package.ends_at
              ) AS used_videos
         FROM custom_packages AS package
        WHERE status='active' AND starts_at<=now() AND ends_at>now()
        ORDER BY ends_at DESC
        LIMIT 1`,
      [business.id],
    )
    const proposal = await client.query<{
      name: string
      posts_included: number
      videos_included: number
      credits_included: number
      price_cents: number
      starts_at: Date
      ends_at: Date
    }>(
      `SELECT name,posts_included,videos_included,credits_included,price_cents,starts_at,ends_at
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
      currency,
      exchangeRate: exchangeRate.rate,
    }
  })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    currency,
    exchangeRate,
    // Keep per-credit precision; the UI rounds only the requested total.
    creditPrice: convertCurrency(creditPriceCents / 100, exchangeRate, 6),
    packageProposal: packageProposal && {
      name: packageProposal.name,
      // The page states what the offer actually carries, so each kind is sent
      // on its own rather than being inferred from the absence of another.
      postsIncluded: packageProposal.posts_included,
      videosIncluded: packageProposal.videos_included,
      creditsIncluded: packageProposal.credits_included,
      price: convertCurrency(packageProposal.price_cents / 100, exchangeRate),
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
        videosIncluded: customPackage.videos_included,
        usedVideos: customPackage.used_videos,
        remainingVideos: Math.max(0, customPackage.videos_included - customPackage.used_videos),
        price: convertCurrency(customPackage.price_cents / 100, exchangeRate),
        startsAt,
        endsAt,
        ...usage,
      }
    })(),
    subscription: null,
  }
})
