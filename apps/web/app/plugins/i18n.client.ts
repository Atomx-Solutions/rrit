import { loadDictionary } from '~/utils/dictionary'

const attributes = ['aria-label', 'placeholder', 'title', 'alt']
const skippedTags = ['SCRIPT', 'STYLE', 'NOSCRIPT']

type Language = 'sq' | 'en'

function collapse(value: string) {
  return value.replace(/\s+/g, ' ')
}

// One lookup per direction, built the first time that direction is needed:
// a session only ever translates one way, and walking both dictionaries costs
// more than the page's own startup work. The dictionaries arrive as their own
// chunks after hydration, so this never sits on the critical path.
const lookups = new Map<Language, Map<string, string>>()
const lookupPending = new Map<Language, Promise<void>>()

async function ensureLookup(language: Language) {
  if (lookups.has(language)) return
  let run = lookupPending.get(language)
  if (!run) {
    run = (async () => {
      const [source, target] = await Promise.all([
        loadDictionary(language === 'en' ? 'sq' : 'en', true),
        loadDictionary(language === 'en' ? 'en' : 'sq', true),
      ])
      const lookup = new Map<string, string>()
      // Whitespace-collapsed keys go in first so an exact key always wins.
      for (const [key, value] of Object.entries(source)) {
        const translated = target[key]
        if (translated) lookup.set(collapse(value), translated)
      }
      for (const [key, value] of Object.entries(source)) {
        const translated = target[key]
        if (translated) lookup.set(value, translated)
      }
      lookups.set(language, lookup)
    })()
    lookupPending.set(language, run)
  }
  await run
}

function dynamicText(value: string, language: Language) {
  if (language === 'en') {
    return value
      .replace(/^(\d+) kredi$/, '$1 credits')
      .replace(/^(\d+) postime presin mendimin tënd\.$/, '$1 posts are waiting for your review.')
      .replace(/^Hapi (\d+) nga 3: (.*)$/, 'Step $1 of 3: $2')
      .replace(/^Fakti (\d+)$/, 'Fact $1')
      .replace(/^Hiq faktin (\d+)$/, 'Remove fact $1')
      .replace(/^(\d+) nga (\d+) postime$/, '$1 of $2 posts')
  }
  return value
    .replace(/^(\d+) credits$/, '$1 kredi')
    .replace(/^(\d+) posts are waiting for your review\.$/, '$1 postime presin mendimin tënd.')
    .replace(/^Step (\d+) of 3: (.*)$/, 'Hapi $1 nga 3: $2')
    .replace(/^Fact (\d+)$/, 'Fakti $1')
    .replace(/^Remove fact (\d+)$/, 'Hiq faktin $1')
    .replace(/^(\d+) of (\d+) posts$/, '$1 nga $2 postime')
}

function translate(value: string, language: Language) {
  const trimmed = value.trim()
  if (!trimmed) return value
  const lookup = lookups.get(language)
  if (!lookup) return value
  const translated = lookup.get(trimmed)
    || lookup.get(collapse(trimmed))
    || dynamicText(trimmed, language)
  if (!translated || translated === trimmed) return value
  return value.replace(trimmed, translated)
}

function translateTextNode(node: Text, language: Language) {
  const parent = node.parentElement
  if (!parent || skippedTags.includes(parent.tagName)) return
  const next = translate(node.nodeValue || '', language)
  if (next !== node.nodeValue) node.nodeValue = next
}

function translateAttributes(element: Element, language: Language) {
  for (const attribute of attributes) {
    const value = element.getAttribute(attribute)
    if (!value) continue
    const next = translate(value, language)
    if (next !== value) element.setAttribute(attribute, next)
  }
}

function scan(root: Node, language: Language) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text, language)
    return
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) translateTextNode(walker.currentNode as Text, language)
  if (root instanceof Element) translateAttributes(root, language)
  for (const element of (root as Element | DocumentFragment).querySelectorAll('*'))
    translateAttributes(element, language)
}

export default defineNuxtPlugin(() => {
  const { locale, setLocale } = useI18n()
  // German client copy currently uses the English fallback dictionary for text
  // outside Vue translations, while preserving the selected document language.
  const language = computed<Language>(() => locale.value === 'sq-XK' ? 'sq' : 'en')
  let observer: MutationObserver | undefined
  const pending = new Set<Node>()
  let queued = false

  const refreshHead = () => {
    document.documentElement.lang = locale.value === 'de-CH' ? 'de-CH' : language.value
    document.title = translate(document.title, language.value)
    for (const meta of document.querySelectorAll('meta[name="description"]')) {
      const content = meta.getAttribute('content')
      if (content) meta.setAttribute('content', translate(content, language.value))
    }
  }
  const refresh = async () => {
    if (!document.body) return
    await ensureLookup(language.value)
    scan(document.body, language.value)
    refreshHead()
  }
  // Mutations are translated in place rather than by rescanning the document:
  // the observer watches the whole body, and a full walk per mutation batch was
  // the page's longest main-thread task.
  const flush = () => {
    queued = false
    const roots = [...pending]
    pending.clear()
    for (const root of roots) {
      if (!root.isConnected) continue
      scan(root, language.value)
    }
  }
  const queue = (node: Node) => {
    pending.add(node)
    if (queued) return
    queued = true
    queueMicrotask(flush)
  }
  const handle = (records: MutationRecord[]) => {
    for (const record of records) {
      if (record.type === 'characterData') queue(record.target)
      else if (record.type === 'attributes') queue(record.target)
      else for (const node of record.addedNodes) queue(node)
    }
  }

  onNuxtReady(() => {
    const storedLocale = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith('rrit-locale='))
      ?.split('=')[1]
    setLocale(storedLocale ? decodeURIComponent(storedLocale) : locale.value)
    // Let Vue finish hydration before mutating rendered text nodes. The
    // dictionaries this needs are fetched here rather than up front, so they
    // stay off the first paint's critical path.
    window.setTimeout(async () => {
      await refresh()
      observer = new MutationObserver(handle)
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: attributes,
      })
      window.addEventListener('rrit-locale-change', () => void refresh())
    }, 50)
  })
  return {
    provide: {
      t: (key: string, params?: Record<string, string | number>) => useI18n().t(key, params),
    },
  }
})
