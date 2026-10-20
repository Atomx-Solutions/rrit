import { describe, expect, it } from 'vitest'
import {
  APP_LOCALES,
  appLocaleSchema,
  contentLanguageForLocale,
  contentLocaleForPreferences,
} from '../../shared/schemas/workspace'

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

  it('maps every audience language to the language used for generated copy', () => {
    expect(contentLanguageForLocale('sq-XK')).toBe('Albanian')
    expect(contentLanguageForLocale('en-US')).toBe('English')
    expect(contentLanguageForLocale('de-CH')).toBe('German')
    expect(contentLanguageForLocale('it-CH')).toBe('Italian')
    expect(contentLanguageForLocale('fr-CH')).toBe('French')
    expect(contentLanguageForLocale('tr-TR')).toBe('Turkish')
  })

  it('uses a business content language over the language of the dashboard', () => {
    expect(contentLocaleForPreferences({ locale: 'sq-XK', contentLocale: 'tr-TR' })).toBe('tr-TR')
    expect(contentLocaleForPreferences({ locale: 'en-US' })).toBe('en-US')
  })
})
