import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'

export const adminOrganizationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['trialing', 'active', 'paused', 'cancelled', 'expired']).optional(),
  plan: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/).optional(),
  q: z.string().trim().max(120).optional(),
})
export type AdminOrganizationsQuery = z.infer<typeof adminOrganizationsQuerySchema>

export type AdminOrganization = {
  id: string
  slug: string
  name: string
  status: string
  created_at: string
  subscription: {
    plan_code: string
    plan_name: string
    status: string
    current_period_end: string
    price_cents: number | null
  } | null
  credit_balance: { remaining_credits: number, reserved_credits: number } | null
  brand_count: number
  member_count: number
}
export type AdminOrganizationsPage = {
  items: AdminOrganization[]
  page: number
  per_page: number
  total: number
  total_pages: number
}

function number(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Keeps the documented shape even when the function returns partial data. */
export function normalizeAdminOrganizations(value: unknown, query: AdminOrganizationsQuery): AdminOrganizationsPage {
  const data = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const items = Array.isArray(data.items) ? (data.items as AdminOrganization[]) : []
  const total = number(data.total)
  const perPage = number(data.per_page) || query.per_page
  return {
    items: items.map(item => ({
      ...item,
      subscription: item.subscription ?? null,
      credit_balance: item.credit_balance ?? null,
      brand_count: number(item.brand_count),
      member_count: number(item.member_count),
    })),
    page: number(data.page) || query.page,
    per_page: perPage,
    total,
    total_pages: Math.ceil(total / perPage),
  }
}

export async function adminOrganizations(query: AdminOrganizationsQuery) {
  const { data, error } = await adminServiceClient().rpc('admin_list_organizations', {
    p_page: query.page,
    p_per_page: query.per_page,
    p_status: query.status ?? null,
    p_plan: query.plan ?? null,
    p_q: query.q || null,
  })
  if (error) {
    console.error('Admin organization list failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'Lista e organizatave nuk u ngarkua.' })
  }
  return normalizeAdminOrganizations(data, query)
}
