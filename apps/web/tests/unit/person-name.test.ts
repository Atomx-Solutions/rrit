import { describe, expect, it } from 'vitest'
import { isPersonName, keepPersonNameCharacters } from '../../shared/schemas/person-name'

describe('keepPersonNameCharacters', () => {
  it('drops digits and symbols as they are typed', () => {
    expect(keepPersonNameCharacters('14747474')).toBe('')
    expect(keepPersonNameCharacters('Altin2 Hamza!')).toBe('Altin Hamza')
    expect(keepPersonNameCharacters('Anne-Marie O\'Neil')).toBe('Anne-Marie O\'Neil')
    expect(keepPersonNameCharacters('Çelë Ëmëri')).toBe('Çelë Ëmëri')
  })
})

describe('isPersonName', () => {
  it('accepts names in any alphabet with the marks names carry', () => {
    for (const name of ['Altin Hamza', 'Anne-Marie O\'Neil', 'J. Smith', 'Çelë Ëmëri', 'Jürgen Müller', 'Ömer Şahin', 'Δημήτρης'])
      expect(isPersonName(name), name).toBe(true)
  })

  it('refuses digits, symbols and a leading mark', () => {
    for (const value of ['63456', 'Altin 2', 'altin@example.com', '-Altin', '   ', ''])
      expect(isPersonName(value), value).toBe(false)
  })
})
