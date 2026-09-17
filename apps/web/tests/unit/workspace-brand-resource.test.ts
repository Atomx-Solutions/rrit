import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { brandResponseSchema } from '../../shared/schemas/brand'
import type { Workspace } from '../../shared/schemas/workspace'
import { createDemo } from '../fixtures/workspace'

const organizationId = 'f0297959-5015-49c4-9eb4-e59e4fb27a46'
const brandId = '04a3b6af-e3f6-44de-b823-bbc64181d80c'

function canonicalBrand(workspace: Workspace, revision = 7) {
  return brandResponseSchema.parse({
    id: brandId,
    organizationId,
    revision,
    slug: 'mulliri-i-lagjes',
    name: workspace.brand.name,
    profile: workspace.brand,
    settings: { emailApprovals: true, emailPublished: true, emailTips: false },
    timezone: 'Europe/Belgrade',
    locale: 'sq-XK',
    category: workspace.brand.industry,
    status: workspace.brand.status || 'active',
    archivedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-16T10:00:00.000Z',
  })
}

describe('canonical Brand profile contract', () => {
  it('preserves the existing workspace Brand evidence fields instead of stripping them', () => {
    const parsed = brandResponseSchema.parse({
      id: '04a3b6af-e3f6-44de-b823-bbc64181d80c',
      organizationId: 'f0297959-5015-49c4-9eb4-e59e4fb27a46',
      revision: 7,
      slug: 'mulliri-i-lagjes',
      name: 'Mulliri i Lagjes',
      profile: {
        description: 'Përshkrimi i biznesit',
        voice: 'Miqësor',
        audience: 'Klientë lokalë',
        industry: 'Kafene',
        city: 'Prishtinë',
        color: '#17694d',
        facebookUrl: '',
        instagramUrl: '',
        goals: ['Rrit njohjen'],
        researchSources: ['https://business.example/menu'],
        guardrails: ['Mos premto rezultate të garantuara.'],
        brainVersion: 4,
        facts: [
          {
            id: 'offer-1',
            text: 'Oferta kushton 2.50 EUR.',
            source: 'Menuja zyrtare',
            verified: true,
            kind: 'offer',
            validFrom: '2026-09-16',
            validUntil: '2026-09-30',
            amountCents: 250,
            currency: 'EUR',
            state: 'verified',
            confidence: 1,
            origin: 'user',
            verifiedAt: '2026-09-16T10:00:00.000Z',
            verifiedBy: '1c804374-0be9-4a68-aa45-7273c0b35d9b',
            revision: 2,
          },
        ],
      },
      settings: { emailApprovals: true, emailPublished: true, emailTips: false },
      timezone: 'Europe/Belgrade',
      locale: 'sq-XK',
      category: 'Kafene',
      status: 'active',
      archivedAt: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-16T10:00:00.000Z',
    })

    expect(parsed.profile).toMatchObject({
      researchSources: ['https://business.example/menu'],
      guardrails: ['Mos premto rezultate të garantuara.'],
      brainVersion: 4,
      facts: [
        {
          id: 'offer-1',
          kind: 'offer',
          amountCents: 250,
          validUntil: '2026-09-30',
          revision: 2,
        },
      ],
    })
  })
})

