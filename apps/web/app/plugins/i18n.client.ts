import sq from '~/locales/client/sq.json'
import en from '~/locales/client/en.json'
import adminSq from '~/locales/admin/sq.json'
import adminEn from '~/locales/admin/en.json'

const attributes = ['aria-label', 'placeholder', 'title', 'alt']
const sqDictionary = { ...sq, ...adminSq }
const enDictionary = { ...en, ...adminEn }
const maps = {
  sqToEn: new Map(Object.entries(sqDictionary).map(([key, value]) => [value, enDictionary[key as keyof typeof enDictionary]])),
  enToSq: new Map(Object.entries(enDictionary).map(([key, value]) => [value, sqDictionary[key as keyof typeof sqDictionary]])),
}
const normalizedMaps = {
  sqToEn: new Map([...maps.sqToEn].map(([key, value]) => [key.replace(/\s+/g, ' '), value])),
  enToSq: new Map([...maps.enToSq].map(([key, value]) => [key.replace(/\s+/g, ' '), value])),
}

function dynamicText(value: string, language: 'sq' | 'en') {
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

function translate(value: string, language: 'sq' | 'en') {
  const trimmed = value.trim()
  if (!trimmed) return value
  const map = language === 'en' ? maps.sqToEn : maps.enToSq
  const normalizedMap = language === 'en' ? normalizedMaps.sqToEn : normalizedMaps.enToSq
  const translated = map.get(trimmed) || normalizedMap.get(trimmed.replace(/\s+/g, ' ')) || dynamicText(trimmed, language)
  if (!translated || translated === trimmed) return value
  return value.replace(trimmed, translated)
}

function scan(root: ParentNode, language: 'sq' | 'en') {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    const parent = node.parentElement
    if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) continue
    const next = translate(node.nodeValue || '', language)
    if (next !== node.nodeValue) node.nodeValue = next
  }
  const elements = root instanceof Element ? [root, ...root.querySelectorAll('*')] : [...root.querySelectorAll('*')]
  for (const element of elements) {
    for (const attribute of attributes) {
      const value = element.getAttribute(attribute)
      if (value) {
        const next = translate(value, language)
        if (next !== value) element.setAttribute(attribute, next)
      }
    }
  }
}

export default defineNuxtPlugin(() => {
  const { locale, setLocale } = useI18n()
  const language = computed(() => locale.value === 'en-US' ? 'en' : 'sq')
  let observer: MutationObserver | undefined
  let queued = false
  const refresh = () => {
    if (!document.body) return
    document.documentElement.lang = language.value === 'en' ? 'en' : 'sq'
    scan(document.body, language.value)
    document.title = translate(document.title, language.value)
    for (const meta of document.querySelectorAll('meta[name="description"]')) {
      const content = meta.getAttribute('content')
      if (content) meta.setAttribute('content', translate(content, language.value))
    }
  }
  const queueRefresh = () => {
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      refresh()
    })
  }
  onNuxtReady(() => {
    const storedLocale = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith('rrit-locale='))
      ?.split('=')[1]
    setLocale(storedLocale ? decodeURIComponent(storedLocale) : locale.value)
    // Let Vue finish hydration before mutating rendered text nodes.
    window.setTimeout(() => {
      refresh()
      observer = new MutationObserver(queueRefresh)
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: attributes,
      })
      window.addEventListener('rrit-locale-change', refresh)
    }, 50)
  })
  return {
    provide: {
      t: (key: string, params?: Record<string, string | number>) => useI18n().t(key, params),
    },
  }
})
