export default defineNuxtConfig({
  compatibilityDate: '2026-09-05',
  modules: ['@nuxt/ui', '@nuxt/eslint'],
  css: ['@fontsource-variable/inter', '~/assets/css/main.css'],
  devtools: { enabled: false },
  ui: { fonts: false },
  colorMode: { preference: 'light', fallback: 'light' },
  icon: { serverBundle: { collections: ['lucide'] }, clientBundle: { scan: true } },
  typescript: { strict: true },
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
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseKey: process.env.SUPABASE_KEY || '',
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
