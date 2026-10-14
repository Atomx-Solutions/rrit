export default defineEventHandler((event) => {
  const origin = (process.env.APP_URL || getRequestURL(event).origin).replace(/\/$/, '')

  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, s-maxage=86400')

  return `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /app/\nDisallow: /onboarding\nDisallow: /join\nDisallow: /auth/\n\nSitemap: ${origin}/sitemap.xml\n`
})
