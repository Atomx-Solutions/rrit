// The languages the client app is written in. The browser dictionaries and
// the server's emails both read this one list.
export const APP_LANGUAGES = ['sq', 'en', 'de', 'it', 'fr', 'tr'] as const
export type AppLanguage = typeof APP_LANGUAGES[number]

/** A text missing in one language is read in this one instead, as the app does. */
export const FALLBACK_LANGUAGE: AppLanguage = 'en'
