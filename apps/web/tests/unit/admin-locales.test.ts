import { describe, expect, it } from 'vitest'
import adminEn from '../../app/locales/admin/en.json'
import adminSq from '../../app/locales/admin/sq.json'
import clientEn from '../../app/locales/client/en.json'
import clientSq from '../../app/locales/client/sq.json'

describe('admin locales', () => {
  it('keeps the same admin translation keys in Albanian and English', () => {
    expect(Object.keys(adminSq).sort()).toEqual(Object.keys(adminEn).sort())
  })

  it('keeps admin translations separate from client translations', () => {
    expect(Object.keys(clientSq).some(key => key.startsWith('admin.'))).toBe(false)
    expect(Object.keys(clientEn).some(key => key.startsWith('admin.'))).toBe(false)
  })

  it('does not contain replacement characters from an invalid text encoding', () => {
    expect(Object.values(adminSq).join('')).not.toContain('\uFFFD')
    expect(Object.values(adminEn).join('')).not.toContain('\uFFFD')
  })
})
