const appHost = (() => {
  try {
    return process.env.APP_URL ? new URL(process.env.APP_URL).hostname : undefined
  } catch {
    return undefined
  }
})()

// One year, the longest lifetime a cache may honour, for build output: its
// file names carry a content hash, so a changed file always has a new URL.
const immutableAsset = 'public, max-age=31536000, immutable'
const publicAsset = 'public, max-age=86400, stale-while-revalidate=604800'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-05',
  // These overrides make it possible to verify a production bundle without
  // touching a developer's active Nuxt dev server or its build artifacts.
  buildDir: process.env.NUXT_BUILD_DIR || '.nuxt',
  modules: ['@nuxt/ui', '@nuxt/eslint'],
  css: ['@fontsource-variable/inter', '~/assets/css/main.css'],
  devtools: { enabled: false },
  experimental: {
    // Prefetching every link as it scrolls into view downloaded the login and
    // dashboard code (Supabase, zod) on the landing page before anyone asked
    // for it. A hover or tap still starts the download ahead of the click.
    defaults: { nuxtLink: { prefetchOn: { visibility: false, interaction: true } } },
  },
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
    // Pre-compress public assets so a self-hosted Nitro serves them gzipped
    // or brotli-encoded without doing the work per request.
    compressPublicAssets: { gzip: true, brotli: true },
    // Vercel needs Nitro's serverless output format so the deployed app is
    // routed through the Nuxt handler instead of being served as static files.
    preset: process.env.VERCEL ? 'vercel' : undefined,
    // The Vercel preset owns its output directory (.vercel/output), which
    // Vercel uses to wire the serverless function and static assets together.
    // Keep the custom directory only for local/non-Vercel builds.
    output: process.env.VERCEL
      ? {}
      : { dir: process.env.NITRO_OUTPUT_DIR || '.output' },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'de-CH' },
      title: 'Framic — KI-Marketing für Deutschland, Österreich und die Schweiz',
      meta: [
        {
          name: 'description',
          content:
            'Erstelle mit KI professionelle Texte, Bilder und Social-Media-Beiträge für dein Unternehmen in Deutschland, Österreich und der Schweiz.',
        },
      ],
      link: [{ rel: 'icon', type: 'image/webp', href: '/f-logo.webp' }],
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
    // The invitation preview is a same-origin POST, and a server-rendered
    // request carries no Origin header for requireSameOrigin to accept.
    '/join': { ssr: false, headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
    '/admin/**': { ssr: false, headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
    // Hashed build assets and the static illustrations never change under a
    // given URL, so repeat visits should reuse them instead of revalidating.
    '/_nuxt/**': { headers: { 'Cache-Control': immutableAsset } },
    // Public images keep their name when replaced, so browsers reuse them for a
    // day and the CDN revalidates in the background rather than pinning an old
    // file for a year.
    '/images/**': { headers: { 'Cache-Control': publicAsset } },
    '/*.webp': { headers: { 'Cache-Control': publicAsset } },
    '/*.svg': { headers: { 'Cache-Control': publicAsset } },
    '/*.png': { headers: { 'Cache-Control': publicAsset } },
    '/**': {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
        'X-Frame-Options': 'DENY',
      },
    },
  },
  eslint: { config: { stylistic: false } },
})
