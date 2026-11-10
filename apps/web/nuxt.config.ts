import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Files the server needs that are not code, so the server bundle would leave
// them out unless told to carry them: a Vercel function has no ffmpeg and no
// fonts of its own.
const require = createRequire(import.meta.url)
// The ffmpeg and ffprobe builds the video pipeline runs.
const mediaBinaries = (() => {
  try {
    return [require('ffmpeg-static') as string | null, (require('ffprobe-static') as { path: string }).path]
      .filter((path): path is string => !!path)
  } catch {
    return []
  }
})()
// The upright Inter faces the overlays draw their text with (see
// server/utils/fonts.ts), and the package file they are found by.
const textFonts = (() => {
  try {
    const fontPackage = require.resolve('@expo-google-fonts/inter/package.json')
    const root = dirname(fontPackage)
    return [fontPackage, ...readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.includes('Italic'))
      .flatMap((entry) => readdirSync(join(root, entry.name))
        .filter((file) => file.endsWith('.ttf'))
        .map((file) => join(root, entry.name, file)))]
  } catch {
    return []
  }
})()

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

// The longest a Vercel function may run (800s is the Pro maximum). The planner
// cron reads the same figure to stop claiming work before it is cut off.
const functionMaxDurationSeconds = Number(process.env.FUNCTION_MAX_DURATION_SECONDS) || 800

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Frame-Options': 'DENY',
}

export default defineNuxtConfig({
  compatibilityDate: '2026-09-05',
  // These overrides make it possible to verify a production bundle without
  // touching a developer's active Nuxt dev server or its build artifacts.
  buildDir: process.env.NUXT_BUILD_DIR || '.nuxt',
  modules: ['@nuxt/ui', '@nuxt/eslint', '@vercel/speed-insights'],
  css: ['@fontsource-variable/inter', '~/assets/css/main.css'],
  devtools: { enabled: false },
  // Inline the global stylesheet into the server-rendered HTML as well as each
  // component's styles, so the first paint does not wait on a separate
  // render-blocking request for entry.css.
  features: { inlineStyles: true },
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
    serverBundle: { collections: ['lucide', 'flag', 'simple-icons'] },
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
    externals: { traceInclude: [...mediaBinaries, ...textFonts] },
    vercel: {
      functions: { maxDuration: functionMaxDurationSeconds },
      // The planner runs from this cron on Vercel, where no process stays up
      // between requests to run it on a timer.
      // Retention runs once a day from its own cron, not on every instance.
      config: {
        crons: [
          { path: '/api/cron/planner', schedule: '* * * * *' },
          { path: '/api/cron/maintenance', schedule: '0 3 * * *' },
          // Ended packages and their credits, as the package timer does on a
          // long-running host.
          { path: '/api/cron/packages', schedule: '*/15 * * * *' },
        ],
      },
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'de-CH' },
      title: 'Framic — KI-Marketing für Deutschland, Österreich und die Schweiz',
      meta: [
        // iOS keeps its no-zoom scale from plugins/ios-field-zoom.client.ts;
        // elsewhere pinch-zoom stays available.
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, viewport-fit=cover',
        },
        {
          name: 'description',
          content:
            'Erstelle mit KI professionelle Texte, Bilder und Social-Media-Beiträge für dein Unternehmen in Deutschland, Österreich und der Schweiz.',
        },
        // Meta Business verification reads this tag from the server-rendered home page.
        ...(process.env.META_DOMAIN_VERIFICATION
          ? [{ name: 'facebook-domain-verification', content: process.env.META_DOMAIN_VERIFICATION }]
          : []),
      ],
      link: [{ rel: 'icon', type: 'image/webp', href: '/f-logo.webp' }],
    },
  },
  runtimeConfig: {
    functionMaxDurationSeconds,
    // Vercel sets VERCEL while it builds; the built app keeps the answer,
    // since its functions need not see VERCEL when they run (server/utils/host).
    onVercel: Boolean(process.env.VERCEL),
    public: {
      apiBase: '',
      // Publishable Supabase credentials are safe to expose to the browser.
      // Domain data access must continue through the server API and Supabase Auth.
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
      supabaseKey: process.env.NUXT_PUBLIC_SUPABASE_KEY || process.env.SUPABASE_KEY || '',
      paddleClientToken: process.env.NUXT_PUBLIC_PADDLE_CLIENT_TOKEN || process.env.PADDLE_CLIENT_TOKEN || '',
      paddlePackagePriceId: process.env.NUXT_PUBLIC_PADDLE_PACKAGE_PRICE_ID || process.env.PADDLE_PACKAGE_PRICE_ID || '',
      paddleEnvironment: process.env.NUXT_PUBLIC_PADDLE_ENV || process.env.PADDLE_ENV || 'sandbox',
    },
  },
  routeRules: {
    '/app': { ssr: false },
    '/app/**': { ssr: false, headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
    // Render the planner's first meaningful state with the authenticated request.
    // Its private HTML must never be stored by a shared or browser cache.
    '/app/*/*/monthly-planner': {
      ssr: true,
      headers: { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, no-store' },
    },
    '/app/*/*/content': {
      ssr: true,
      headers: { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, no-store' },
    },
    '/app/*/*/calendar': {
      ssr: true,
      headers: { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, no-store' },
    },
    '/app/*/*/gallery': {
      ssr: true,
      headers: { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, no-store' },
    },
    '/app/*/*/brand': {
      ssr: true,
      headers: { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, no-store' },
    },
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
    // The admin invoice preview frames the PDF on the same origin. On Vercel a
    // header rule overrides what the handler sets and only the most specific
    // matching rule applies, so this one repeats the rest of the headers.
    '/api/admin/organizations/**': { headers: { ...securityHeaders, 'X-Frame-Options': 'SAMEORIGIN' } },
    '/**': { headers: securityHeaders },
  },
  eslint: { config: { stylistic: false } },
})
