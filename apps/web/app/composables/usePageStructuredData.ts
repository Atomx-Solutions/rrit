/**
 * Describes a public page to search engines as a WebPage of the Framic site,
 * linked to the Organization the landing page declares under the same @id.
 */
export function usePageStructuredData(page: { name: () => string, description: () => string }) {
  const requestUrl = useRequestURL()
  const { locale } = useI18n()
  const structuredData = computed(() => JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${requestUrl.origin}${requestUrl.pathname}#webpage`,
    url: `${requestUrl.origin}${requestUrl.pathname}`,
    name: page.name(),
    description: page.description(),
    inLanguage: locale.value,
    isPartOf: { '@type': 'WebSite', url: requestUrl.origin, name: 'Framic' },
    publisher: { '@id': `${requestUrl.origin}/#organization` },
  }))
  useHead({
    script: [{ type: 'application/ld+json' as 'application/json', innerHTML: structuredData }],
  })
}
