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
  NO_ACTIVE_SUBSCRIPTION: { statusCode: 422, message: 'Organizata nuk ka abonim aktiv.' },
  SUBSCRIPTION_ALREADY_PAUSED: { statusCode: 422, message: 'Abonimi është tashmë i pauzuar.' },
  SUBSCRIPTION_NOT_PAUSED: { statusCode: 422, message: 'Abonimi nuk është i pauzuar.' },
  OTHER_SUBSCRIPTION_ACTIVE: { statusCode: 409, message: 'Organizata ka tashmë një abonim tjetër aktiv.' },
  PLAN_UNAVAILABLE: { statusCode: 422, message: 'Pakoja nuk është e disponueshme.' },
  INVALID_EXTENSION: { statusCode: 400, message: 'Zgjatja duhet të jetë nga 1 deri në 365 ditë.' },
  INVALID_ACTION: { statusCode: 400, message: 'Veprimi nuk është i vlefshëm.' },
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
    throw createError({ statusCode: 502, message: 'Abonimi nuk u ndryshua.' })
  }
  return data as Record<string, unknown>
}

export const adminSubscriptionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['trialing', 'active', 'paused', 'cancelled', 'expired']).optional(),
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
  const { data, error } = await adminServiceClient().rpc('admin_list_subscriptions', {
    p_page: query.page ?? 1,
    p_per_page: query.per_page ?? 50,
    p_status: query.status ?? null,
    p_plan: query.plan ?? null,
    p_expiring_days: query.expiring_days ?? null,
  })
  if (error) {
    console.error('Admin subscriptions query failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'Abonimet nuk u ngarkuan.' })
  }
  return normalizeAdminSubscriptions(data, query)
}
