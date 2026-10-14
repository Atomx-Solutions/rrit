export type AppLanguage = 'sq' | 'en' | 'de'

type Dictionary = Record<string, string>

// Each language is a chunk of its own, so a visitor downloads the dictionary
// they read instead of all five. Loading one is what the dictionary plugin
// awaits before the app mounts.
const clientLoaders: Record<AppLanguage, () => Promise<Dictionary[]>> = {
  sq: async () => [(await import('~/locales/client/sq.json')).default],
  en: async () => [(await import('~/locales/client/en.json')).default],
  // German client text falls back to English until each screen is translated.
  de: async () => [
    (await import('~/locales/client/en.json')).default,
    (await import('~/locales/client/de.json')).default,
  ],
}

// Superadmin copy is only ever rendered under /admin, so every other page
// skips it. The two dictionaries share no keys.
const adminLoaders: Record<AppLanguage, () => Promise<Dictionary>> = {
  sq: async () => (await import('~/locales/admin/sq.json')).default,
  en: async () => (await import('~/locales/admin/en.json')).default,
  de: async () => (await import('~/locales/admin/en.json')).default,
}

const loaded = new Map<AppLanguage, Dictionary>()
const admins = new Set<AppLanguage>()
const clientPending = new Map<AppLanguage, Promise<void>>()
const adminPending = new Map<AppLanguage, Promise<void>>()

/** The dictionary in hand, or undefined while it is still being fetched. */
export function dictionaryFor(language: AppLanguage): Dictionary | undefined {
  return loaded.get(language)
}

export function isDictionaryReady(language: AppLanguage, admin = false) {
  return loaded.has(language) && (!admin || admins.has(language))
}

async function ensureClient(language: AppLanguage) {
  if (loaded.has(language)) return
  let pending = clientPending.get(language)
  if (!pending) {
    pending = clientLoaders[language]().then((parts) => {
      loaded.set(language, Object.assign({}, ...parts))
    })
    clientPending.set(language, pending)
  }
  await pending
}

async function ensureAdmin(language: AppLanguage) {
  if (admins.has(language)) return
  let pending = adminPending.get(language)
  if (!pending) {
    pending = adminLoaders[language]().then((admin) => {
      Object.assign(loaded.get(language)!, admin)
      admins.add(language)
    })
    adminPending.set(language, pending)
  }
  await pending
}

export async function loadDictionary(language: AppLanguage, admin = false) {
  await ensureClient(language)
  if (admin) await ensureAdmin(language)
  return loaded.get(language)!
}

/**
 * The server renders whichever locale a request resolves to, and a layout may
 * still change it mid-render, so it keeps every dictionary in memory.
 */
export async function loadAllDictionaries() {
  const languages: AppLanguage[] = ['sq', 'en', 'de']
  await Promise.all(languages.map((language) => loadDictionary(language, true)))
}
