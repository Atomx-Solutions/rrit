import { describe, expect, it, vi } from 'vitest'
import { onboardingAiImprovements } from '../../server/utils/monthly-planner-domain'
import {
  briefImprovementInstructions,
  takeBriefImprovement,
} from '../../server/utils/onboarding-brief'

describe('free brief improvements', () => {
  it('reads the allowance from the environment and keeps the default otherwise', () => {
    expect(onboardingAiImprovements({ ONBOARDING_AI_IMPROVEMENTS: '8' })).toBe(8)
    expect(onboardingAiImprovements({ ONBOARDING_AI_IMPROVEMENTS: '0' })).toBe(onboardingAiImprovements({}))
  })

  it('reports what is left after one is taken, and nothing once all are used', async () => {
    const limit = onboardingAiImprovements()
    const used = { query: vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ used: 2 }] })) }
    await expect(takeBriefImprovement(used as never, 'user')).resolves.toBe(limit - 2)
    const none = { query: vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] })) }
    await expect(takeBriefImprovement(none as never, 'user')).resolves.toBeNull()
  })
})

describe('brief improvement prompt', () => {
  it('never lets the model add to a fact', () => {
    const prompt = briefImprovementInstructions('fact', 'en-US')
    expect(prompt).toContain('never add, change or guess a price')
    expect(prompt).toContain('untrusted data')
  })

  it('lets the description and audience grow on topic without new claims', () => {
    const description = briefImprovementInstructions('description', 'en-US')
    expect(description).toContain('deepen it')
    expect(description).toContain('never introduce another product or service')
    expect(description).toContain('a price')
    expect(briefImprovementInstructions('audience', 'en-US')).toContain('instead of rewording')
  })

  it('writes in the language of the screen', () => {
    expect(briefImprovementInstructions('description', 'sq-XK')).toContain('Albanian')
  })
})
