export default defineEventHandler((event) => {
  const configuredUrl = process.env.APP_URL || getRequestURL(event).origin
  const origin = configuredUrl.replace(/\/$/, '')
  const publicPaths = ['/', '/pricing', '/help', '/privacy', '/terms', '/refund']
  const urls = publicPaths
    .map((path) => `  <url><loc>${origin}${path}</loc></url>`)
    .join('\n')

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, s-maxage=86400')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`
})
