import { describe, expect, it } from 'vitest'
import { brandCreateSchema, brandResponseSchema, isIanaTimezone } from '../../shared/schemas/brand'

const validBrand = {
  name: 'Brand A',
  slug: 'brand-a',
  timezone: 'Europe/Tirane',
  locale: 'sq-XK',
  category: 'cafe',
}

describe('brand domain contract', () => {
  it('accepts a complete active brand and supplies profile/settings defaults', () => {
    const parsed = brandCreateSchema.parse(validBrand)
    expect(parsed.profile.voice).toBe('')
    expect(parsed.settings.emailApprovals).toBe(true)
    expect(isIanaTimezone(parsed.timezone)).toBe(true)
  })

  it('rejects an invalid timezone', () => {
    expect(brandCreateSchema.safeParse({ ...validBrand, timezone: 'Not/A_Timezone' }).success).toBe(
      false,
    )
  })

  it('models archived state separately from active state', () => {
    const archived = brandResponseSchema.safeParse({
      ...validBrand,
      id: '00000000-0000-4000-8000-000000000001',
      organizationId: '00000000-0000-4000-8000-000000000002',
      revision: 1,
      status: 'archived',
      archivedAt: '2026-09-10T10:00:00.000Z',
      createdAt: '2026-09-10T09:00:00.000Z',
      updatedAt: '2026-09-10T10:00:00.000Z',
    })
    expect(archived.success).toBe(true)
  })
})
