import { adminServiceClient } from './admin-supabase'
import { adminAiCosts, adminAiCostsRange } from './admin-ai-costs'
import { aiProviderConfiguration } from './ai-provider'

export type AdminOverview = {
  organizations: { total: number, active: number, trialing: number, paused: number, cancelled: number }
  subscriptions: { mrr_cents: number, active: number, trialing: number }
  revenue: { total_cents: number, this_month_cents: number }
  sales: { plans_total_cents: number, plans_this_month_cents: number, credits_total_cents: number, credits_this_month_cents: number, vat_total_cents: number, vat_this_month_cents: number }
  ai: { cost_micro_eur_this_month: number, cost_micro_eur_total: number, margin_cents_this_month: number }
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
      vat_total_cents: number(sales.vat_total_cents),
      vat_this_month_cents: number(sales.vat_this_month_cents),
    },
    ai: {
      cost_micro_eur_this_month: number(ai.cost_micro_eur_this_month),
      cost_micro_eur_total: number(ai.cost_micro_eur_total),
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
  const [kpis, sales, aiCosts] = await Promise.all([
    adminServiceClient().rpc('admin_overview_kpis'),
    adminServiceClient().rpc('admin_revenue_by_source'),
    adminAiCosts(adminAiCostsRange({})!, keyFingerprint),
  ])
  const failed = kpis.error || sales.error
  if (failed) {
    console.error('Admin overview query failed.', { code: failed.code, message: failed.message })
    throw createError({ statusCode: 502, message: 'Statistikat administrative nuk u ngarkuan.' })
  }
  const summary = record(record(aiCosts).summary)
  const overview = record(kpis.data)
  const costMicroEur = number(summary.this_month_cost_micro_eur)
  // The AI margin is real money: credit top-ups sold this month minus what the
  // provider charged. Credits included in plans are paid for by the plan price,
  // so valuing them at the credit price would count money never collected.
  const creditSalesCents = number(record(sales.data).credits_this_month_cents)
  // Every revenue figure here is net of VAT: VAT is collected for the state,
  // not earned. Monthly revenue is what was invoiced this month (an annual plan
  // counts in full in its purchase month), net of credit notes.
  const monthSalesCents = number(record(sales.data).plans_this_month_cents) + number(record(sales.data).credits_this_month_cents)
  const totalSalesCents = number(record(sales.data).plans_total_cents) + number(record(sales.data).credits_total_cents)
  return normalizeAdminOverview({
    ...overview,
    subscriptions: { ...record(overview.subscriptions), mrr_cents: monthSalesCents },
    revenue: { ...record(overview.revenue), total_cents: totalSalesCents, this_month_cents: monthSalesCents },
    sales: sales.data,
    ai: {
      ...record(overview.ai),
      cost_micro_eur_this_month: costMicroEur,
      margin_cents_this_month: creditSalesCents - Math.round(costMicroEur / 10_000),
    },
  })
}
