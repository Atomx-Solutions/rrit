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
