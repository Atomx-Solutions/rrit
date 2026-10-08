import { z } from 'zod'
import { downloadAsset } from '../../utils/asset-storage'

// Meta fetches a Reel or a page video from a URL rather than accepting an
// upload, so a ready render is served here without a session, authorised by the
// short-lived signature in the query instead. Nothing else about the render is
// exposed: a bad or expired signature is a plain 404.
export default defineEventHandler(async (event) => {
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  const query = getQuery(event)
  if (
    !id.success ||
    typeof query.expires !== 'string' ||
    typeof query.signature !== 'string' ||
    !validVideoSignature(id.data, query.expires, query.signature)
  )
    throw createError({ statusCode: 404 })
  const row = await database().query<{ storage_path: string }>(
    'SELECT storage_path FROM app.read_signed_video_location($1)',
    [id.data],
  )
  if (!row.rows[0]) throw createError({ statusCode: 404 })
  setHeader(event, 'Content-Type', 'video/mp4')
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return downloadAsset(row.rows[0].storage_path, 200 * 1024 * 1024)
})
