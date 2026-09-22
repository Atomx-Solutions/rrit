import { describe, expect, it } from 'vitest'
import { adminAiCostsQuerySchema, adminAiCostsRange } from '../../server/utils/admin-ai-costs'

const now = new Date('2026-09-21T12:00:00Z')

describe('admin AI costs range', () => {
  it('defaults to the current month up to and including today', () => {
    expect(adminAiCostsRange({}, now)).toEqual({
      from: new Date('2026-09-01T00:00:00Z'),
      toExclusive: new Date('2026-09-22T00:00:00Z'),
    })
  })

  it('includes the whole last day', () => {
    expect(adminAiCostsRange({ from: '2026-09-10', to: '2026-09-10' }, now)?.toExclusive)
      .toEqual(new Date('2026-09-11T00:00:00Z'))
  })

  it.each([
    [{ from: '2026-09-20', to: '2026-09-10' }],
    [{ from: '2024-01-01', to: '2026-09-10' }],
  ])('rejects %o', (query) => {
    expect(adminAiCostsRange(query, now)).toBeNull()
  })

  it('accepts only ISO dates', () => {
    expect(adminAiCostsQuerySchema.safeParse({ from: '21/09/2026' }).success).toBe(false)
    expect(adminAiCostsQuerySchema.safeParse({ from: '2026-09-01' }).success).toBe(true)
  })
})

describe('real provider costs', () => {
  it('converts the provider charge from USD and keeps a free call at zero', async () => {
    const { providerCostMicroEur } = await import('../../server/utils/ai-provider')
    expect(providerCostMicroEur(0.0224695, 861000)).toBe(19347)
    expect(providerCostMicroEur(0, 861000)).toBe(0)
  })

  it('falls back to the configured rates when no charge is reported', async () => {
    const { providerCostMicroEur } = await import('../../server/utils/ai-provider')
    expect(providerCostMicroEur(undefined, 861000)).toBeNull()
    expect(providerCostMicroEur(null, 861000)).toBeNull()
    expect(providerCostMicroEur(-1, 861000)).toBeNull()
  })

  it('fingerprints a key without revealing it', async () => {
    const { providerKeyFingerprint } = await import('../../server/utils/ai-provider')
    const fingerprint = providerKeyFingerprint('sk-or-v1-secret')
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/)
    expect(fingerprint).not.toContain('secret')
    expect(providerKeyFingerprint('sk-or-v1-other')).not.toBe(fingerprint)
  })
})
