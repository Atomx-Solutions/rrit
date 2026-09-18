const appHost = (() => {
  try {
    return process.env.APP_URL ? new URL(process.env.APP_URL).hostname : undefined
  } catch {
    return undefined
  }
})()

export default defineNuxtConfig({
  compatibilityDate: '2026-09-05',
  // These overrides make it possible to verify a production bundle without
  // touching a developer's active Nuxt dev server or its build artifacts.
  buildDir: process.env.NUXT_BUILD_DIR || '.nuxt',
  modules: ['@nuxt/ui', '@nuxt/eslint'],
  css: ['@fontsource-variable/inter', '~/assets/css/main.css'],
  devtools: { enabled: false },
  vite: {
    server: {
      allowedHosts: appHost ? [appHost] : [],
    },
  },
  ui: { fonts: false },
  colorMode: { preference: 'light', fallback: 'light' },
  icon: {
    serverBundle: { collections: ['lucide', 'flag'] },
    clientBundle: { scan: { globInclude: ['app/**/*.{vue,ts}'] } },
  },
  typescript: { strict: true },
  nitro: {
    output: {
      dir: process.env.NITRO_OUTPUT_DIR || '.output',
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'sq' },
      title: 'Rrit — Marketingu yt, me drejtim',
      meta: [
        {
          name: 'description',
          content:
            'Planifiko, krijo dhe organizo marketingun e biznesit tënd në një hapësirë. Ndërtuar për bizneset shqiptare.',
        },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  runtimeConfig: {
    public: {
      apiBase: '',
      // Publishable Supabase credentials are safe to expose to the browser.
      // Domain data access must continue through the server API and Supabase Auth.
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
      supabaseKey: process.env.NUXT_PUBLIC_SUPABASE_KEY || process.env.SUPABASE_KEY || '',
    },
  },
  routeRules: {
    '/app': { ssr: false },
    '/app/**': { ssr: false, headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
    '/onboarding': { ssr: false },
    '/admin/**': { ssr: false, headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
    '/**': {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      },
    },
  },
  eslint: { config: { stylistic: false } },
})
