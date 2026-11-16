// The images the PDFs embed live in public/, which a serverless function cannot
// read: Vercel serves that folder from its CDN and leaves it out of the
// function. nuxt.config bundles every public file matching this pattern into
// the server as this storage (read by server/utils/pdf-assets.ts).
export const PDF_ASSET_STORAGE = 'assets:pdf'
export const PDF_ASSET_PATTERN = '*-pdf.jpg'