describe('workspace Brand resource flow', () => {
  const states = new Map<string, ReturnType<typeof ref>>()

  beforeEach(() => {
    states.clear()
    vi.resetModules()
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
    vi.stubGlobal('useState', (key: string, init: () => unknown) => {
      if (!states.has(key)) states.set(key, ref(init()))
      return states.get(key)
    })
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('getCurrentInstance', () => null)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('projects the canonical Brand into local workspace state during bootstrap', async () => {
    const stale = createDemo()
    stale.brandRevision = 2
    stale.brand.status = 'active'
    const canonical = canonicalBrand(stale, 7)
    canonical.name = 'Emri canonical'
    canonical.profile.city = 'Gjakovë'

    const { useWorkspace } = await import('../../app/composables/useWorkspace')
    const workspace = useWorkspace()
    workspace.applyBusiness({
      id: organizationId,
      slug: 'mulliri-i-lagjes',
      workspace: stale,
      brand: canonical,
    })

    expect(workspace.data.value.brand.name).toBe('Emri canonical')
    expect(workspace.data.value.brand.city).toBe('Gjakovë')
    expect(workspace.data.value.brandRevision).toBe(7)
    expect(workspace.data.value.posts).toEqual(stale.posts)
    expect(workspace.data.value.assets).toEqual(stale.assets)
  })

  it('updates Brand through its resource endpoint with only a Brand payload and applies the response locally', async () => {
    const initial = createDemo()
    initial.brandRevision = 7
    initial.brand.status = 'active'
    initial.brand.researchSources = ['https://business.example/menu']
    initial.brand.guardrails = ['Mos premto rezultate të garantuara.']
    initial.brand.brainVersion = 4
    initial.brand.facts[0] = {
      ...initial.brand.facts[0]!,
      kind: 'offer',
      validFrom: '2026-09-16',
      validUntil: '2026-09-30',
      amountCents: 250,
      currency: 'EUR',
      revision: 2,
    }
    const canonical = canonicalBrand(initial)
    const edited = structuredClone(initial.brand)
    edited.name = 'Mulliri i Ri'
    edited.city = 'Prizren'
    const saved = brandResponseSchema.parse({
      ...canonical,
      revision: 8,
      name: edited.name,
      category: edited.industry,
      profile: edited,
      updatedAt: '2026-09-16T11:00:00.000Z',
    })
    const fetchMock = vi.fn().mockResolvedValue(saved)
    vi.stubGlobal('$fetch', fetchMock)

    const { useWorkspace } = await import('../../app/composables/useWorkspace')
    const workspace = useWorkspace()
    workspace.applyBusiness({
      id: organizationId,
      slug: 'mulliri-i-lagjes',
      workspace: initial,
      brand: canonical,
    })

    await expect(workspace.saveBrand(edited)).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/organizations/${organizationId}/brands/${brandId}`,
      {
        method: 'PUT',
        body: {
          revision: 7,
          name: 'Mulliri i Ri',
          category: 'Kafene & gastronomi',
          status: 'active',
          profile: {
            description: initial.brand.description,
            voice: initial.brand.voice,
            audience: initial.brand.audience,
            industry: 'Kafene & gastronomi',
            city: 'Prizren',
            color: '#17694d',
            facebookUrl: '',
            instagramUrl: '',
            goals: ['Rrit njohjen e biznesit'],
            researchSources: ['https://business.example/menu'],
            facts: initial.brand.facts,
            guardrails: ['Mos premto rezultate të garantuara.'],
            brainVersion: 4,
          },
        },
        retry: 0,
        timeout: 30000,
      },
    )
    expect(workspace.canonicalBrand.value).toEqual(saved)
    expect(workspace.data.value.brand).toEqual(edited)
    expect(workspace.data.value.brandRevision).toBe(8)
    expect(workspace.data.value.revision).toBe(1)
  })

  it('keeps local Brand state unchanged and exposes a stale revision conflict', async () => {
    const initial = createDemo()
    initial.brandRevision = 7
    initial.brand.status = 'active'
    const canonical = canonicalBrand(initial)
    vi.stubGlobal(
      '$fetch',
      vi.fn().mockRejectedValue({ statusCode: 409, data: { message: 'Revision conflict' } }),
    )
    const { useWorkspace } = await import('../../app/composables/useWorkspace')
    const workspace = useWorkspace()
    workspace.applyBusiness({
      id: organizationId,
      slug: 'mulliri-i-lagjes',
      workspace: initial,
      brand: canonical,
    })
    const edited = { ...initial.brand, name: 'Emër konfliktues' }

    await expect(workspace.saveBrand(edited)).resolves.toBe(false)
    expect(workspace.conflict.value).toBe(true)
    expect(workspace.canonicalBrand.value).toEqual(canonical)
    expect(workspace.data.value.brand.name).toBe('Mulliri i Lagjes')
    expect(workspace.data.value.brandRevision).toBe(7)
  })
})
