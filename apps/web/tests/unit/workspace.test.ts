import { describe, it, expect } from 'vitest'
import { createDemo } from '../fixtures/workspace'
import {
  workspaceSchema,
  validateTransition,
  permittedEventCategories,
} from '../../shared/schemas/workspace'
import { safeRedirect, zonedToIso, formatMoney } from '../../shared/utils/format'
import { channelFormatCapability } from '../../shared/utils/content-formats'
describe('workspace invariants', () => {
  it('validates the demonstration fixture', () => {
    expect(workspaceSchema.safeParse(createDemo()).success).toBe(true)
  })
  it('prevents blocked commercial content from approval', () => {
    const post = createDemo().posts.find((p) => p.policy === 'block')!
    expect(validateTransition(post, 'approved')).toContain('Mungon')
  })
  it('does not allow skipping approval to schedule', () => {
    const post = createDemo().posts.find((p) => p.status === 'draft')!
    expect(validateTransition(post, 'scheduled')).not.toBeNull()
  })
  it('supports review, approval, schedule and unschedule', () => {
    const post = createDemo().posts[0]!
    expect(validateTransition(post, 'approved')).toBeNull()
    post.status = 'approved'
    expect(validateTransition(post, 'scheduled')).toBeNull()
    post.status = 'scheduled'
    expect(validateTransition(post, 'approved')).toBeNull()
  })
  it('does not allow a local command to claim a publication', () => {
    const post = createDemo().posts[0]!
    post.status = 'scheduled'
    expect(validateTransition(post, 'published')).not.toBeNull()
  })
  it('allows a failed publication to be rechecked or returned to draft', () => {
    const post = createDemo().posts[0]!
    post.status = 'failed'
    post.policy = 'warn'
    expect(validateTransition(post, 'approved')).toBeNull()
    expect(validateTransition(post, 'draft')).toBeNull()
    expect(validateTransition(post, 'scheduled')).not.toBeNull()
  })
  it('rejects corrupt persisted state', () => {
    const data = createDemo()
    expect(workspaceSchema.safeParse({ ...data, posts: [{ id: 'incomplete' }] }).success).toBe(
      false,
    )
  })
  it('uses one channel-format registry before validation or publishing', () => {
    expect(channelFormatCapability('Facebook', 'static').supported).toBe(true)
    expect(channelFormatCapability('Instagram', 'static').mediaFit).toBe('natural')
    expect(channelFormatCapability('Instagram', 'carousel').supported).toBe(false)
  })
})
describe('Albanian localization and time', () => {
  it('uses Tirana summer time, independent of browser zone', () => {
    expect(zonedToIso('2026-09-08T10:00', 'Europe/Tirane')).toBe('2026-09-08T08:00:00.000Z')
  })
  it('uses Tirana winter time', () => {
    expect(zonedToIso('2026-12-08T10:00', 'Europe/Tirane')).toBe('2026-12-08T09:00:00.000Z')
  })
  it('rejects nonexistent and ambiguous DST wall times', () => {
    expect(zonedToIso('2026-03-29T02:30', 'Europe/Tirane')).toBeNull()
    expect(zonedToIso('2026-10-25T02:30', 'Europe/Tirane')).toBeNull()
  })
  it('rejects malformed dates', () => {
    expect(zonedToIso('oops', 'Europe/Tirane')).toBeNull()
    expect(zonedToIso('2026-02-30T10:00', 'Europe/Tirane')).toBeNull()
  })
  it('formats euro prices without rounding away fractional amounts', () => {
    expect(formatMoney(19)).toContain('19')
    expect(formatMoney(19)).toContain('€')
    expect(formatMoney(19 * 0.8)).toContain('15,2')
  })
  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/%2f%2fevil.example',
    '/app\nLocation: evil',
  ])('rejects unsafe redirect %s', (value) => {
    expect(safeRedirect(value)).toBe('/app')
  })
  it('keeps safe internal routes', () => {
    expect(safeRedirect('/app/demo/mulliri/content')).toBe('/app/demo/mulliri/content')
  })
})

describe('event research permissions', () => {
  it('leaves event research off for a workspace saved before the permission existed', () => {
    const stored = createDemo() as Record<string, unknown>
    delete (stored.brand as Record<string, unknown>).eventResearch
    const parsed = workspaceSchema.parse(stored)
    expect(parsed.brand.eventResearch.enabled).toBe(false)
    // The categories still carry a usable default, so enabling the switch is
    // one click rather than four.
    expect(parsed.brand.eventResearch.categories).toEqual({
      publicEvents: true,
      seasonalEvents: true,
      industryTrends: true,
    })
    expect(permittedEventCategories(parsed.brand.eventResearch)).toEqual([])
  })
  it('permits only the categories the business left on', () => {
    expect(
      permittedEventCategories({
        enabled: true,
        categories: { publicEvents: true, seasonalEvents: false, industryTrends: true },
      }),
    ).toEqual(['publicEvents', 'industryTrends'])
  })
  it('permits nothing when the switch is on but every category is off', () => {
    expect(
      permittedEventCategories({
        enabled: true,
        categories: { publicEvents: false, seasonalEvents: false, industryTrends: false },
      }),
    ).toEqual([])
  })
  it('permits nothing when the master switch is off', () => {
    expect(
      permittedEventCategories({
        enabled: false,
        categories: { publicEvents: true, seasonalEvents: true, industryTrends: true },
      }),
    ).toEqual([])
  })
})
