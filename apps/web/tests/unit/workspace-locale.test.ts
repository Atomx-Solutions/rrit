import { describe, expect, it } from 'vitest'
import { APP_LOCALES, appLocaleSchema } from '../../shared/schemas/workspace'

describe('workspace locale', () => {
  // Workspaces stored before the Swiss German rollout hold 'de-DE'. Rejecting
  // it made loadWorkspace throw, which took /api/business down entirely.
  it('reads a workspace saved with the retired German locale', () => {
    expect(appLocaleSchema.parse('de-DE')).toBe('de-CH')
  })

  it('falls back to Swiss German when no locale was stored', () => {
    expect(appLocaleSchema.parse(undefined)).toBe('de-CH')
  })

  it('keeps every supported locale unchanged', () => {
    for (const locale of APP_LOCALES) expect(appLocaleSchema.parse(locale)).toBe(locale)
  })

  it('still rejects a locale the app does not support', () => {
    expect(appLocaleSchema.safeParse('fr-FR').success).toBe(false)
  })
})
