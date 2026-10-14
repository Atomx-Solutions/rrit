import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import adminEn from '../../app/locales/admin/en.json'
import adminSq from '../../app/locales/admin/sq.json'
import clientEn from '../../app/locales/client/en.json'
import clientSq from '../../app/locales/client/sq.json'

const adminPage = readFileSync(new URL('../../app/components/AdminPage.vue', import.meta.url), 'utf8')
const publicLayout = readFileSync(new URL('../../app/layouts/public.vue', import.meta.url), 'utf8')

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

  it('uses a select control for the Admin language switcher', () => {
    expect(adminPage).toMatch(/<USelect\s+v-model="language"/)
    expect(adminPage).toContain(':items="languageOptions"')
    expect(adminPage).toContain("const languageFlag = computed(() => locale.value === 'en-US'")
    expect(adminPage).toContain('class="size-4 sm:hidden"')
    expect(adminPage).toContain('class="size-5 hidden sm:block"')
    expect(adminPage).toContain("base: 'ps-2.5 sm:ps-9'")
    expect(adminPage).toContain('class="w-40 sm:w-32"')
    expect(adminPage).not.toContain('languageModalOpen')
  })

  it('uses the same select control for the client language switcher', () => {
    expect(publicLayout).toContain("const languageOptions = computed(() =>")
    expect(publicLayout).toMatch(/<USelect\s+v-model="language"/)
    expect(publicLayout).toContain(':items="languageOptions"')
    expect(publicLayout).toContain('class="size-4 sm:hidden"')
    expect(publicLayout).toContain('class="size-5 hidden sm:block"')
    expect(publicLayout).not.toContain('marketing-language-switch')
  })
})
