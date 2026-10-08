import { describe, expect, it, vi } from 'vitest'
import {
  sanitizeAuditMetadata,
  transitionMetadata,
  workspaceAuditMetadata,
  workspaceChangedFields,
} from '../../server/utils/audit'
import { createDemo } from '../fixtures/workspace'

vi.stubGlobal('createError', ({ message }: { message: string }) => new Error(message))

describe('audit metadata sanitization', () => {
  it('keeps small, non-sensitive metadata intact', () => {
    expect(sanitizeAuditMetadata({ brandId: 'brand-1', affectedPosts: 2, enabled: true })).toEqual({
      brandId: 'brand-1',
      affectedPosts: 2,
      enabled: true,
    })
  })

  it.each([
    { accessToken: 'should-not-be-stored' },
    { nested: { refresh_token: 'should-not-be-stored' } },
    { note: 'Bearer abcdefghijklmnopqrstuvwxyz' },
    { note: 'eyJhbGciOiJIUzI1NiJ9.payload.signature' },
  ])('rejects sensitive metadata: %o', (metadata) => {
    expect(() => sanitizeAuditMetadata(metadata)).toThrow('server.AUDIT_SENSITIVE_DATA')
  })
})

describe('workspace audit metadata', () => {
  it('identifies a business-name change', () => {
    const current = createDemo()
    const input = createDemo()
    input.brand.name = 'Emri i ri i biznesit'

    expect(workspaceChangedFields(current, input)).toEqual(['business_name'])
  })

  it('records before and after for safe business-profile fields', () => {
    const current = createDemo()
    const input = createDemo()
    input.brand.name = 'Emri i ri i biznesit'
    input.brand.city = 'Rahovec'

    expect(workspaceAuditMetadata(current, input)).toEqual({
      changedFields: ['business_name', 'brand_profile'],
      changes: {
        business_name: {
          before: 'Mulliri i Lagjes',
          after: 'Emri i ri i biznesit',
        },
        city: {
          before: 'Prishtinë',
          after: 'Rahovec',
        },
      },
    })
  })

  it('groups other workspace changes into safe categories', () => {
    const current = createDemo()
    const input = createDemo()
    input.brand.description = 'Përshkrim i ri privat'
    input.posts[0]!.caption = 'Përmbajtje e ndryshuar'

    expect(workspaceChangedFields(current, input)).toEqual(['brand_profile', 'posts'])
  })

  it('does not create metadata for a save without a workspace change', () => {
    const current = createDemo()
    expect(workspaceAuditMetadata(current, createDemo())).toEqual({})
  })

  it('records a calendar removal as a status and schedule transition', () => {
    expect(transitionMetadata({
      status: ['scheduled', 'approved'],
      scheduled_at: ['2026-09-15T10:00:00.000Z', null],
    })).toEqual({
      changedFields: ['status', 'scheduled_at'],
      changes: {
        status: { before: 'scheduled', after: 'approved' },
        scheduled_at: { before: '2026-09-15T10:00:00.000Z', after: null },
      },
    })
  })

  it('records a calendar schedule as a status and schedule transition', () => {
    expect(transitionMetadata({
      status: ['approved', 'scheduled'],
      scheduled_at: [null, '2026-09-15T10:00:00.000Z'],
    })).toEqual({
      changedFields: ['status', 'scheduled_at'],
      changes: {
        status: { before: 'approved', after: 'scheduled' },
        scheduled_at: { before: null, after: '2026-09-15T10:00:00.000Z' },
      },
    })
  })
})
