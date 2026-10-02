import { describe, expect, it } from 'vitest'
import { hasPasswordSymbol, PASSWORD_MIN_LENGTH } from '../../app/utils/password-policy'

describe('password policy', () => {
  it('keeps the minimum password length at 12 characters', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12)
  })

  it('requires at least one supported symbol', () => {
    expect(hasPasswordSymbol('twelvechars')).toBe(false)
    expect(hasPasswordSymbol('twelvechars!')).toBe(true)
    expect(hasPasswordSymbol('password-with-hyphen')).toBe(true)
  })
})
