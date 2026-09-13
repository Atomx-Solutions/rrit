import { describe, expect, it } from 'vitest'
import { recoverStoredDraft } from '../../app/composables/useDraft'

describe('draft recovery', () => {
  const initial = { name: 'Aurum Restaurant', city: 'Prishtinë' }

  it('recovers a current draft created from the same server baseline', () => {
    const raw = JSON.stringify({
      version: 2,
      baseline: JSON.stringify(initial),
      value: { ...initial, city: 'Prizren' },
    })

    expect(recoverStoredDraft(raw, initial)).toEqual({
      name: 'Aurum Restaurant',
      city: 'Prizren',
    })
  })

  it('rejects a draft after the server business profile changes', () => {
    const raw = JSON.stringify({
      version: 2,
      baseline: JSON.stringify({ name: 'TUZZ', city: 'Prishtinë' }),
      value: { name: 'TUZZ', city: 'Prizren' },
    })

    expect(recoverStoredDraft(raw, initial)).toBeNull()
  })

  it('rejects legacy unscoped drafts', () => {
    expect(
      recoverStoredDraft(JSON.stringify({ name: 'TUZZ', city: 'Prishtinë' }), initial),
    ).toBeNull()
  })

  it('rejects draft fields with an incompatible shape', () => {
    const raw = JSON.stringify({
      version: 2,
      baseline: JSON.stringify(initial),
      value: { name: 'Aurum Restaurant', city: 42 },
    })

    expect(recoverStoredDraft(raw, initial)).toBeNull()
  })
})
