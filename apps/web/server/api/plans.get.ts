import { planCatalogSchema } from '../../shared/schemas/catalog'

export default defineEventHandler(async () => {
  const result = await database().query(
    'SELECT code,name,monthly_cents,currency,posts_per_month,monthly_credits,style_fetch_post_count,annual_discount_percent,is_trial FROM plans WHERE active=true ORDER BY sort_order',
  )
  return result.rows.map((row) => {
    const plan = planCatalogSchema.safeParse({
      name: row.name,
      version: 1,
      monthlyCents: row.monthly_cents,
      currency: row.currency,
      annualDiscount: row.annual_discount_percent,
      description: '',
      displayFeatures: [],
      entitlements: ['posts', 'media', 'validation', 'social_import', 'publishing', 'ai'],
      limits: {
        posts_per_month: row.posts_per_month,
        ai_requests_per_day: 0,
        media_storage_bytes: 0,
        social_accounts: 0,
        members: 1,
      },
      purchasable: !row.is_trial,
    })
    if (!plan.success)
      throw createError({ statusCode: 503, message: 'Katalogu i planeve nuk është i vlefshëm.' })
    return {
      ...plan.data,
      code: row.code,
      isTrial: row.is_trial,
      monthlyCredits: row.monthly_credits,
      styleFetchPostCount: row.style_fetch_post_count,
      price: plan.data.monthlyCents / 100,
      features: plan.data.displayFeatures,
    }
  })
})
