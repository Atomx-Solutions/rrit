import { planCatalogSchema } from '../../shared/schemas/catalog'

export default defineEventHandler(async () => {
  const result = await database().query(
    'SELECT name,version,monthly_cents,currency,description,features,feature_codes,limits,annual_discount_percent,purchasable FROM plan_catalog ORDER BY sort_order',
  )
  return result.rows.map((row) => {
    const plan = planCatalogSchema.safeParse({
      name: row.name,
      version: row.version,
      monthlyCents: row.monthly_cents,
      currency: row.currency,
      annualDiscount: row.annual_discount_percent,
      description: row.description,
      displayFeatures: row.features,
      entitlements: row.feature_codes,
      limits: row.limits,
      purchasable: row.purchasable,
    })
    if (!plan.success)
      throw createError({ statusCode: 503, message: 'Katalogu i planeve nuk është i vlefshëm.' })
    return {
      ...plan.data,
      price: plan.data.monthlyCents / 100,
      features: plan.data.displayFeatures,
    }
  })
})
