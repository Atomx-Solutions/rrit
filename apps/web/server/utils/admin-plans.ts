import { z } from 'zod'
import type { H3Event } from 'h3'
import { adminServiceClient } from './admin-supabase'

const count = z.number().int().min(0)
// Only the fields sent are changed; an empty body is not a change.
function nonEmpty<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict().refine(value => Object.keys(value).length > 0)
}

export const planCodeSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/)
export const planChangesSchema = nonEmpty({
  name: z.string().trim().min(2).max(120).optional(),
  monthly_cents: count.max(100_000_000).optional(),
  posts_per_month: count.max(100_000).optional(),
  monthly_credits: count.max(100_000_000).optional(),
  annual_discount_percent: z.number().int().min(0).max(100).optional(),
  style_fetch_post_count: z.number().int().min(1).max(100).optional(),
  active: z.boolean().optional(),
  sort_order: count.max(10_000).optional(),
})
// Column names follow PRC-08 (one credit = a slice of provider cost).
export const creditPricingChangesSchema = nonEmpty({
  credit_price_cents: z.number().int().min(1).max(100_000).optional(),
  provider_cost_per_credit_micro_eur: z.number().int().min(1).max(100_000_000).optional(),
  low_credit_threshold: count.max(100_000_000).optional(),
})
export const invoiceSettingsChangesSchema = nonEmpty({
  number_prefix: z.string().trim().regex(/^[A-Z0-9]{2,12}$/).optional(),
  seller_name: z.string().trim().min(1).max(160).optional(),
  seller_address: z.string().trim().max(240).optional(),
  seller_fiscal_number: z.string().trim().max(40).optional(),
  vat_rate_basis_points: z.number().int().min(0).max(10_000).optional(),
})

// Business-rule failures raised by the admin_update_* functions.
const failures: Record<string, { statusCode: number; message: string }> = {
  PLAN_NOT_FOUND: { statusCode: 404, message: 'Pakoja nuk u gjet.' },
  PLAN_CONFLICT: { statusCode: 409, message: 'Emri ose renditja e pakos përdoret nga një pako tjetër.' },
  PLAN_INVALID: { statusCode: 400, message: 'Vlerat e pakos nuk janë të vlefshme.' },
  SETTINGS_INVALID: { statusCode: 400, message: 'Vlerat e cilësimeve nuk janë të vlefshme.' },
}
export function adminPlansFailure(message: string | undefined) {
  const failure = message ? failures[message] : undefined
  return failure ? { ...failure, code: message! } : null
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await adminServiceClient().rpc(name, args)
  if (error) {
    const failure = adminPlansFailure(error.message)
    if (failure)
      throw createError({ statusCode: failure.statusCode, message: failure.message, data: { code: failure.code } })
    console.error('Admin plans settings call failed.', { name, code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'Cilësimet nuk u ruajtën.' })
  }
  return data as Record<string, unknown>
}

export function adminPlansSettings() {
  return rpc('admin_plans_settings', {})
}

/** Validates a PATCH body with the given schema; any invalid value is a 400. */
export async function adminChangeBody<T extends z.ZodType>(event: H3Event, schema: T): Promise<z.infer<T>> {
  requireSameOrigin(event)
  const body = schema.safeParse(await boundedBody(event, 4096))
  if (!body.success)
    throw createError({ statusCode: 400, message: 'Vlerat nuk janë të vlefshme.', data: { code: 'INVALID_BODY' } })
  return body.data
}

export function updatePlan(code: string, actor: { id: string; email: string }, changes: Record<string, unknown>) {
  return rpc('admin_update_plan', { p_code: code, p_actor_id: actor.id, p_actor_email: actor.email, p_changes: changes })
}
export function updateCreditPricing(actor: { id: string; email: string }, changes: Record<string, unknown>) {
  return rpc('admin_update_credit_pricing', { p_actor_id: actor.id, p_actor_email: actor.email, p_changes: changes })
}
export function updateInvoiceSettings(actor: { id: string; email: string }, changes: Record<string, unknown>) {
  return rpc('admin_update_invoice_settings', { p_actor_id: actor.id, p_actor_email: actor.email, p_changes: changes })
}
