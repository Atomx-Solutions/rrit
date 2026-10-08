import { describe, expect, it } from 'vitest'
import { buildVideoCreativePlan } from '../../server/utils/video-plan'
import { buildVideoExecutionBrief } from '../../server/utils/video-execution-brief'

const brief = {
  status: 'brief_ready' as const,
  sourceAssetIds: ['00000000-0000-4000-8000-000000000001'],
  hook: 'Approved hook',
  overlays: [],
  cta: 'Approved CTA',
  durationSeconds: 8,
  format: '1080x1920' as const,
  purpose: 'Reach local families because research says they respond to calm scenes',
  assetDirection: 'Keep the real coffee cup in close detail; steam rises naturally; because the audience likes warmth',
  visualLayout: 'Cup on the right with empty space on the left; headline at the top; different from other posts',
  createdAt: '2026-10-07T09:00:00.000Z',
}

function makePrompt(shot: { camera: 'slow_push' | 'arc'; pacing: 'measured' | 'punchy'; subjectAnchor: 'right' | 'left'; textZone: 'left' | 'right' }, durationSeconds = 8) {
  const plan = buildVideoCreativePlan({ brief: { ...brief, shot }, brand: { color: '#aa3344' }, durationSeconds })
  return buildVideoExecutionBrief({
    plan,
    sourceContext: { assetDirection: brief.assetDirection, visualLayout: brief.visualLayout },
    durationSeconds,
    guardrails: ['Do not show alcohol'],
  })
}

describe('buildVideoExecutionBrief', () => {
  it('keeps the physical subject, shot, composition, timing and guardrail while removing rationale and copy', () => {
    const prompt = makePrompt({ camera: 'slow_push', pacing: 'measured', subjectAnchor: 'right', textZone: 'left' })
    expect(prompt).toContain('real coffee cup in close detail')
    expect(prompt).toContain('steam rises naturally')
    expect(prompt).toContain('One slow push')
    expect(prompt).toContain('anchored right')
    expect(prompt).toContain('negative space toward the left')
    expect(prompt).toContain('0s-2s:')
    expect(prompt).toContain('2s-6s:')
    expect(prompt).toContain('6s-8s:')
    expect(prompt).toContain('Do not show alcohol')
    expect(prompt).not.toContain('research says')
    expect(prompt).not.toContain('audience likes')
    expect(prompt).not.toContain('headline at the top')
    expect(prompt).not.toContain('Approved hook')
    expect(prompt).not.toContain('Approved CTA')
    expect(prompt).toContain('Do not generate hook or CTA typography')
    expect(prompt).toContain('business name, logos, new signage or an end-card')
    expect(prompt).toContain('letterboxing or black bars')
    expect(prompt.length).toBeLessThan(2200)
  })

  it('changes camera, pacing, anchor and timing with the plan', () => {
    const first = makePrompt({ camera: 'slow_push', pacing: 'measured', subjectAnchor: 'right', textZone: 'left' })
    const second = makePrompt({ camera: 'arc', pacing: 'punchy', subjectAnchor: 'left', textZone: 'right' }, 6)
    expect(second).toContain('sideways glide across the photographed view')
    expect(second).toContain('brisk but controlled')
    expect(second).toContain('anchored left')
    expect(second).toContain('negative space toward the right')
    expect(second).toContain('0s-2.1s:')
    expect(second).toContain('2.1s-6s:')
    expect(second).not.toEqual(first)
  })
  it('omits inflected Albanian typography directions while retaining scene direction', () => {
    const plan = buildVideoCreativePlan({ brief, brand: {}, durationSeconds: 8 })
    const prompt = buildVideoExecutionBrief({
      plan,
      durationSeconds: 8,
      sourceContext: {
        assetDirection: 'Ruaj filxhanin real në plan të parë; avulli lëviz natyrshëm',
        visualLayout: 'Mbaje filxhanin djathtas; vendose tekstit sipër; tipografia të jetë e madhe',
      },
    })
    expect(prompt).toContain('Ruaj filxhanin real')
    expect(prompt).toContain('Mbaje filxhanin djathtas')
    expect(prompt).not.toContain('vendose tekstit')
    expect(prompt).not.toContain('tipografia të jetë')
  })
})
