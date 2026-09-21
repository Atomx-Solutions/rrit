import { adminServiceClient } from './admin-supabase'

export type AdminOverview = {
  organizations: { total: number, active: number, trialing: number, paused: number, cancelled: number }
  subscriptions: { mrr_cents: number, active: number, trialing: number }
  revenue: { total_cents: number, this_month_cents: number }
  ai: { cost_micro_eur_this_month: number, cost_micro_eur_total: number }
  users: { total: number }
  signups: { this_week: number, this_month: number }
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
    ai: {
      cost_micro_eur_this_month: number(ai.cost_micro_eur_this_month),
      cost_micro_eur_total: number(ai.cost_micro_eur_total),
    },
    users: { total: number(users.total) },
    signups: {
      this_week: number(signups.this_week),
      this_month: number(signups.this_month),
    },
  }
}

export async function adminOverview() {
  const { data, error } = await adminServiceClient().rpc('admin_overview_kpis')
  if (error) {
    console.error('Admin overview query failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'Statistikat administrative nuk u ngarkuan.' })
  }
  return normalizeAdminOverview(data)
}
