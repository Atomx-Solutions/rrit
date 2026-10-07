import { describe, expect, it } from 'vitest'
import { buildVideoCreativePlan } from '../../server/utils/video-plan'
import { postVideoPrompt } from '../../server/utils/monthly-ai'

const baseBrief = {
  status: 'brief_ready' as const,
  sourceAssetIds: ['00000000-0000-4000-8000-000000000001'],
  hook: 'Nise ditën me kafen tonë',
  overlays: [],
  cta: 'Vizito sot',
  durationSeconds: 8,
  format: '1080x1920' as const,
  intent: 'inspire' as const,
  purpose: 'Fto audiencën lokale të fillojë mëngjesin këtu',
  assetDirection: 'Këndvështrim i ngushtë mbi tasin e kafes',
  visualLayout: 'focal-subject-centre, warm-golden-light',
  createdAt: '2026-11-01T09:00:00.000Z',
}
const baseBrand = { name: 'Rrit', industry: 'kafene', audience: 'urbanë', voice: 'ngrohtë', color: '#AA3344' }
const basePost = { channel: 'Instagram' as const, title: 't', caption: 'c', pillar: 'p' }

describe('buildVideoCreativePlan', () => {
  it('returns a plan with 3 beats whose weights sum to 1 for an 8s clip', () => {
    const plan = buildVideoCreativePlan({ brief: baseBrief, brand: baseBrand, locale: 'sq-XK', durationSeconds: 8 })
    expect(plan.timeline).toHaveLength(3)
    const sum = plan.timeline.reduce((acc, beat) => acc + beat.weight, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(0.001)
    expect(plan.timeline.map((beat) => beat.role)).toEqual(['hook', 'body', 'cta'])
  })
  it('collapses to 2 beats for a 6s clip and expands to 4 beats for a 14s clip', () => {
    const short = buildVideoCreativePlan({ brief: baseBrief, brand: baseBrand, durationSeconds: 6 })
    expect(short.timeline).toHaveLength(2)
    const long = buildVideoCreativePlan({ brief: baseBrief, brand: baseBrand, durationSeconds: 14 })
    expect(long.timeline).toHaveLength(4)
    expect(long.timeline.at(-1)?.role).toBe('endcard')
  })
  it('uses the strategy shot when present and the safe fallback when absent', () => {
    const withShot = buildVideoCreativePlan({
      brief: {
        ...baseBrief,
        shot: { camera: 'arc', pacing: 'punchy', subjectAnchor: 'left', textZone: 'right' },
      },
      brand: baseBrand,
      durationSeconds: 8,
    })
    expect(withShot.shot.camera).toBe('arc')
    expect(withShot.shot.textZone).toBe('right')
    const noShot = buildVideoCreativePlan({ brief: baseBrief, brand: baseBrand, durationSeconds: 8 })
    expect(noShot.shot.camera).toBe('slow_push')
    expect(noShot.shot.subjectAnchor).toBe('centre')
    expect(noShot.shot.textZone).toBe('bottom')
  })
  it('propagates locale, hook, cta and brand color onto the plan', () => {
    const plan = buildVideoCreativePlan({ brief: baseBrief, brand: baseBrand, locale: 'de-DE', durationSeconds: 8 })
    expect(plan.typography.language).toBe('de-DE')
    expect(plan.typography.hook).toBe(baseBrief.hook)
    expect(plan.typography.cta).toBe(baseBrief.cta)
    expect(plan.branding.primaryColor).toBe('#AA3344')
    expect(plan.branding.logoAssetId).toBeNull()
  })
  it('derives a non-empty concept from purpose and visual layout', () => {
    const plan = buildVideoCreativePlan({ brief: baseBrief, brand: baseBrand, durationSeconds: 8 })
    expect(plan.concept).toContain('Fto audiencën')
    expect(plan.concept).toContain('focal-subject-centre')
  })
})

describe('postVideoPrompt with a VideoCreativePlan', () => {
  it('templates the shot direction, timeline beats and labels into the prompt', () => {
    const plan = buildVideoCreativePlan({ brief: baseBrief, brand: baseBrand, locale: 'sq-XK', durationSeconds: 8 })
    const prompt = postVideoPrompt({ brand: baseBrand, post: basePost, brief: baseBrief, locale: 'sq-XK', plan })
    expect(prompt).toContain('Shot direction')
    expect(prompt).toContain('a single slow push') // default camera label
    expect(prompt).toContain('measured')
    expect(prompt).toContain('text-safe zone is the bottom')
    // Timeline lines reference actual seconds derived from durationSeconds.
    expect(prompt).toMatch(/hook \(0\.0s–2\.0s\)/)
    expect(prompt).toMatch(/body \(2\.0s–6\.0s\)/)
    expect(prompt).toMatch(/cta \(6\.0s–8\.0s\)/)
    // Still enforces exact-copy and stability from Phase 2+3.
    expect(prompt).toContain('Never translate')
    expect(prompt).toContain('Overlay stability contract')
    // Falls through the plan-aware cinematography line, not the generic one.
    expect(prompt).toContain('Carry the single camera idea named in the shot direction above')
    expect(prompt).not.toContain('a slow push, a gentle parallax drift, a restrained handheld settle or a single arc')
  })
  it('still works without a plan (legacy caller path)', () => {
    const prompt = postVideoPrompt({ brand: baseBrand, post: basePost, brief: baseBrief, locale: 'sq-XK' })
    expect(prompt).toContain('Hook: "Nise ditën me kafen tonë"')
    expect(prompt).not.toContain('Shot direction')
    expect(prompt).not.toContain('Timeline for this')
  })
})
