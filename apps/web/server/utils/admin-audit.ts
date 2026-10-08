import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
export const adminAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
  organization_id: z.uuid().optional(),
  actor: z.string().trim().max(254).optional(),
  action: z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}(\.[a-z][a-z0-9_]{0,63})+$/).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
})
export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>

export type AdminAuditEvent = {
  id: number
  created_at: string
  action: string
  actor_id: string | null
  actor_email: string | null
  organization_id: string | null
  organization_name: string | null
  resource_type: string
  resource_id: string
  result: string
  metadata: Record<string, unknown>
}
export type AdminAuditPage = {
  items: AdminAuditEvent[]
  page: number
  per_page: number
  total: number
  total_pages: number
  actions: string[]
  organizations: Array<{ id: string, name: string }>
}

function number(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Keeps the documented shape even when the log is empty or partial. */
export function normalizeAdminAudit(value: unknown, query: AdminAuditQuery): AdminAuditPage {
  const data = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const total = number(data.total)
  const perPage = number(data.per_page) || query.per_page
  return {
    items: (Array.isArray(data.items) ? data.items as AdminAuditEvent[] : []).map(item => ({
      ...item,
      metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {},
    })),
    page: number(data.page) || query.page,
    per_page: perPage,
    total,
    total_pages: Math.ceil(total / perPage),
    actions: Array.isArray(data.actions) ? data.actions.filter((action): action is string => typeof action === 'string') : [],
    organizations: Array.isArray(data.organizations) ? data.organizations as AdminAuditPage['organizations'] : [],
  }
}

const DAY = 24 * 60 * 60 * 1000

export async function adminAuditEvents(query: AdminAuditQuery) {
  const { data, error } = await adminServiceClient().rpc('admin_list_audit_events', {
    p_page: query.page,
    p_per_page: query.per_page,
    p_organization_id: query.organization_id ?? null,
    p_actor: query.actor || null,
    p_action: query.action ?? null,
    // Whole UTC days: from the start of `from` up to the end of `to`.
    p_from: query.from ? new Date(`${query.from}T00:00:00Z`).toISOString() : null,
    p_to: query.to ? new Date(new Date(`${query.to}T00:00:00Z`).getTime() + DAY).toISOString() : null,
  })
  if (error) {
    console.error('Admin audit log failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.AUDIT_LOG_LOAD_FAILED' })
  }
  return normalizeAdminAudit(data, query)
}
