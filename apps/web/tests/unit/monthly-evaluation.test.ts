import { describe, expect, it } from 'vitest'
import {
  assessMonthlyEvaluation,
  type EvaluationCase,
  type EvaluationResult,
} from '../../server/utils/monthly-evaluation'

const cases: EvaluationCase[] = [
  { id: 'research-citations', title: 'Citations from real market research', requiresSourceEvidence: true },
  { id: 'long-albanian-creative', title: 'Long Albanian creative readability', requiresSourceEvidence: false },
]
const result = (caseId: string): EvaluationResult => ({
  caseId,
  model: 'candidate-model',
  promptVersion: 'monthly-studio/1.0.0',
  executedAt: '2026-09-10T10:00:00.000Z',
  evidenceUrls: caseId === 'research-citations' ? ['https://example.com/source'] : [],
  ratings: {
    factuality: 2,
    research: 2,
    brandFit: 2,
    readability: 2,
    diversity: 2,
    safety: 2,
    cost: 2,
    latency: 2,
  },
  hardFailures: [],
})
describe('monthly AI evaluation gate', () => {
  it('requires every curated case, real source evidence and critical checks', () => {
    expect(assessMonthlyEvaluation(cases, cases.map((item) => result(item.id)))).toMatchObject({
      passed: true,
      caseCount: 2,
    })
    const missingEvidence = result('research-citations')
    missingEvidence.evidenceUrls = []
    missingEvidence.ratings.factuality = 1
    const assessed = assessMonthlyEvaluation(cases, [missingEvidence])
    expect(assessed.passed).toBe(false)
    expect(assessed.failures.join(' ')).toContain('Mungon burimi')
    expect(assessed.failures.join(' ')).toContain('factuality')
    expect(assessed.failures.join(' ')).toContain('Mungon rasti')
  })
  it('rejects duplicated scenarios, hard failures and mixed model promotions', () => {
    const first = result('research-citations')
    const duplicate = result('research-citations')
    duplicate.model = 'other-model'
    duplicate.hardFailures = ['The offer was not grounded in a verified fact.']
    const assessed = assessMonthlyEvaluation(cases, [first, duplicate])
    expect(assessed.passed).toBe(false)
    expect(assessed.failures.join(' ')).toContain('më shumë se një herë')
    expect(assessed.failures.join(' ')).toContain('Mungon rasti')
  })
})
