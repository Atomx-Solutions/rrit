import { describe, expect, it, vi } from 'vitest'

vi.mock('../../server/utils/admin-supabase', () => ({ adminServiceClient: vi.fn() }))

const { customPackageChangesSchema } = await import('../../server/utils/admin-custom-packages')

describe('package gift', () => {
  it('needs a reason when a change is given as a gift', () => {
    expect(customPackageChangesSchema.safeParse({ credit_top_up: 500, gift: true }).success).toBe(false)
    expect(customPackageChangesSchema.safeParse({ credit_top_up: 500, gift: true, gift_reason: 'Loyal client' }).success).toBe(true)
  })

  it('keeps an ordinary change invoiced', () => {
    expect(customPackageChangesSchema.safeParse({ credit_top_up: 500 }).success).toBe(true)
  })
})

describe('package addition', async () => {
  const { packageAdditionSchema } = await import('../../server/utils/admin-custom-packages')

  it('adds something, and a gift says why', () => {
    expect(packageAdditionSchema.safeParse({}).success).toBe(false)
    expect(packageAdditionSchema.safeParse({ credits: 100 }).success).toBe(true)
    expect(packageAdditionSchema.safeParse({ videos: 2, gift: true }).success).toBe(false)
    expect(packageAdditionSchema.safeParse({ videos: 2, gift: true, reason: 'Loyal client' }).success).toBe(true)
  })
})
