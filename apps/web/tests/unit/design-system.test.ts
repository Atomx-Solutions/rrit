import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { designSystem } from '../../app/utils/design-system'

const css = readFileSync(new URL('../../app/assets/css/main.css', import.meta.url), 'utf8')
const landingCss = readFileSync(new URL('../../app/assets/css/landing.css', import.meta.url), 'utf8')
const publicLayout = readFileSync(new URL('../../app/layouts/public.vue', import.meta.url), 'utf8')

describe('shared design system', () => {
  it('defines the required semantic token groups', () => {
    expect(designSystem.policy.componentSystem).toBe('Nuxt UI v4')
    expect(designSystem.policy.icons).toContain('Lucide')
    expect(designSystem.tokens.color).toEqual(
      expect.arrayContaining(['canvas', 'surface', 'text', 'muted', 'border', 'primary', 'focus']),
    )
    expect(designSystem.tokens).toHaveProperty('typography')
    expect(designSystem.tokens).toHaveProperty('spacing')
    expect(designSystem.tokens).toHaveProperty('radius')
    expect(designSystem.tokens).toHaveProperty('elevation')
    expect(designSystem.tokens).toHaveProperty('motion')
  })

  it('supplies light and dark semantic CSS values for shared UI', () => {
    for (const token of [
      '--rrit-color-canvas',
      '--rrit-color-surface',
      '--rrit-color-text',
      '--rrit-color-muted',
      '--rrit-color-border',
      '--rrit-color-primary',
      '--rrit-color-focus',
      '--rrit-space-4',
      '--rrit-radius-card',
      '--rrit-shadow-card',
      '--rrit-motion-standard',
    ]) {
      expect(css).toContain(token)
    }
    expect(css).toMatch(/\.dark\s*\{[\s\S]*--rrit-color-canvas:/)
  })

  it('makes approved marketing UI consume shared tokens, not local colour literals', () => {
    expect(landingCss).toContain('--landing-paper: var(--rrit-color-marketing-canvas)')
    expect(landingCss).toContain('background: var(--rrit-color-marketing-action)')
    expect(landingCss).toContain('background: var(--rrit-color-marketing-action-hover)')
    expect(publicLayout).not.toMatch(/\.marketing-footer\s*\{[\s\S]*#[0-9a-f]{3,8}/i)
  })
})
