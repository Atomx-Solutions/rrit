import { describe, expect, it } from 'vitest'
import {
  businessBrainFactSchema,
  createFactSchema,
  createOfferSchema,
  updateBrainSchema,
} from '../../shared/schemas/business-brain'

const ids = {
  brand: '11111111-1111-4111-8111-111111111111',
  fact: '22222222-2222-4222-8222-222222222222',
}

describe('Business Brain contracts', () => {
  it('accepts a proposed fact with provenance and confidence', () => {
    const result = createFactSchema.safeParse({
      kind: 'candidate',
      text: 'Servisi punon edhe te shtunave.',
      source: 'Intervistë me biznesin',
      sourceType: 'manual',
      confidence: 0.75,
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid confidence and missing provenance', () => {
    expect(createFactSchema.safeParse({ kind: 'candidate', text: 'Fakt', source: '', confidence: 1.2 }).success).toBe(false)
  })

  it('models verified and rejected states explicitly', () => {
    const result = businessBrainFactSchema.safeParse({
      id: ids.fact,
      brandId: ids.brand,
      kind: 'candidate',
      status: 'verified',
      text: 'Fakt i verifikuar.',
      source: 'Dokument i biznesit',
      sourceUrl: null,
      sourceType: 'import',
      confidence: 0.98,
      version: 2,
      createdAt: '2026-09-11T10:00:00.000Z',
      updatedAt: '2026-09-11T10:05:00.000Z',
      verifiedAt: '2026-09-11T10:05:00.000Z',
      verifiedBy: ids.brand,
      rejectedAt: null,
      rejectedBy: null,
    })
    expect(result.success).toBe(true)
  })

  it('requires valid offer dates and a supported currency', () => {
    expect(createOfferSchema.safeParse({
      name: 'Zbritje', description: 'Oferta e verifikuar', currency: 'EUR', amount: 10,
      validFrom: '2026-09-11', validUntil: '2026-09-30', source: 'Lista e çmimeve', confidence: 1,
    }).success).toBe(true)
    expect(createOfferSchema.safeParse({
      name: 'Zbritje', description: '', currency: 'USD', amount: 10,
      validFrom: '2026-09-11', source: 'Manual', confidence: 1,
    }).success).toBe(false)
  })

  it('requires a revision for Business Brain settings writes', () => {
    expect(updateBrainSchema.safeParse({ voice: { text: 'Informativ', source: 'Manual' }, audiences: [], guardrails: [] }).success).toBe(false)
  })
})
