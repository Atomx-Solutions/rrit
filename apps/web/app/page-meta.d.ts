declare module '#app' {
  interface PageMeta {
    /**
     * False when every string on the page comes from t(), so the DOM
     * translator in plugins/i18n.client.ts need not start there.
     */
    domTranslation?: boolean
  }
}

export {}
