import { describe, expect, it } from 'vitest'
import { goalsInstructionFor } from '../../server/utils/monthly-ai'

describe('brand goals instruction', () => {
  it('tells planning to build the month around the goals it receives', () => {
    const instruction = goalsInstructionFor('planning', { evidence: { brand: { goals: ['Gjej klientë të rinj'] } } })
    expect(instruction).toContain('evidence.brand.goals')
  })

  it('tells research to aim at the goals in the brand it receives', () => {
    expect(goalsInstructionFor('research', { brand: { goals: ['Gjej klientë të rinj'] } })).toContain('brand.goals')
  })

  it('stays silent when there are no goals or the stage has no use for them', () => {
    expect(goalsInstructionFor('planning', { evidence: { brand: { goals: [] } } })).toBe('')
    expect(goalsInstructionFor('planning', { evidence: { brand: { goals: ['  '] } } })).toBe('')
    expect(goalsInstructionFor('research', {})).toBe('')
    expect(goalsInstructionFor('content', { brand: { goals: ['Gjej klientë të rinj'] } })).toBe('')
  })
})
