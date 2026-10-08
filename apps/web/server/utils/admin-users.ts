import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'

export const adminUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(254).optional(),
})
export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>

export type AdminUser = {
  id: string
  email: string | null
  created_at: string
  last_sign_in_at: string | null
  organizations: Array<{ id: string, name: string, role: string }>
}
export type AdminUsersPage = {
  items: AdminUser[]
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
export function normalizeAdminUsers(value: unknown, query: AdminUsersQuery): AdminUsersPage {
  const data = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const items = Array.isArray(data.items) ? (data.items as AdminUser[]) : []
  const total = number(data.total)
  const perPage = number(data.per_page) || query.per_page
  return {
    items: items.map(item => ({
      ...item,
      last_sign_in_at: item.last_sign_in_at ?? null,
      organizations: Array.isArray(item.organizations) ? item.organizations : [],
    })),
    page: number(data.page) || query.page,
    per_page: perPage,
    total,
    total_pages: Math.ceil(total / perPage),
  }
}

export async function adminUsers(query: AdminUsersQuery) {
  const { data, error } = await adminServiceClient().rpc('admin_list_users', {
    p_page: query.page,
    p_per_page: query.per_page,
    p_q: query.q || null,
  })
  if (error) {
    console.error('Admin user list failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.USERS_LIST_LOAD_FAILED' })
  }
  return normalizeAdminUsers(data, query)
}
