import { z } from 'zod'
import sharp from 'sharp'
import { downloadAsset } from '../../utils/asset-storage'
import { mediaWidthFor } from '~~/shared/utils/media-width'

// Formats sharp can shrink without losing what makes them what they are; an
// animated GIF or an SVG is sent as uploaded.
const RESIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'server.PHOTO_NOT_FOUND' })
  const result = await withBusinessTransaction(user.id, (client) =>
    client.query(
      'SELECT a.storage_path, a.bytes, a.mime FROM assets a JOIN businesses b ON b.id = a.business_id WHERE a.id = $1 AND b.owner_id = $2',
      [id.data, user.id],
    ),
  )
  if (!result.rows[0]) throw createError({ statusCode: 404, message: 'server.PHOTO_NOT_FOUND' })
  const original = result.rows[0].storage_path
    ? await downloadAsset(result.rows[0].storage_path)
    : result.rows[0].bytes
  // A thumbnail asks for a width (see MediaImage); the original is sent
  // otherwise, so downloads and editors keep the full image.
  const width = mediaWidthFor(Number(getQuery(event).w))
  const resize = width && RESIZABLE.has(result.rows[0].mime)
  setHeader(event, 'Content-Type', resize ? 'image/webp' : result.rows[0].mime)
  // An asset's bytes never change under its id (an edit makes a new asset),
  // so the browser keeps it: reopening the gallery shows it at once instead
  // of downloading and resizing every photo again. "private" keeps it out of
  // shared caches.
  setHeader(event, 'Cache-Control', 'private, max-age=31536000, immutable')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  if (!resize) return original
  return sharp(original, { limitInputPixels: 16000000 })
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer()
})
