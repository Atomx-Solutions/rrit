import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { directedTakes, videoChargeCredits } from '../../server/utils/video-takes'
import { generateStoryboardShots, ShotSubjectChanged } from '../../server/utils/video-shots'
import { estimatedVideoCredits } from '../../server/utils/video-budget'
import type { Storyboard } from '../../shared/schemas/storyboard'

function board(seconds: number[]): Storyboard {
  return {
    concept: 'An arrival and a reveal of the real car.',
    rationale: 'Premium launch for a rental fleet.',
    cta: 'Rezervo sot',
    caption: 'Rezervo sot.',
    shots: seconds.map((durationSeconds) => ({
      purpose: 'A shot of the real car.',
      durationSeconds,
      camera: { move: 'A slow rise.', lens: '35mm', speed: 'slow', ease: 'ease-in-out', rotationDegrees: 10 },
      atmosphere: 'Golden hour.',
      effects: 'none',
      subject: { motion: 'still' as const, description: 'The car holds still.' },
      opensOnPhotograph: true,
      endsOnPhotograph: true,
      showsOnlyPhotographedSides: true,
    })),
  }
}

const storyboardSeconds = (planned: Storyboard | null) => (planned ? planned.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0) : 6)

function steps(takes: Array<'ok' | 'changed'>, options: { affordable?: boolean } = {}) {
  const calls: { calmer: boolean; mode: string }[] = []
  const directed: Array<string | undefined> = []
  const reserved: number[] = []
  let call = 0
  return {
    calls,
    directed,
    reserved,
    steps: {
      direct: vi.fn(async (previous?: { problem: string }) => {
        directed.push(previous?.problem)
        return { storyboard: board([4, 8]), costUsd: 0.002 }
      }),
      seconds: storyboardSeconds,
      reserve: vi.fn(async (seconds: number) => {
        reserved.push(seconds)
      }),
      retryAffordable: () => options.affordable ?? true,
      take: vi.fn(async (_storyboard: Storyboard | null, calmer: boolean, mode: 'stop' | 'record') => {
        calls.push({ calmer, mode })
        const outcome = takes[call++]
        if (outcome === 'changed' && mode === 'stop') throw new ShotSubjectChanged(2, 'different wheels')
        return { subjectChanges: outcome === 'changed' ? [{ shot: 2, reason: 'different wheels' }] : [] }
      }),
    },
  }
}

describe('directing and shooting a video', () => {
  it('delivers the first take when the subject held', async () => {
    const run = steps(['ok'])
    const result = await directedTakes(run.steps)
    expect(result.attempts).toBe(1)
    expect(run.calls).toEqual([{ calmer: false, mode: 'stop' }])
    expect(result.result.subjectChanges).toEqual([])
  })

  it('object changes, then a calmer take is directed and delivered', async () => {
    const run = steps(['changed', 'ok'])
    const result = await directedTakes(run.steps)
    expect(result.attempts).toBe(2)
    expect(run.directed).toEqual([undefined, 'Shot 2: different wheels'])
    expect(run.calls).toEqual([{ calmer: false, mode: 'stop' }, { calmer: true, mode: 'record' }])
    expect(result.result.subjectChanges).toEqual([])
  })

  it('object changes twice: the second take is still delivered, with what the check saw', async () => {
    const run = steps(['changed', 'changed'])
    const result = await directedTakes(run.steps)
    expect(result.attempts).toBe(2)
    expect(result.result.subjectChanges).toEqual([{ shot: 2, reason: 'different wheels' }])
  })

  it('delivers the first take as the last when a second could not be paid for', async () => {
    const run = steps(['changed'], { affordable: false })
    const result = await directedTakes(run.steps)
    expect(result.attempts).toBe(1)
    expect(run.calls).toEqual([{ calmer: false, mode: 'record' }])
    expect(result.result.subjectChanges).toHaveLength(1)
  })

  it('reserves each take before shooting it and never starts one that cannot be paid for', async () => {
    const run = steps(['changed', 'ok'])
    await directedTakes(run.steps)
    expect(run.reserved).toEqual([12, 12])
    const broke = steps(['ok'])
    broke.steps.reserve = vi.fn(async () => {
      throw new Error('CREDITS_EXHAUSTED')
    })
    await expect(directedTakes(broke.steps)).rejects.toThrow('CREDITS_EXHAUSTED')
    expect(broke.steps.take).not.toHaveBeenCalled()
  })

  it('charges what every director call cost', async () => {
    const run = steps(['changed', 'ok'])
    expect((await directedTakes(run.steps)).directionCostUsd).toBeCloseTo(0.004)
  })
})

describe('charging a multi-shot video', () => {
  // 0.10 USD a second; 1 USD = 900 000 micro-EUR; a credit pays 10 000 micro-EUR.
  const rates = { pricePerSecondUsd: 0.1, usdMicroEur: 900_000, providerCostPerCreditMicroEur: 10_000 }

  it('charges the real cost of every shot and check, matching the estimate it reserved', async () => {
    const photo = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#335577' } }).jpeg().toBuffer()
    const costs: (number | null)[] = []
    const shots = await generateStoryboardShots({
      storyboard: board([4, 8]),
      fitted: photo,
      provider: { canvas: { width: 1080, height: 1920 }, aspectRatio: '9:16' },
      lastFrameSupported: true,
    }, {
      // Each shot costs its seconds at 0.10 USD; each check costs nothing here.
      generate: vi.fn(async (request: { durationSeconds: number }) => ({ bytes: Buffer.from('clip'), costUsd: request.durationSeconds * 0.1 })) as never,
      verify: vi.fn(async () => ({ sameSubject: true, reason: 'same', costUsd: 0 })),
      lastFrameOf: vi.fn(async () => Buffer.from('last')),
      framesOf: vi.fn(async () => [Buffer.from('f')]),
      onCost: (value) => costs.push(value),
    })
    expect(shots.costUsd).toBeCloseTo(1.2)
    const charged = videoChargeCredits({ costUsd: shots.costUsd, reservedCredits: estimatedVideoCredits(12, rates), usdMicroEur: rates.usdMicroEur, providerCostPerCreditMicroEur: rates.providerCostPerCreditMicroEur })
    // 4 s + 8 s at 0.10 USD = 1.20 USD = 108 credits, exactly what was reserved.
    expect(charged).toBe(108)
    expect(estimatedVideoCredits(12, rates)).toBe(108)
  })

  it('adds the director, fit and review costs on top of the shots', () => {
    expect(videoChargeCredits({ costUsd: 1.2 + 0.004 + 0.05 + 0.003, reservedCredits: 108, usdMicroEur: 900_000, providerCostPerCreditMicroEur: 10_000 })).toBe(114)
  })

  it('charges the reservation when the provider reported no cost', () => {
    expect(videoChargeCredits({ costUsd: null, reservedCredits: 108, usdMicroEur: 900_000, providerCostPerCreditMicroEur: 10_000 })).toBe(108)
    expect(videoChargeCredits({ costUsd: 1.2, reservedCredits: 108, usdMicroEur: null, providerCostPerCreditMicroEur: 10_000 })).toBe(108)
  })
})
