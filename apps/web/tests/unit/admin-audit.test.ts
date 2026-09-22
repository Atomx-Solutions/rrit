import { describe, expect, it } from 'vitest'
import { adminAuditQuerySchema, normalizeAdminAudit } from '../../server/utils/admin-audit'

describe('admin audit log', () => {
  it('returns an empty, well-formed page when the log is empty', () => {
    const query = adminAuditQuerySchema.parse({})
    expect(normalizeAdminAudit(null, query)).toEqual({
      items: [],
      page: 1,
      per_page: 25,
      total: 0,
      total_pages: 0,
      actions: [],
      organizations: [],
    })
  })

  it('always gives each event an object payload', () => {
    const query = adminAuditQuerySchema.parse({})
    const page = normalizeAdminAudit({ items: [{ id: 1, action: 'plan.updated', metadata: null }], total: 1 }, query)
    expect(page.items[0]!.metadata).toEqual({})
  })

  it('accepts dotted event types and ISO dates, rejects anything else', () => {
    expect(adminAuditQuerySchema.safeParse({ action: 'admin_subscription_change.pause', from: '2026-09-01' }).success).toBe(true)
    expect(adminAuditQuerySchema.safeParse({ action: 'DROP TABLE' }).success).toBe(false)
    expect(adminAuditQuerySchema.safeParse({ from: '01.09.2026' }).success).toBe(false)
    expect(adminAuditQuerySchema.safeParse({ organization_id: 'not-a-uuid' }).success).toBe(false)
  })
})
