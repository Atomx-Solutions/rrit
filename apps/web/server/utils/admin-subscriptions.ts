import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'

export const adminSubscriptionActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause'), reason: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal('resume') }),
  z.object({
    action: z.literal('change_plan'),
    plan_code: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
    billing_interval: z.enum(['monthly', 'annual']),
  }),
  z.object({ action: z.literal('extend'), days: z.number().int().min(1).max(365) }),
  z.object({ action: z.literal('cancel') }),
])
export type AdminSubscriptionAction = z.infer<typeof adminSubscriptionActionSchema>

// Business-rule failures raised by admin_change_subscription.
const actionFailures: Record<string, { statusCode: number; message: string }> = {
  NO_ACTIVE_SUBSCRIPTION: { statusCode: 422, message: 'server.ORGANIZATION_NO_ACTIVE_SUBSCRIPTION' },
  SUBSCRIPTION_ALREADY_PAUSED: { statusCode: 422, message: 'server.SUBSCRIPTION_ALREADY_PAUSED' },
  SUBSCRIPTION_NOT_PAUSED: { statusCode: 422, message: 'server.SUBSCRIPTION_NOT_PAUSED' },
  OTHER_SUBSCRIPTION_ACTIVE: { statusCode: 409, message: 'server.ORGANIZATION_HAS_OTHER_SUBSCRIPTION' },
  PLAN_UNAVAILABLE: { statusCode: 422, message: 'server.PACKAGE_UNAVAILABLE' },
  INVALID_EXTENSION: { statusCode: 400, message: 'server.EXTENSION_DURATION_INVALID' },
  INVALID_ACTION: { statusCode: 400, message: 'server.ACTION_INVALID' },
}

export function adminSubscriptionFailure(message: string | undefined) {
  const failure = message ? actionFailures[message] : undefined
  return failure ? { ...failure, code: message! } : null
}

export async function changeAdminSubscription(input: {
  organizationId: string
  actor: { id: string; email: string }
  change: AdminSubscriptionAction
}) {
  const { action, ...params } = input.change
  const { data, error } = await adminServiceClient().rpc('admin_change_subscription', {
    p_organization_id: input.organizationId,
    p_actor_id: input.actor.id,
    p_actor_email: input.actor.email,
    p_action: action,
    p_params: params,
  })
  if (error) {
    const failure = adminSubscriptionFailure(error.message)
    if (failure)
      throw createError({ statusCode: failure.statusCode, message: failure.message, data: { code: failure.code } })
    console.error('Admin subscription change failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.SUBSCRIPTION_NOT_CHANGED' })
  }
  return data as Record<string, unknown>
}

export const adminSubscriptionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['active', 'draft', 'cancelled', 'expired']).optional(),
  plan: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/).optional(),
  expiring_days: z.coerce.number().int().min(1).max(365).optional(),
})

export type AdminSubscriptionsQuery = z.infer<typeof adminSubscriptionsQuerySchema>

export type AdminSubscriptionRow = {
  id: string
  organization_id: string
  organization_name: string
  plan_code: string
  plan_name: string
  billing_interval: 'monthly' | 'annual'
  status: string
  current_period_start: string
  current_period_end: string
  price_cents: number | null
  cancel_at_period_end: boolean
  paused_at: string | null
  paused_by: string | null
  days_until_expiry: number
}

/** Keeps the documented shape even when the function returns partial data. */
export function normalizeAdminSubscriptions(value: unknown, query: AdminSubscriptionsQuery) {
  const data = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const total = Number(data.total) || 0
  const perPage = Number(data.per_page) || query.per_page || 50
  return {
    items: Array.isArray(data.items) ? (data.items as AdminSubscriptionRow[]) : [],
    total,
    page: Number(data.page) || query.page || 1,
    per_page: perPage,
    total_pages: Math.ceil(total / perPage),
  }
}

export async function adminListSubscriptions(query: AdminSubscriptionsQuery) {
  // This admin page is the custom-package ledger. It must not read
  // `subscriptions`, invoices, or credit top-ups: those are separate billing
  // concerns and are intentionally not rows in this list.
  const { data: packages, error } = await adminServiceClient()
    .from('custom_packages')
    .select('id, organization_id, name, price_cents, starts_at, ends_at, status, organizations!inner(name)', { count: 'exact' })
    .order('ends_at', { ascending: true })

  if (error) {
    console.error('Admin subscriptions query failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.SUBSCRIPTIONS_LOAD_FAILED' })
  }

  const now = Date.now()
  const rows = (packages ?? []).map((item) => {
    const startsAt = new Date(item.starts_at).getTime()
    const endsAt = new Date(item.ends_at).getTime()
    const status = item.status === 'active' && startsAt <= now && endsAt > now
      ? 'active'
      : item.status === 'active' ? 'expired' : item.status
    const organization = Array.isArray(item.organizations) ? item.organizations[0] : item.organizations
    return {
      id: item.id,
      organization_id: item.organization_id,
      organization_name: organization?.name || item.organization_id,
      plan_code: 'custom_package',
      plan_name: item.name,
      billing_interval: 'monthly' as const,
      status,
      current_period_start: item.starts_at,
      current_period_end: item.ends_at,
      price_cents: item.price_cents,
      cancel_at_period_end: false,
      paused_at: null,
      paused_by: null,
      days_until_expiry: Math.max(0, Math.ceil((endsAt - now) / 86400000)),
    }
  }).filter((item) => {
    if (query.status && item.status !== query.status) return false
    if (query.expiring_days) {
      const end = new Date(item.current_period_end).getTime()
      if (end < now || end >= now + query.expiring_days * 86400000) return false
    }
    return true
  })

  const page = query.page ?? 1
  const perPage = query.per_page ?? 50
  const start = (page - 1) * perPage
  return normalizeAdminSubscriptions({
    items: rows.slice(start, start + perPage),
    total: rows.length,
    page,
    per_page: perPage,
  }, query)
}
