import { adminServiceClient } from './admin-supabase'
import { adminAiCosts, adminAiCostsRange } from './admin-ai-costs'
import { aiProviderConfiguration } from './ai-provider'
import { getExchangeRate } from './exchange-rates'

export type AdminOverview = {
  /** Every amount below is already converted to this currency. */
  currency: 'CHF' | 'EUR'
  organizations: { total: number, active: number, trialing: number, paused: number, cancelled: number }
  subscriptions: { mrr_cents: number, active: number, trialing: number }
  revenue: { total_cents: number, this_month_cents: number }
  sales: { plans_total_cents: number, plans_this_month_cents: number, credits_total_cents: number, credits_this_month_cents: number, videos_total_cents: number, videos_this_month_cents: number, vat_total_cents: number, vat_this_month_cents: number }
  ai: { cost_micro_eur_this_month: number, cost_micro_eur_total: number, cost_cents_this_month: number, margin_cents_this_month: number }
  users: { total: number }
  signups: { this_week: number, this_month: number }
  new_organizations: { id: string, name: string, plan_name: string | null, created_at: string }[]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function number(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeAdminOverview(value: unknown): AdminOverview {
  const overview = record(value)
  const organizations = record(overview.organizations)
  const subscriptions = record(overview.subscriptions)
  const revenue = record(overview.revenue)
  const ai = record(overview.ai)
  const users = record(overview.users)
  const signups = record(overview.signups)
  const sales = record(overview.sales)

  return {
    currency: overview.currency === 'EUR' ? 'EUR' : 'CHF',
    organizations: {
      total: number(organizations.total),
      active: number(organizations.active),
      trialing: number(organizations.trialing),
      paused: number(organizations.paused),
      cancelled: number(organizations.cancelled),
    },
    subscriptions: {
      mrr_cents: number(subscriptions.mrr_cents),
      active: number(subscriptions.active),
      trialing: number(subscriptions.trialing),
    },
    revenue: {
      total_cents: number(revenue.total_cents),
      this_month_cents: number(revenue.this_month_cents),
    },
    sales: {
      plans_total_cents: number(sales.plans_total_cents),
      plans_this_month_cents: number(sales.plans_this_month_cents),
      credits_total_cents: number(sales.credits_total_cents),
      credits_this_month_cents: number(sales.credits_this_month_cents),
      videos_total_cents: number(sales.videos_total_cents),
      videos_this_month_cents: number(sales.videos_this_month_cents),
      vat_total_cents: number(sales.vat_total_cents),
      vat_this_month_cents: number(sales.vat_this_month_cents),
    },
    ai: {
      cost_micro_eur_this_month: number(ai.cost_micro_eur_this_month),
      cost_micro_eur_total: number(ai.cost_micro_eur_total),
      cost_cents_this_month: number(ai.cost_cents_this_month),
      margin_cents_this_month: number(ai.margin_cents_this_month),
    },
    users: { total: number(users.total) },
    signups: {
      this_week: number(signups.this_week),
      this_month: number(signups.this_month),
    },
    new_organizations: (Array.isArray(overview.new_organizations) ? overview.new_organizations : [])
      .map(record)
      .filter(item => typeof item.id === 'string')
      .map(item => ({
        id: item.id as string,
        name: typeof item.name === 'string' ? item.name : '',
        plan_name: typeof item.plan_name === 'string' ? item.plan_name : null,
        created_at: typeof item.created_at === 'string' ? item.created_at : '',
      })),
  }
}

export async function adminOverview() {
  // The AI tiles use the same month-to-date figures as the AI costs page
  // (the key in .env only), so both pages show the same numbers.
  let keyFingerprint = ''
  try {
    keyFingerprint = aiProviderConfiguration().keyFingerprint
  } catch {
    // Without a configured key no call can be attributed to the platform.
  }
  const [kpis, sales, aiCosts, customPackages, settings] = await Promise.all([
    adminServiceClient().rpc('admin_overview_kpis'),
    adminServiceClient().rpc('admin_revenue_by_source_currency'),
    adminAiCosts(adminAiCostsRange({})!, keyFingerprint),
    adminServiceClient().from('custom_packages').select('price_cents, currency, status, starts_at, ends_at, created_at'),
    adminServiceClient().from('platform_settings').select('package_currency').eq('singleton', true).maybeSingle(),
  ])
  const failed = kpis.error || sales.error || customPackages.error || settings.error
  if (failed) {
    console.error('Admin overview query failed.', { code: failed.code, message: failed.message })
    throw createError({ statusCode: 502, message: 'server.ADMIN_STATS_LOAD_FAILED' })
  }
  // Invoices and packages keep the currency they were issued in; each amount
  // is converted to the superadmin's currency before anything is added up.
  const currency: 'CHF' | 'EUR' = settings.data?.package_currency === 'EUR' ? 'EUR' : 'CHF'
  const rates = new Map<string, number>()
  const rateFrom = async (from: string) => {
    const base = from === 'EUR' ? 'EUR' : 'CHF'
    if (!rates.has(base)) rates.set(base, (await getExchangeRate(base, currency)).rate)
    return rates.get(base)!
  }
  const convert = async (cents: unknown, from: unknown) =>
    Math.round(number(cents) * await rateFrom(typeof from === 'string' ? from : currency))

  const totals = {
    plans_total_cents: 0, plans_this_month_cents: 0,
    credits_total_cents: 0, credits_this_month_cents: 0,
    videos_total_cents: 0, videos_this_month_cents: 0,
    vat_total_cents: 0, vat_this_month_cents: 0,
  }
  for (const row of (Array.isArray(sales.data) ? sales.data : []).map(record)) {
    const source = row.source === 'credits' || row.source === 'videos' ? row.source : 'plans'
    totals[`${source}_total_cents`] += await convert(row.total_cents, row.currency)
    totals[`${source}_this_month_cents`] += await convert(row.this_month_cents, row.currency)
    totals.vat_total_cents += await convert(row.vat_total_cents, row.currency)
    totals.vat_this_month_cents += await convert(row.vat_this_month_cents, row.currency)
  }

  const summary = record(record(aiCosts).summary)
  const overview = record(kpis.data)
  const costMicroEur = number(summary.this_month_cost_micro_eur)
  const costCents = Math.round((costMicroEur / 10_000) * await rateFrom('EUR'))
  const packageRows = customPackages.data ?? []
  const now = Date.now()
  const inForce = packageRows.filter((pkg) => pkg.status === 'active'
    && new Date(pkg.starts_at).getTime() <= now
    && new Date(pkg.ends_at).getTime() > now)
  let packageMrrCents = 0
  for (const pkg of inForce) packageMrrCents += await convert(pkg.price_cents, pkg.currency)
  // Every revenue figure here is net of VAT: VAT is collected for the state,
  // not earned. Monthly revenue is what was invoiced this month (an annual plan
  // counts in full in its purchase month), net of credit notes.
  return normalizeAdminOverview({
    ...overview,
    currency,
    organizations: { ...record(overview.organizations), active: inForce.length },
    subscriptions: { ...record(overview.subscriptions), active: inForce.length, mrr_cents: packageMrrCents },
    revenue: {
      ...record(overview.revenue),
      total_cents: totals.plans_total_cents + totals.credits_total_cents + totals.videos_total_cents,
      this_month_cents: totals.plans_this_month_cents + totals.credits_this_month_cents + totals.videos_this_month_cents,
    },
    sales: totals,
    ai: {
      ...record(overview.ai),
      cost_micro_eur_this_month: costMicroEur,
      cost_cents_this_month: costCents,
      // The AI margin is real money: credit top-ups sold this month minus what
      // the provider charged. Credits included in plans are paid for by the
      // plan price, so valuing them at the credit price would count money never
      // collected.
      margin_cents_this_month: totals.credits_this_month_cents - costCents,
    },
  })
}
