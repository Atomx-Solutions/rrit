import { describe, expect, it, vi } from 'vitest'
import { updateWorkspaceMetadata } from '../../server/utils/workspace-metadata'

vi.mock('../../server/utils/audit', () => ({ recordAuditEvent: vi.fn() }))

describe('workspace metadata resource', () => {
  it('updates only metadata and advances the workspace revision', async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ revision: 4, state: { onboarding: 1, dismissed: [], notificationsRead: false } }] })
      .mockResolvedValueOnce({ rows: [{ revision: 5, state: { onboarding: 2, dismissed: ['tip'], notificationsRead: true } }] }) }
    const result = await updateWorkspaceMetadata(client as never, {
      businessId: 'b1', userId: 'u1', input: { revision: 4, onboarding: 2, dismissed: ['tip'], notificationsRead: true },
    })
    expect(result.workspaceRevision).toBe(5)
    expect(result.metadata).toEqual({ onboarding: 2, dismissed: ['tip'], notificationsRead: true })
    expect(client.query).toHaveBeenCalledTimes(2)
    expect(client.query.mock.calls[1]![1]).toEqual([
      JSON.stringify({ onboarding: 2, dismissed: ['tip'], notificationsRead: true }), 'b1', 'u1', 4,
    ])
  })

  it('rejects stale revisions with 409 and does not write', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ revision: 5, state: {} }] }) }
    await expect(updateWorkspaceMetadata(client as never, {
      businessId: 'b1', userId: 'u1', input: { revision: 4, onboarding: 2 },
    })).rejects.toMatchObject({ statusCode: 409 })
    expect(client.query).toHaveBeenCalledTimes(1)
  })

  it('returns 404 when the workspace is not owned by the user', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) }
    await expect(updateWorkspaceMetadata(client as never, {
      businessId: 'other-business', userId: 'u1', input: { revision: 1, onboarding: 2 },
    })).rejects.toMatchObject({ statusCode: 404 })
  })
})
